import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHarness,type Session,type CompletionVerifier} from '../src/index.js';
import {hostOptions} from '../src/adapters/host-options.js';
import {coreCatalog} from '../src/tools.js';
import {AjvJsonSchemaValidator} from '@modelcontextprotocol/sdk/validation/ajv';

async function fixture(fn:(h:ReturnType<typeof createHarness>,cwd:string,session:Session)=>Promise<void>,verifier?:CompletionVerifier){
 const cwd=mkdtempSync(join(tmpdir(),'cairn-artifacts-')),session:Session={host:'pi',sessionId:'owner',cwd};
 const h=createHarness({database:join(cwd,'state.db'),session,completionVerifier:verifier});
 try{await fn(h,cwd,session);}finally{await h.close();rmSync(cwd,{recursive:true,force:true});}
}
const start={goal:'Deliver a reproducible result',origin:'Original source is immutable',criteria:['Result matches the original'],constraints:['Do not repair the submitted result during acceptance']};
const finish={summary:'Produced result',findings:[{key:'result',text:'Result matches original',basis:'Compared original input and generated result',covers:['c1']}],artifacts:[{path:'answer.json'}]};

test('published schemas expose artifact and layered handoff fields on the existing five tools',()=>{
 const catalog=coreCatalog();assert.equal(catalog.length,5);
 const validate=new AjvJsonSchemaValidator().getValidator(catalog.find(t=>t.name==='cairn_checkpoint')!.inputSchema);
 assert.equal(validate({summary:'Saved',artifacts:[{path:'answer.json'}],handoffs:[{key:'attempt-1',summary:'Narrowed cause',report:'attempt-1.md',sessionRef:'pi:old-session',from:['finding'],next:'Test alternative'}]}).valid,true);
 assert.equal(validate({summary:'Forged hash',artifacts:[{path:'answer.json',sha256:'forged'}]}).valid,false);
});

test('verifier receives immutable goal/constraints and host-computed submission hashes',async()=>{
 let calls=0;
 await fixture(async(h,cwd,session)=>{
  writeFileSync(join(cwd,'answer.json'),'original');await h.tools.invoke('cairn_start',start);
  const result=await h.tools.invoke('cairn_finish',finish) as any;
  assert.equal(result.phase,'completed');assert.equal(result.verification.method,'replay');assert.equal(result.verification.current,true);assert.equal(calls,1);
  const task=h.engine.active(session)!;assert.match(task.artifacts![0]!.sha256,/^[a-f0-9]{64}$/);assert.equal(task.verification?.artifacts?.[0]?.sha256,task.artifacts![0]?.sha256);
 },{id:'replay',artifacts:['answer.json'],verify:task=>{calls++;assert.equal(task.origin,start.origin);assert.deepEqual(task.constraints,start.constraints);assert.equal(task.artifacts?.[0]?.bytes,8);return {ok:true,method:'replay',scope:'Replayed exact submitted file against the unchanged source'};}});
});

test('required deliverables cannot be removed by agent input and absence never reaches verifier',async()=>{
 let calls=0;
 await fixture(async h=>{
  await h.tools.invoke('cairn_start',start);
  const result=await h.tools.invoke('cairn_finish',{summary:finish.summary,findings:finish.findings,artifacts:[]}) as any;
  assert.equal(result.phase,'incomplete');assert.match(JSON.stringify(result.validation),/Required artifact/);assert.equal(calls,0);
 },{id:'required',artifacts:['answer.json'],verify:()=>{calls++;return {ok:true};}});
});

test('verifier cannot repair the submitted file and accept its replacement',async()=>{
 await fixture(async(h,cwd,session)=>{
  writeFileSync(join(cwd,'answer.json'),'broken');await h.tools.invoke('cairn_start',start);
  const result=await h.tools.invoke('cairn_finish',finish) as any;
  assert.equal(result.phase,'incomplete');assert.equal(result.status,'active');assert.equal(result.verification.status,'failed');assert.equal(result.verification.current,false);assert.match(JSON.stringify(result.validation),/artifact changed/i);
 },{id:'repairing-checker',verify:task=>{writeFileSync(task.artifacts![0]!.path,'repaired');return {ok:true,method:'replay'};}});
});

