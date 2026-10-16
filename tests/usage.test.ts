import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, appendFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store } from '../src/core/store.js';
import { Engine } from '../src/core/engine.js';
import { toolUsage, tokenUsage, emptyTokens } from '../src/core/usage.js';
import { handleNative } from '../src/adapters/hooks.js';
import { piTokens, transcriptUsage, syncTranscriptUsage } from '../src/adapters/usage.js';
import { projectTask } from '../src/ui/view.js';
import { usageTime } from '../src/ui/usage.js';
import type { Host, Session } from '../src/core/types.js';
function fixture(host:Host='pi'){
 let time=Date.parse('2026-10-16T00:00:00Z');
 const store=new Store(':memory:'),engine=new Engine(store,()=>new Date(time));
 const session:Session={host,sessionId:'main',cwd:'/work'};
 const task=engine.create(session,{origin:'Test',goal:'Verify',criteria:['done'],evidenceMode:'curated'});
 return {store,engine,session,task,advance:(ms:number)=>time+=ms};
}
for(const host of ['pi','claude','codex'] as Host[])test(`${host}: numeric tool counts deduplicate, hide content and preserve semantic checks`,()=>{
 const f=fixture(host),{store,engine,session,task}=f;
 const event={sessionId:session.sessionId,cwd:session.cwd,callId:'sensitive-id',tool:'SECRET_TOOL_NAME',input:'SECRET_INPUT',output:'SECRET_OUTPUT'};
 handleNative(engine,host,{...event,type:'PreToolUse'});
 assert.equal(store.get(task.id).usage,undefined,'a requested or blocked call is not a completed execution');
 handleNative(engine,host,{...event,type:'PostToolUse'});
 handleNative(engine,host,{...event,type:'PostToolUseFailure',isError:true});
 const local=host==='pi'?'cairn_read':`mcp__cairn__cairn_read`;
 handleNative(engine,host,{...event,callId:'cairn',tool:local,type:'PreToolUse'});
 handleNative(engine,host,{...event,callId:'cairn',tool:local,type:'PostToolUse'});
 handleNative(engine,host,{...event,callId:'failure',type:'PreToolUse'});
 handleNative(engine,host,{...event,callId:'failure',type:'PostToolUseFailure',isError:true});
 const state=store.get(task.id);assert.equal(state.usage?.toolCalls,2);assert.equal(state.usage?.cairnCalls,1);assert.equal(state.usage?.toolErrors,1);
 assert.equal(state.revision,task.revision);assert.deepEqual(state.calls,{});assert.deepEqual(state.observations,[]);
 const persisted=JSON.stringify([state,store.events(task.id),store.db.prepare('SELECT * FROM usage_samples').all()]);
 assert.doesNotMatch(persisted,/SECRET_|sensitive-id/);
 const frames=store.events(task.id).filter(e=>e.kind==='usage.updated');
 assert.equal(store.historical(task.id,frames[0]!.seq).task.usage?.toolCalls,1);
 assert.equal(projectTask(engine,state).resourceUsage.toolCalls,2);
 store.close();
});
test('tool receipts attribute delayed results to the original task and fence taken-over epochs',()=>{
 const {engine,store,task,session}=fixture();
 toolUsage(engine,session,'old','start',false);engine.suspend(task.id,session);
 const next=engine.create(session,{origin:'next',goal:'Next',criteria:['done'],evidenceMode:'curated'});
 toolUsage(engine,session,'unreserved-old','end',false);assert.equal(store.get(next.id).usage,undefined,'a return without an original reservation cannot be guessed onto a new task');
 toolUsage(engine,session,'old','end',false);assert.equal(store.get(task.id).usage?.toolCalls,1);assert.equal(store.get(next.id).usage,undefined);
 engine.suspend(next.id,session);engine.resume(task.id,{...session,sessionId:'new'},true);
 toolUsage(engine,session,'old-late','end',false);assert.equal(store.get(task.id).usage?.toolCalls,1);
 store.close();
});
test('token totals use actual input/output, include cache once and reject invalid or repeated samples',()=>{
 const {engine,store,task,session}=fixture();
 const usage=piTokens({input:100,output:30,cacheRead:20,cacheWrite:5})!;
 assert.equal(usage.input,125);tokenUsage(engine,session,'a',usage,{modelCall:true});tokenUsage(engine,session,'a',usage,{modelCall:true});
 tokenUsage(engine,session,'bad',{...usage,input:-1});
 const view=projectTask(engine,store.get(task.id));assert.equal(view.resourceUsage.tokens?.total,155);assert.equal(view.resourceUsage.modelCalls,1);
 assert.equal(view.resourceUsage.tokens?.cacheRead,20);assert.equal(view.resourceUsage.toolCalls,null);
 engine.suspend(task.id,session);tokenUsage(engine,session,'unrelated',usage);assert.equal(store.get(task.id).usage?.tokens?.input,125);
 store.close();
});
test('an explicitly reported zero is distinguishable from unavailable usage',()=>{
 const {engine,store,session,task}=fixture();
 tokenUsage(engine,session,'zero',emptyTokens(),{modelCall:true});
 const view=projectTask(engine,store.get(task.id));assert.equal(view.resourceUsage.tokens?.total,0);assert.equal(view.resourceUsage.modelCalls,1);
 tokenUsage(engine,session,'zero',emptyTokens(),{modelCall:true});assert.equal(store.get(task.id).usage?.modelCalls,1);store.close();
});
test('cumulative snapshots baseline existing tokens, survive restart and cannot rewind on old hooks',()=>{
 const {engine,store,session,task}=fixture('codex');
 const sample=(input:number,output:number)=>({...emptyTokens(),input,output});
 tokenUsage(engine,session,'stream',sample(1000,100),{baseline:true,cumulative:true});
 tokenUsage(engine,session,'stream',sample(1200,150),{cumulative:true});
 tokenUsage(new Engine(store),session,'stream',sample(1200,150),{cumulative:true});
 tokenUsage(engine,session,'stream',sample(1100,125),{cumulative:true});
 tokenUsage(engine,session,'stream',sample(1300,170),{cumulative:true});
 assert.equal(store.get(task.id).usage?.tokens?.input,300);assert.equal(store.get(task.id).usage?.tokens?.output,70);
 assert.equal(store.get(task.id).usage?.modelCalls,undefined,'a cumulative token counter cannot prove the model call count');store.close();
});
test('hook transcript adapter reads only appended usage metadata, deduplicates partial Claude messages and ignores arbitrary text',()=>{
 const root=mkdtempSync(join(tmpdir(),'cairn-usage-'));
 try{
  for(const host of ['codex','claude'] as const){
   const {engine,store,session,task}=fixture(host),path=join(root,`${host}.jsonl`);
   const line=(input:number,output:number)=>JSON.stringify(host==='codex'?{type:'event_msg',payload:{type:'token_count',info:{total_token_usage:{input_tokens:input,output_tokens:output,cached_input_tokens:5,reasoning_output_tokens:2}}}}:{type:'assistant',message:{id:'native-response',usage:{input_tokens:input,output_tokens:output,cache_read_input_tokens:5},content:[{text:'SECRET_MESSAGE'}]}})+'\n';
   writeFileSync(path,line(100,10));syncTranscriptUsage(engine,session,path,true);assert.equal(store.get(task.id).usage,undefined);
   appendFileSync(path,host==='codex'?line(120,15):JSON.stringify({type:'assistant',message:{id:'new-response',usage:{input_tokens:20,output_tokens:5}}})+'\n');
   syncTranscriptUsage(engine,session,path);syncTranscriptUsage(engine,session,path);
   assert.equal(store.get(task.id).usage?.tokens?.input,20);assert.equal(store.get(task.id).usage?.tokens?.output,5);
   appendFileSync(path,'{"type":"user","message":"SECRET_PROMPT"}\n');syncTranscriptUsage(engine,session,path);
   assert.doesNotMatch(JSON.stringify([store.get(task.id),store.events(task.id),store.db.prepare('SELECT * FROM usage_samples').all(),store.db.prepare('SELECT * FROM config').all()]),/SECRET_|native-response|new-response/);
   store.close();
  }
  assert.equal(transcriptUsage('codex',{type:'tool',usage:{input:999}}),undefined);
 }finally{rmSync(root,{recursive:true,force:true});}
});
test('first valid cumulative metadata is a baseline even when older usage was unavailable',()=>{
 const {engine,store,session,task}=fixture('codex');
 tokenUsage(engine,session,'late-first',{...emptyTokens(),input:900,output:90},{cumulative:true});
 assert.equal(store.get(task.id).usage,undefined);
 tokenUsage(engine,session,'late-first',{...emptyTokens(),input:920,output:95},{cumulative:true});
 assert.equal(store.get(task.id).usage?.tokens?.input,20);store.close();
});
test('legacy stopped tasks keep their actual stop time after later feedback',()=>{
 const {engine,store,task,session,advance}=fixture();advance(10000);
 engine.checkpoint(task.id,session,{summary:'Done',findings:[{key:'f',text:'Done',basis:'Verified',covers:['c1']}]});engine.finish(task.id,session,{outcome:'completed',summary:'Done'});
 const old=store.get(task.id);delete old.timing;store.db.prepare('UPDATE tasks SET state=? WHERE id=?').run(JSON.stringify(old),old.id);
 advance(60000);engine.feedback(task.id,{text:'More context',author:'Tester'});
 const view=projectTask(engine,store.get(task.id));assert.equal(view.resourceUsage.activeMs,null);assert.equal(view.resourceUsage.wallMs,10000);store.close();
});
test('execution time freezes on pause, adds resumed epochs, closes on completion and follows historical time',()=>{
 const {engine,store,task,session,advance}=fixture();
 advance(10000);let current=store.get(task.id);assert.equal(usageTime(current,engine.now().getTime(),engine.at()).activeMs,10000);
 engine.suspend(task.id,session);const paused=store.events(task.id).at(-1)!;
 advance(60000);current=store.get(task.id);assert.equal(usageTime(current,engine.now().getTime(),engine.at()).activeMs,10000);assert.equal(usageTime(current,engine.now().getTime(),engine.at()).wallMs,70000);
 engine.resume(task.id,session);advance(5000);
 engine.checkpoint(task.id,session,{summary:'Verified',findings:[{key:'f',text:'Done',basis:'Actual validation',covers:['c1']}]});
 engine.finish(task.id,session,{outcome:'completed',summary:'Verified'});
 current=store.get(task.id);assert.equal(current.status,'completed');advance(30000);
 const view=projectTask(engine,current);assert.equal(view.resourceUsage.activeMs,15000);assert.equal(view.resourceUsage.wallMs,75000);
 const history=store.historical(task.id,paused.seq);assert.equal(projectTask(engine,history.task,history.at).resourceUsage.activeMs,10000);
 engine.reopen(task.id,session,'New evidence');advance(3000);assert.equal(projectTask(engine,store.get(task.id)).resourceUsage.activeMs,18000);
 const legacy={...current};delete legacy.timing;delete legacy.usage;
 assert.equal(projectTask(engine,legacy).resourceUsage.activeMs,null);assert.equal(projectTask(engine,legacy).resourceUsage.tokens,null);store.close();
});
