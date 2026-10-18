import {test} from 'node:test';
import assert from 'node:assert/strict';
import {AjvJsonSchemaValidator} from '@modelcontextprotocol/sdk/validation/ajv';
import {createHarness, Engine, Store, type CompletionVerifier, type Session} from '../src/index.js';
import {coreCatalog,ToolRuntime} from '../src/tools.js';
import {handleNative} from '../src/adapters/hooks.js';
import {hostOptions} from '../src/adapters/host-options.js';
const session:Session={host:'pi',sessionId:'verification-owner',cwd:process.cwd()};
const input={origin:'user',goal:'Verify the delivered artifact',criteria:['Output matches evidence'],evidenceMode:'curated' as const};
const toolInput={origin:input.origin,goal:input.goal,criteria:input.criteria,evidence_mode:'curated'};
const final={outcome:'completed' as const,summary:'Result verified',findings:[{key:'result',text:'Output matches evidence',basis:'Read the original and compared output'}]};

test('published conditional checkpoint schema matches runtime and gives an actionable correction',async()=>{
 const schema=coreCatalog().find(t=>t.name==='cairn_checkpoint')!.inputSchema;
 // Some providers require types in each conditional branch despite root declarations.
 for(const branch of (schema as any).anyOf){assert.equal(branch.type,'object');for(const property of Object.values(branch.properties) as any[])assert.equal(typeof property.type,'string');}
 const validate=new AjvJsonSchemaValidator().getValidator(schema);
 assert.equal(validate({}).valid,false);assert.equal(validate({summary:'Checked'}).valid,false);assert.equal(validate({next:'Check alternative'}).valid,true);
 for(const branch_action of ['claim','heartbeat','release','merge'])assert.equal(validate({branch_action,progress_key:'branch'}).valid,true);
 assert.equal(validate({branch_action:'checkpoint',progress_key:'branch'}).valid,false);
 const h=createHarness({database:':memory:',session});try{
  await h.tools.invoke('cairn_start',{goal:'Check contract'});
  await assert.rejects(h.tools.invoke('cairn_checkpoint',{}),/requires summary.*Example/);
  await assert.rejects(h.tools.invoke('cairn_checkpoint',{}),/Do not repeat/);
  const saved=await h.tools.invoke('cairn_checkpoint',{summary:'Checked'}) as any;assert.equal(saved.status,'active');
 }finally{await h.close();}
});

test('compact mutation receipts preserve full canonical findings and explicit criteria',async()=>{
 const h=createHarness({database:':memory:',session});try{
  const task=await h.tools.invoke('cairn_start',{goal:'Retain full evidence',criteria:['Artifact','Evidence','Alternatives','Consistency']}) as any;
  const text='Long finding '.repeat(500);
  const result=await h.tools.invoke('cairn_checkpoint',{summary:'Saved',findings:Array.from({length:30},(_,i)=>({key:`f${i}`,text,basis:'Read source',covers:[]}))}) as any;
  assert.ok(Buffer.byteLength(JSON.stringify(result))<5500);
  assert.equal(h.engine.store.get(task.taskId).claims.length,30);assert.equal(h.engine.store.get(task.taskId).claims[0]!.text,text.trim());
  const context=await h.tools.invoke('cairn_read',{}) as any;assert.equal(context.totals.criteria,4);assert.equal(context.totals.claims,30);assert.ok(context.truncated.claims>0);
 }finally{await h.close();}
});

test('host verifier runs outside transactions, gates completion and preserves failed candidates',async()=>{
 let accepts=false,calls=0;const store=new Store(':memory:');
 const verifier:CompletionVerifier={id:'fixture:artifact',verify:async task=>{calls++;store.transaction(()=>true);assert.equal(task.report?.summary,'Result verified');return accepts?{ok:true}:{ok:false,issues:[{message:'Artifact contradicts source',claims:['result'],references:['artifact.json']}]};}};
 const engine=new Engine(store,undefined,{completionVerifier:verifier}),runtime=new ToolRuntime(engine,session);
 try{
  const task=await runtime.invoke('cairn_start',toolInput) as any;
  const failed=await runtime.invoke('cairn_finish',final) as any;
  assert.equal(failed.phase,'incomplete');assert.equal(failed.verification.status,'failed');assert.equal(store.get(task.taskId).report?.summary,'Result verified');assert.equal(store.get(task.taskId).claims.length,1);
  accepts=true;const passed=await runtime.invoke('cairn_finish',{}) as any;assert.equal(passed.phase,'completed');assert.equal(passed.verification.status,'passed');assert.equal(calls,2);
  await runtime.invoke('cairn_finish',{});assert.equal(calls,2,'idempotent completed retry');
 }finally{await runtime.close();store.close();}
});