test('post-pass file changes invalidate current receipt and cannot silently return completed',async()=>{
 await fixture(async(h,cwd,session)=>{
  writeFileSync(join(cwd,'answer.json'),'first');const task=await h.tools.invoke('cairn_start',start) as any;
  await h.tools.invoke('cairn_finish',finish);writeFileSync(join(cwd,'answer.json'),'other');
  assert.equal(h.engine.context(task.taskId).verification?.current,false);
  await assert.rejects(h.tools.invoke('cairn_finish',{}),/changed after completion/);
  await h.tools.invoke('cairn_resume',{task_id:task.taskId,reopen_reason:'Artifact was corrected'});
  const fixed=await h.tools.invoke('cairn_finish',finish) as any;assert.equal(fixed.phase,'completed');assert.equal(fixed.verification.current,true);
 },{id:'replay',verify:()=>({ok:true,method:'replay'})});
});

test('submission files must exist and directories are not valid artifacts',async()=>{
 await fixture(async(h,cwd,session)=>{
  await h.tools.invoke('cairn_start',start);
  for(const path of ['missing.json',cwd])await assert.rejects(h.tools.invoke('cairn_checkpoint',{summary:'Attempted submission',artifacts:[{path}]}),/Cannot snapshot/);
  assert.equal(h.engine.active(session)?.artifacts,undefined);
 });
});

test('handoff survives a new native session, remains separate from final report, and resolves graph sources',async()=>{
 await fixture(async(h,cwd,session)=>{
  const started=await h.tools.invoke('cairn_start',start) as any;
  writeFileSync(join(cwd,'attempt.md'),'Exact command, input and observed output');
  const handoffs=[{key:'attempt-1',summary:'Checked input A; B remains open',report:'attempt.md',artifacts:['sample.txt'],from:['old-evidence'],next:'Try B'}];
  await h.tools.invoke('cairn_checkpoint',{summary:'Graph summary',findings:[{key:'old-evidence',text:'A fails under recorded conditions',basis:'See attempt.md',covers:[]}],handoffs});
  const first=h.engine.store.get(started.taskId);const revision=first.revision;
  await h.tools.invoke('cairn_checkpoint',{summary:'Graph summary',handoffs});assert.equal(h.engine.store.get(started.taskId).revision,revision);
  h.engine.finish(started.taskId,session,{outcome:'suspended'});
  const next={...session,sessionId:'fresh-context'};h.engine.resume(started.taskId,next,true);
  const context=h.engine.context(started.taskId,'old-evidence');assert.equal(context.handoffs[0]?.report,'attempt.md');assert.equal(context.handoffs[0]?.sessionRef,'pi:owner');assert.match(context.handoffs[0]?.from?.[0]??'',/^claim:/);assert.equal(readFileSync(join(cwd,context.handoffs[0]!.report!),'utf8'),'Exact command, input and observed output');assert.equal(h.engine.store.get(started.taskId).report?.summary,'Graph summary');
  const historical=await h.tools.invoke('cairn_read',{task_id:started.taskId,view:'handoffs',ref:'attempt-1'}) as any;assert.equal(JSON.parse(historical.chunk).next,'Try B');
 });
});

