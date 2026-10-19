import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {MulticaPlatform,verifyMulticaDelivery,type PlatformScope} from '../src/adapters/multica-platform.js';
import {createHarness} from '../src/index.js';
import {hostOptions} from '../src/adapters/host-options.js';

function fixture(){
 const root=mkdtempSync(join(tmpdir(),'multica-delivery-')),posts:any[]=[],updates:any[]=[],comments:any[]=[];
 let loseResponse=false;
 const context=(name:string,id=name)=>{
  const cwd=join(root,name);mkdirSync(join(cwd,'.multica'),{recursive:true});
  writeFileSync(join(cwd,'.multica/daemon_task_context.json'),JSON.stringify({issue_id:id,agent_id:'agent'}));
  return {cwd,sessionManager:{getSessionId:()=>name}};
 };
 const run=async(scope:PlatformScope,args:string[])=>{
  if(args[0]==='issue'&&args[1]==='comment'&&args[2]==='list')return comments.filter(c=>c.issue_id===scope.issueId);
  if(args[0]==='issue'&&args[1]==='status'){updates.push({issueId:scope.issueId,status:args[3]});return {status:args[3]};}
  if(args[0]==='issue'&&args[1]==='comment'&&args[2]==='add'){
   const content=readFileSync(args[args.indexOf('--content-file')+1]!,'utf8');
   const attachments=args.flatMap((arg,i)=>arg==='--attachment'?[args[i+1]!]:[]).map(p=>({filename:p.endsWith('REPORT.md')?'REPORT.md':'answer.json',size_bytes:readFileSync(p).byteLength,uploader_type:'agent',uploader_id:'agent'}));
   const comment={id:'comment-'+(posts.length+1),issue_id:scope.issueId,content,author_type:'agent',author_id:'agent',attachments};comments.push(comment);posts.push(comment);
   if(loseResponse){loseResponse=false;throw Error('response lost after server committed');}
   return comment;
  }
  throw Error('Unexpected command '+args.join(' '));
 };
 const bridge=new MulticaPlatform({cli:'/unused',serverUrl:'https://example.test',workspaceId:'workspace'},{env:{},run});
 return {root,context,bridge,posts,updates,comments,loseReply:()=>{loseResponse=true;},close:()=>rmSync(root,{recursive:true,force:true})};
}

test('Issue identity freezes per native session even if shared host context is overwritten',async()=>{
 const f=fixture(),a=f.context('a','issue-a');
 try{
  assert.equal(f.bridge.scope(a).issueId,'issue-a');
  writeFileSync(join(a.cwd,'.multica/daemon_task_context.json'),JSON.stringify({issue_id:'issue-b',agent_id:'agent'}));
  assert.equal(f.bridge.scope(a).issueId,'issue-a');
  await f.bridge.status(a,'in_progress');assert.equal(f.updates[0].issueId,'issue-a');
  const b={cwd:a.cwd,sessionManager:{getSessionId:()=> 'b'}};
  assert.equal(f.bridge.scope(b).issueId,'issue-b');
  assert.throws(()=>f.bridge.scope(a,{issue_id:'issue-b'}),/runtime-bound/);
 }finally{f.close();}
});

test('independent task directories publish concurrently without artifact, receipt or status crossover',async()=>{
 const f=fixture(),a=f.context('a'),b=f.context('b');
 try{
  const first=f.bridge.save(a,{report:'Report A',answer:{result:'A'}}),second=f.bridge.save(b,{report:'Report B',answer:{result:'B'}});
  await Promise.all([f.bridge.submit(a,first.bundle_id),f.bridge.submit(b,second.bundle_id)]);
  assert.equal(readFileSync(join(a.cwd,'output/REPORT.md'),'utf8'),'Report A');
  assert.equal(readFileSync(join(b.cwd,'output/REPORT.md'),'utf8'),'Report B');
  assert.equal((await f.bridge.receipt(a)).issueId,'a');assert.equal((await f.bridge.receipt(b)).issueId,'b');
  assert.deepEqual(new Set(f.posts.map(p=>p.issue_id)),new Set(['a','b']));
  assert.equal(verifyMulticaDelivery(a.cwd).status,'passed');assert.equal(verifyMulticaDelivery(b.cwd).status,'passed');
  await assert.rejects(f.bridge.submit(b,first.bundle_id));
 }finally{f.close();}
});