test('verifier unavailable and malformed responses are explicit errors, never successful completion',async()=>{
 for(const verify of [()=>{throw new Error('Unavailable');},()=>({ok:true,issues:[{message:'Contradiction'}]})]){
  const h=createHarness({database:':memory:',session,completionVerifier:{id:'fixture:error',verify}});
  try{await h.tools.invoke('cairn_start',toolInput);const result=await h.tools.invoke('cairn_finish',final) as any;assert.equal(result.status,'active');assert.equal(result.verification.status,'error');assert.equal(result.validation.ok,false);}finally{await h.close();}
 }
});

test('a late external verifier cannot complete a changed or interrupted task',async()=>{
 for(const interrupt of [false,true]){
  let release!:()=>void;const wait=new Promise<void>(resolve=>{release=resolve;});
  const h=createHarness({database:':memory:',session,completionVerifier:{id:'fixture:race',verify:async()=>{await wait;return {ok:true};}}});
  try{
   const task=await h.tools.invoke('cairn_start',toolInput) as any;
   const finishing=h.tools.invoke('cairn_finish',final);await new Promise(resolve=>setImmediate(resolve));
   if(interrupt)h.engine.suspend(task.taskId,session);else h.engine.checkpoint(task.taskId,session,{summary:'New evidence',findings:[{key:'result',text:'Revised',basis:'New source'}]});
   release();await assert.rejects(finishing,/changed|refresh|epoch|inactive/i);assert.notEqual(h.engine.store.get(task.taskId).status,'completed');assert.equal(h.engine.store.get(task.taskId).verification,undefined);
  }finally{release();await h.close();}
 }
});

test('post-completion counterevidence reuses reopen snapshots, attribution and epoch fencing',async()=>{
 let accepts=true;const h=createHarness({database:':memory:',session,completionVerifier:{id:'fixture:followup',verify:()=>accepts?{ok:true}:{ok:false,issues:[{message:'Independent regression disproved result',claims:['result'],references:['regression.json']}]}}});
 try{
  const task=await h.tools.invoke('cairn_start',toolInput) as any;await h.tools.invoke('cairn_finish',final);
  const before=h.engine.store.get(task.taskId);accepts=false;await h.engine.verify(task.taskId,session);
  const reopened=h.engine.store.get(task.taskId);assert.equal(reopened.status,'active');assert.equal(reopened.owner.epoch,before.owner.epoch+1);assert.equal(reopened.claims[0]!.status,'proposed');assert.equal(reopened.claims[0]!.history?.at(-1)?.status,'supported');assert.deepEqual(reopened.criteria[0]!.claimIds,[]);
  assert.equal(reopened.claims.at(-1)!.provenance,'verifier');assert.ok(h.engine.store.events(task.taskId).some(e=>e.kind==='task.reopened'&&e.payload.previous.report.summary==='Result verified'));
  await assert.rejects(h.tools.invoke('cairn_checkpoint',{summary:'Stale connection'}),/epoch|resume|no longer owns/);
 }finally{await h.close();}
});

test('host deadline is strictest, reserve works without progress, reminders are bounded and curated tools stay uncaptured',()=>{
 let time=Date.parse('2026-10-16T10:00:00Z');const store=new Store(':memory:');
 const engine=new Engine(store,()=>new Date(time),{hostBudget:{deadline:'2026-10-16T10:02:00Z',submitReserveMs:30000}});
 try{
  const task=engine.create(session,{...input,budget:{deadline:'2026-10-16T11:00:00Z'}});assert.equal(task.budget.deadline,'2026-10-16T10:02:00Z');assert.equal(engine.budgetGuidance(task.id,session),undefined);
  time+=95000;const event={type:'PostToolUse',sessionId:session.sessionId,cwd:session.cwd,tool:'read',callId:'native',input:{path:'file'},output:'data'};
  assert.match(handleNative(engine,'pi',event).context!,/25 seconds remain/);assert.equal(engine.budgetGuidance(task.id,session),undefined);assert.equal(store.get(task.id).observations.length,0);assert.equal(Object.keys(store.get(task.id).calls).length,0);
  time+=30000;assert.match(engine.budgetGuidance(task.id,session)!,/expired/);assert.equal(engine.budgetGuidance(task.id,session),undefined);
  engine.suspend(task.id,session);assert.equal(engine.budgetGuidance(task.id,session),undefined);
 }finally{store.close();}
});