test('focused restoration preserves old dependencies ahead of recent unrelated findings',async()=>{
 await fixture(async h=>{
  const started=await h.tools.invoke('cairn_start',start) as any;
  await h.tools.invoke('cairn_checkpoint',{summary:'Evidence chain',findings:[{key:'source',text:'Old essential source',basis:'Original',covers:[]},{key:'result',text:'Conclusion',basis:'Derived',from:['source'],covers:['c1']}],handoffs:[{key:'early',summary:'Repro details',report:'early.md',from:['source']}]});
  await h.tools.invoke('cairn_checkpoint',{summary:'Later work',findings:Array.from({length:25},(_,i)=>({key:`noise-${i}`,text:`Unrelated ${i}`,basis:'Other',covers:[]}))});
  const context=await h.tools.invoke('cairn_read',{view:'context',focus:'c1'}) as any;
  assert.deepEqual(context.claims.slice(0,2).map((c:any)=>c.key),['result','source']);assert.equal(context.handoffs[0]?.key,'early');assert.ok(Buffer.byteLength(JSON.stringify(context))<=16384);assert.equal(h.engine.store.get(started.taskId).claims.length,27);
 });
});

test('handoff revisions append, unknown sources roll back, and worker cannot submit owner deliverables',async()=>{
 await fixture(async(h,cwd,session)=>{
  const started=await h.tools.invoke('cairn_start',start) as any;
  await h.tools.invoke('cairn_checkpoint',{summary:'A',handoffs:[{key:'attempt',summary:'First',report:'first.md'}]});
  await h.tools.invoke('cairn_checkpoint',{summary:'B',handoffs:[{key:'attempt',summary:'Second',report:'second.md'}]});
  await assert.rejects(h.tools.invoke('cairn_checkpoint',{summary:'Invalid',handoffs:[{key:'other',summary:'Bad link',from:['unknown']}]}),/Unknown/);
  assert.equal(h.engine.store.get(started.taskId).handoffs?.filter(h=>!h.source).length,2);
  h.engine.recordProgress(started.taskId,session,[{key:'branch',title:'Explore',status:'pending',delegated:true}]);
  const worker={...session,sessionId:'worker'};const lease=h.engine.branch(started.taskId,worker,'branch','claim');
  writeFileSync(join(cwd,'answer.json'),'answer');
  assert.throws(()=>h.engine.branch(started.taskId,worker,'branch','checkpoint',lease.leaseToken,{summary:'Sneak deliverable',artifacts:[{path:'answer.json'}]}),/owner/);
 });
});

test('host-owned artifact requirements are part of verifier identity and validate configuration',()=>{
 const command=JSON.stringify([process.execPath,'verifier.mjs']);
 assert.throws(()=>hostOptions({CAIRN_VERIFY_COMMAND:command,CAIRN_VERIFY_ARTIFACTS:'invalid'}),/JSON array/);
 const a=hostOptions({CAIRN_VERIFY_COMMAND:command}),b=hostOptions({CAIRN_VERIFY_COMMAND:command,CAIRN_VERIFY_ARTIFACTS:'["answer.json"]'});
 assert.deepEqual(b.completionVerifier?.artifacts,['answer.json']);assert.notEqual(a.completionVerifier?.id,b.completionVerifier?.id);
});

test('a new owner epoch requires fresh verification even when submitted bytes and proof are unchanged',async()=>{
 await fixture(async(h,cwd,session)=>{
  writeFileSync(join(cwd,'answer.json'),'result');const started=await h.tools.invoke('cairn_start',start) as any;
  await h.tools.invoke('cairn_checkpoint',finish);await h.engine.verify(started.taskId,session);
  assert.equal(h.engine.completionCheck(h.engine.store.get(started.taskId)).ok,true);
  h.engine.finish(started.taskId,session,{outcome:'suspended'});
  const next={...session,sessionId:'fresh-owner'};h.engine.resume(started.taskId,next,true);
  assert.equal(h.engine.context(started.taskId).verification?.current,false);
  assert.equal(h.engine.completionCheck(h.engine.store.get(started.taskId)).ok,false);
  assert.equal(h.engine.finish(started.taskId,next,{outcome:'completed'}).phase,'incomplete');
  await h.engine.verify(started.taskId,next);
  assert.equal(h.engine.finish(started.taskId,next,{outcome:'completed'}).phase,'completed');
 },{id:'epoch-checker',verify:()=>({ok:true,method:'replay'})});
});