test('a misconfigured shared output directory is rejected without changing the other task',()=>{
 const f=fixture(),a=f.context('a');
 try{
  f.bridge.save(a,{report:'Keep A'});
  writeFileSync(join(a.cwd,'.multica/daemon_task_context.json'),JSON.stringify({issue_id:'other',agent_id:'agent'}));
  const b={cwd:a.cwd,sessionManager:{getSessionId:()=> 'other-session'}};
  assert.throws(()=>f.bridge.save(b,{report:'Overwrite A'}),/separate working directory/);
  assert.equal(readFileSync(join(a.cwd,'output/REPORT.md'),'utf8'),'Keep A');
 }finally{f.close();}
});

test('saved artifacts are published once, including concurrent retries and lost CLI responses',async()=>{
 const f=fixture(),a=f.context('a');
 try{
  assert.equal((await f.bridge.receipt(a)).confirmed,false);
  await assert.rejects(f.bridge.status(a,'in_review'),/Deliver and confirm/);
  const saved=f.bridge.save(a,{report:'Report with trailing newline\n',answer:{candidates:[{location:'component'}]}});
  assert.equal(verifyMulticaDelivery(a.cwd).status,'failed');f.loseReply();
  const receipts=await Promise.all([f.bridge.submit(a,saved.bundle_id),f.bridge.submit(a,saved.bundle_id)]);
  assert.equal(f.posts.length,1);assert.deepEqual(receipts[0],receipts[1]);
  await f.bridge.submit(a,saved.bundle_id);assert.equal(f.posts.length,1);
  assert.equal(verifyMulticaDelivery(a.cwd).status,'passed');
  assert.equal(readFileSync(saved.report_path,'utf8'),'Report with trailing newline\n');
  writeFileSync(saved.report_path,'Modified after delivery');assert.equal(verifyMulticaDelivery(a.cwd).status,'failed');
 }finally{f.close();}
});

test('stale bundles, tampered immutable files and symbolic-link outputs cannot be published',async()=>{
 const f=fixture(),a=f.context('a'),b=f.context('b');
 try{
  const old=f.bridge.save(a,{report:'Old'}),next=f.bridge.save(a,{report:'New'});
  await assert.rejects(f.bridge.submit(a,old.bundle_id),/newer report/);assert.equal(f.posts.length,0);
  writeFileSync(join(a.cwd,'.multica/deliverables/a/bundles',next.bundle_id,'REPORT.md'),'Forged');
  await assert.rejects(f.bridge.submit(a,next.bundle_id),/deliverable changed/);
  symlinkSync(join(a.cwd,'output'),join(b.cwd,'output'),'dir');
  assert.throws(()=>f.bridge.save(b,{report:'Escape'}),/symbolic links/);
  assert.equal(readFileSync(old.report_path,'utf8'),'New');assert.equal(f.posts.length,0);
 }finally{f.close();}
});

test('Cairn completion verifies actual delivery separately from supported claims and local files',async()=>{
 const f=fixture(),ctx=f.context('gate'),session={host:'pi' as const,sessionId:'gate-session',cwd:ctx.cwd};
 const h=createHarness({database:':memory:',session,completionVerifier:{id:'multica-delivery',artifacts:['output/REPORT.md','output/answer.json','output/receipt.json'],verify:()=>{
  const r=verifyMulticaDelivery(ctx.cwd);return {ok:r.status==='passed',issues:r.status==='passed'?[]:[{message:r.summary}],method:'contract'};
 }}});
 try{
  const start=await h.tools.invokeModel('cairn_start',{goal:'Deliver a supported report',criteria:['Report delivered']}) as any;
  const bundle=f.bridge.save(ctx,{report:'The supported report',answer:{result:'supported'}});
  await h.tools.invokeModel('cairn_update',{finding:{key:'result',text:'The report describes the observed result',status:'supported',basis:'Checked the source',covers:['c1']}});
  assert.equal((await h.tools.invokeModel('cairn_finish',{}) as any).phase,'incomplete');
  assert.equal(h.engine.store.get(start.taskId).status,'active');
  await f.bridge.submit(ctx,bundle.bundle_id);
  assert.equal((await h.tools.invokeModel('cairn_finish',{}) as any).phase,'completed');
  assert.equal(h.engine.store.get(start.taskId).verification?.status,'passed');
 }finally{await h.close();f.close();}
});

