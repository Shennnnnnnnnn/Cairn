import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../src/core/store.js';
import {Engine} from '../src/core/engine.js';
import {normalize,handleNative,hookOutput} from '../src/adapters/hooks.js';
import type {Host,Session} from '../src/core/types.js';
import {resolveSession} from '../src/tools.js';
test('native session identity cannot be overridden by model-supplied placeholder ids',()=>{
 const s:Session={host:'pi',sessionId:'actual',cwd:'/w'};
 assert.equal(resolveSession(s,{}).sessionId,'actual');assert.throws(()=>resolveSession(s,{session_id:'placeholder'}),/authoritative/);
});

for(const host of ['pi','claude','codex'] as Host[])test(`${host}: native events capture, gate, restore and suspend consistently`,()=>{
 const store=new Store(':memory:'),engine=new Engine(store),session:Session={host,sessionId:'session',cwd:'/workspace'};
 const native=(type:string,extra:any={})=>normalize(host,host==='pi'?{type,sessionId:'session',cwd:'/workspace',...extra}:{hook_event_name:type,session_id:'session',cwd:'/workspace',...extra});
 const start=native(host==='pi'?'session_start':'SessionStart');assert.match(handleNative(engine,host,start).context!,/session_id=session/);
 const task=engine.create(session,{origin:'alert',goal:'cause',criteria:['cause']});
 const before=native(host==='pi'?'tool_call':'PreToolUse',host==='pi'?{toolName:'metrics',toolCallId:'call1',input:{query:'x'}}:{tool_name:'metrics',tool_use_id:'call1',tool_input:{query:'x'}});
 assert.deepEqual(handleNative(engine,host,before),{});
 const after=native(host==='pi'?'tool_result':'PostToolUse',host==='pi'?{toolName:'metrics',toolCallId:'call1',input:{query:'x'},content:[{type:'text',text:'healthy'}],isError:false}:{tool_name:'metrics',tool_use_id:'call1',tool_input:{query:'x'},tool_response:{content:[{type:'text',text:'healthy'}]}});
 const result=handleNative(engine,host,after);assert.match(result.context!,/observation/);handleNative(engine,host,after);
 const state=store.get(task.id);assert.equal(state.observations.length,1);assert.equal(state.observations[0]!.status,'success');assert.equal(state.observations[0]!.eligible,true);assert.equal(Object.values(state.calls)[0]!.status,'finished');
 assert.match(handleNative(engine,host,{...start,type:'RestoreContext'}).context!,/cause/);
 handleNative(engine,host,{...start,type:host==='pi'?'Settled':'Interrupt',aborted:true});assert.equal(store.get(task.id).status,'suspended');store.close();
});
test('Cairn tool calls do not recursively capture their own database traffic',()=>{
 const store=new Store(':memory:'),engine=new Engine(store),session:Session={host:'codex',sessionId:'s',cwd:'/w'};
 const task=engine.create(session,{origin:'a',goal:'b',criteria:['c']});handleNative(engine,'codex',{type:'PostToolUse',sessionId:'s',cwd:'/w',tool:'mcp__cairn__cairn_state',callId:'1',output:{}});
 assert.equal(store.get(task.id).observations.length,0);store.close();
});
test('hook output conforms to supported event-specific contracts',()=>{
 const event={type:'Stop',sessionId:'s',cwd:'/w'};
 assert.deepEqual(hookOutput(event,{continue:'continue'}),{decision:'block',reason:'continue'});
 assert.deepEqual(hookOutput({...event,type:'Interrupt'},{}),{});
 assert.deepEqual(hookOutput({...event,type:'PreToolUse'},{deny:'budget'}),{hookSpecificOutput:{hookEventName:'PreToolUse',permissionDecision:'deny',permissionDecisionReason:'budget'}});
});
test('failure events do not become successful evidence',()=>{
 const store=new Store(':memory:'),engine=new Engine(store),s:Session={host:'claude',sessionId:'s',cwd:'/w'};const task=engine.create(s,{origin:'a',goal:'b',criteria:['c']});
 handleNative(engine,'claude',normalize('claude',{hook_event_name:'PostToolUseFailure',session_id:'s',cwd:'/w',tool_name:'Bash',tool_use_id:'fail',tool_input:{command:'false'},error:'exit 1'}));
 assert.equal(store.get(task.id).observations[0]!.status,'error');store.close();
});
test('suspending Cairn restores ordinary CLI tools without capturing unrelated follow-up work',()=>{
 const store=new Store(':memory:'),engine=new Engine(store),s:Session={host:'codex',sessionId:'s',cwd:'/w'};
 const task=engine.create(s,{origin:'a',goal:'b',criteria:['c']});engine.suspend(task.id,s);
 assert.deepEqual(handleNative(engine,'codex',{type:'PreToolUse',sessionId:'s',cwd:'/w',tool:'Read',callId:'later'}),{});
 handleNative(engine,'codex',{type:'PostToolUse',sessionId:'s',cwd:'/w',tool:'Read',callId:'later',output:'ordinary work'});
 assert.equal(store.get(task.id).observations.length,0);store.close();
});