test('task completion and host settled/closed facts remain distinct',()=>{
 const store=new Store(':memory:'),engine=new Engine(store);try{
  const task=engine.create(session,input);engine.finish(task.id,session,final);
  handleNative(engine,'pi',{type:'Settled',sessionId:session.sessionId,cwd:session.cwd});handleNative(engine,'pi',{type:'SessionEnd',sessionId:session.sessionId,cwd:session.cwd});
  const saved=store.get(task.id);assert.equal(saved.status,'completed');assert.equal(saved.execution?.state,'closed');assert.ok(saved.execution?.settledAt);assert.ok(saved.execution?.closedAt);
 }finally{store.close();}
});

test('host environment validates explicit budgets and verifier argv without a shell',async()=>{
 assert.throws(()=>hostOptions({CAIRN_DEADLINE:'bad'}),/Invalid/);assert.throws(()=>hostOptions({CAIRN_VERIFY_COMMAND:'echo unsafe'}),/JSON argv/);
 const config=hostOptions({PATH:process.env.PATH,CAIRN_VERIFY_COMMAND:JSON.stringify([process.execPath,'-e','process.stdin.resume();process.stdin.on("end",()=>console.log(JSON.stringify({ok:true})))'])});
 const h=createHarness({database:':memory:',session,...config});try{await h.tools.invoke('cairn_start',toolInput);const result=await h.tools.invoke('cairn_finish',final) as any;assert.equal(result.phase,'completed');assert.equal(result.verification.status,'passed');}finally{await h.close();}
});

test('unknown verifier attribution cannot preserve an obsolete passing completion',async()=>{
 let accepts=true;const h=createHarness({database:':memory:',session,completionVerifier:{id:'fixture:bad-link',verify:()=>accepts?{ok:true}:{ok:false,issues:[{message:'Regression failed with an unknown finding link',claims:['missing-finding']}]}}});
 try{
  const started=await h.tools.invoke('cairn_start',toolInput) as any;await h.tools.invoke('cairn_finish',final);accepts=false;
  await h.engine.verify(started.taskId,session);
  const task=h.engine.store.get(started.taskId);assert.equal(task.status,'active');assert.equal(task.verification?.status,'failed');assert.deepEqual(task.criteria[0]!.claimIds,[]);
  assert.deepEqual(task.verification?.issues[0]?.claims,['missing-finding']);assert.ok(h.engine.store.events(task.id).some(e=>e.kind==='task.verified'&&(e.payload.verification as any)?.status==='passed'));
 }finally{await h.close();}
});

test('resumed and reopened tasks inherit the stricter host deadline and reserve',()=>{
 const store=new Store(':memory:'),initial=new Engine(store,()=>new Date('2026-10-16T10:00:00Z'));
 try{
  const task=initial.create(session,input);initial.suspend(task.id,session);
  const next=new Engine(store,initial.now,{hostBudget:{deadline:'2026-10-16T10:00:20Z',submitReserveMs:30000}});
  next.resume(task.id,session);assert.match(next.budgetGuidance(task.id,session)!,/20 seconds remain/);
  next.finish(task.id,session,final);
  const later=new Engine(store,initial.now,{hostBudget:{deadline:'2026-10-16T10:00:15Z',submitReserveMs:40000}});
  later.reopen(task.id,session,'New independent check');const saved=store.get(task.id);
  assert.equal(saved.budget.deadline,'2026-10-16T10:00:15Z');assert.equal(saved.budget.submitReserveMs,40000);assert.match(later.budgetGuidance(task.id,session)!,/15 seconds remain/);
 }finally{store.close();}
});

test('host verifier timeout is bounded even when descendants inherit its pipes',async()=>{
 const script='require("node:child_process").spawn(process.execPath,["-e","setTimeout(()=>{},5000)"],{stdio:["ignore",1,2]});setTimeout(()=>{},5000)';
 const config=hostOptions({PATH:process.env.PATH,CAIRN_VERIFY_TIMEOUT_MS:'250',CAIRN_VERIFY_COMMAND:JSON.stringify([process.execPath,'-e',script])});
 const h=createHarness({database:':memory:',session,...config});try{
  const task=await h.tools.invoke('cairn_start',toolInput) as any;const begin=performance.now();const result=await h.tools.invoke('cairn_finish',final) as any;
  assert.ok(performance.now()-begin<2500,'Timeout must not wait for descendant pipes');assert.equal(result.verification.status,'error');assert.match(h.engine.store.get(task.taskId).verification!.issues[0]!.message,/timed out/);
 }finally{await h.close();}
});