test('per-session durable deliveries survive host worktree deletion and isolate retries of the same Issue',async()=>{
 const f=fixture(),a=f.context('temporary-a','same-issue'),b=f.context('temporary-b','same-issue'),artifactRoot=join(f.root,'retained');
 const bridge=new MulticaPlatform({...f.bridge.settings,artifactRoot},f.bridge.options);
 try{
  const first=bridge.save(a,{report:'Report A',answer:{result:'A'}}),second=bridge.save(b,{report:'Report B',answer:{result:'B'}});
  assert.notEqual(first.report_path,second.report_path);
  await Promise.all([bridge.submit(a,first.bundle_id),bridge.submit(b,second.bundle_id)]);
  assert.equal(readFileSync(first.report_path,'utf8'),'Report A');assert.equal(readFileSync(second.report_path,'utf8'),'Report B');
  rmSync(a.cwd,{recursive:true,force:true});rmSync(b.cwd,{recursive:true,force:true});
  assert.equal(verifyMulticaDelivery(a.cwd,{artifactRoot,issueId:'same-issue',sessionId:'temporary-a'}).status,'passed');
  assert.equal(verifyMulticaDelivery(b.cwd,{artifactRoot,issueId:'same-issue',sessionId:'temporary-b'}).status,'passed');
 }finally{f.close();}
});

test('trusted durable paths reach the native completion verifier before engine creation and remain current after cleanup',async()=>{
 const f=fixture(),ctx=f.context('bootstrap','issue'),artifactRoot=join(f.root,'retained');
 const keys=['CAIRN_VERIFY_ARTIFACTS','CAIRN_MULTICA_ISSUE_ID','CAIRN_MULTICA_SESSION_ID','MULTICA_ARTIFACT_ROOT'];
 const previous=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
 const bridge=new MulticaPlatform({...f.bridge.settings,artifactRoot,requireAnswer:true},f.bridge.options);
 bridge.prepare(ctx);
 const env={...process.env,CAIRN_VERIFY_COMMAND:JSON.stringify([process.execPath,resolve('dist/multica-verifier.mjs')])};
 const session={host:'pi' as const,sessionId:'bootstrap',cwd:ctx.cwd};
 const h=createHarness({database:':memory:',session,...hostOptions(env)});
 try{
  const start=await h.tools.invokeModel('cairn_start',{goal:'Deliver a persistent report',criteria:['Report delivered']}) as any;
  assert.ok(h.engine.store.get(start.taskId).artifactRequirements!.every(p=>p.startsWith(artifactRoot)));
  const saved=bridge.save(ctx,{report:'Retained report',answer:{result:'source checked'}});
  await h.tools.invokeModel('cairn_update',{finding:{key:'result',text:'The result is supported',status:'supported',basis:'Checked original data',covers:['c1']}});
  assert.equal((await h.tools.invokeModel('cairn_finish',{}) as any).phase,'incomplete');
  await bridge.submit(ctx,saved.bundle_id);
  assert.equal((await h.tools.invokeModel('cairn_finish',{}) as any).phase,'completed');
  rmSync(ctx.cwd,{recursive:true,force:true});
  const state=h.engine.context(start.taskId);
  assert.equal(state.check.ok,true);assert.equal(state.verification!.status,'passed');
 }finally{
  await h.close();for(const k of keys)if(previous[k]===undefined)delete process.env[k];else process.env[k]=previous[k];f.close();
 }
});
