import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {Store} from '../src/core/store.js';
import {Engine} from '../src/core/engine.js';
import {normalize,handleNative,hookOutput,isCairnTool,observedCapabilities} from '../src/adapters/hooks.js';
import piExtension from '../src/adapters/pi-extension.js';
import type {Host,Session} from '../src/core/types.js';
import {resolveSession,ToolRuntime} from '../src/tools.js';
test('native session identity cannot be overridden by model-supplied placeholder ids',()=>{
 const s:Session={host:'pi',sessionId:'actual',cwd:'/w'};
 assert.equal(resolveSession(s,{}).sessionId,'actual');assert.throws(()=>resolveSession(s,{session_id:'placeholder'}),/authoritative/);
});

for(const host of ['pi','claude','codex'] as Host[])test(`${host}: native events capture, gate, restore and suspend consistently`,()=>{
 const store=new Store(':memory:'),engine=new Engine(store),session:Session={host,sessionId:'session',cwd:'/workspace'};
 const native=(type:string,extra:any={})=>normalize(host,host==='pi'?{type,sessionId:'session',cwd:'/workspace',...extra}:{hook_event_name:type,session_id:'session',cwd:'/workspace',...extra});
 const start=native(host==='pi'?'session_start':'SessionStart');assert.match(handleNative(engine,host,start).context!,host==='pi'?/Omit session_id/:/session_id=session/);
 const task=engine.create(session,{origin:'alert',goal:'cause',criteria:['cause']});
 const before=native(host==='pi'?'tool_call':'PreToolUse',host==='pi'?{toolName:'metrics',toolCallId:'call1',input:{query:'x'}}:{tool_name:'metrics',tool_use_id:'call1',tool_input:{query:'x'}});
 assert.deepEqual(handleNative(engine,host,before),{});
 const after=native(host==='pi'?'tool_result':'PostToolUse',host==='pi'?{toolName:'metrics',toolCallId:'call1',input:{query:'x'},content:[{type:'text',text:'healthy'}],isError:false}:{tool_name:'metrics',tool_use_id:'call1',tool_input:{query:'x'},tool_response:{content:[{type:'text',text:'healthy'}]}});
 const result=handleNative(engine,host,after);assert.match(result.context!,/Cairn E1/);handleNative(engine,host,after);
 const state=store.get(task.id);assert.equal(state.observations.length,1);assert.equal(state.observations[0]!.status,'success');assert.equal(state.observations[0]!.eligible,true);assert.equal(Object.values(state.calls)[0]!.status,'finished');
 assert.match(handleNative(engine,host,{...start,type:'RestoreContext'}).context!,/cause/);
 handleNative(engine,host,{...start,type:host==='pi'?'Settled':'Interrupt',aborted:true});assert.equal(store.get(task.id).status,'suspended');store.close();
});
test('Cairn tool calls do not recursively capture their own database traffic',()=>{
 const store=new Store(':memory:'),engine=new Engine(store),session:Session={host:'codex',sessionId:'s',cwd:'/w'};
 const task=engine.create(session,{origin:'a',goal:'b',criteria:['c']});handleNative(engine,'codex',{type:'PostToolUse',sessionId:'s',cwd:'/w',tool:'mcp__cairn__cairn_read',callId:'1',output:{}});
 assert.equal(store.get(task.id).observations.length,0);store.close();
});
test('only actual Cairn host namespaces bypass recursive capture and strict native gating',()=>{
 assert.equal(isCairnTool('pi','cairn_finish'),true);assert.equal(isCairnTool('pi','cairn_tool_metrics'),true);
 assert.equal(isCairnTool('claude','mcp__plugin_cairn_cairn__cairn_checkpoint'),true);assert.equal(isCairnTool('codex','mcp__cairn__cairn_tool_logs'),true);
 for(const name of ['mcp__other__cairn_read','not_cairn_read','cairn_fake','mcp__cairn__cairn_read_extra'])assert.equal(isCairnTool('codex',name),false);
 const store=new Store(':memory:'),engine=new Engine(store),s:Session={host:'codex',sessionId:'s',cwd:'/w'},task=engine.create(s,{origin:'a',goal:'b',criteria:['c']});
 store.transaction(()=>{const strict=store.get(task.id);strict.profile='emergency';store.save(strict,'fixture.strict',{},engine.at());});
 assert.match(handleNative(engine,'codex',{type:'PreToolUse',sessionId:'s',cwd:'/w',tool:'mcp__other__cairn_read',callId:'spoof'}).deny!,/cairn_tool/);
 assert.deepEqual(handleNative(engine,'codex',{type:'PreToolUse',sessionId:'s',cwd:'/w',tool:'mcp__cairn__cairn_tool_metrics',callId:'ours'}),{});store.close();
});
test('startup declaration and observed native capabilities remain distinguishable',()=>{
 const store=new Store(':memory:'),engine=new Engine(store),s:Session={host:'claude',sessionId:'s',cwd:'/w'};
 handleNative(engine,'claude',{type:'SessionStart',sessionId:'s',cwd:'/w'});
 const registration=store.session(s)!;assert.equal(registration.capabilities.capture,true);assert.deepEqual(observedCapabilities(registration.seen),{capture:false,preTool:false,restore:true,stop:false});
 assert.deepEqual(observedCapabilities({SessionStart:'now',PreToolUse:'now',PostToolUseFailure:'now',Stop:'now'}),{capture:true,preTool:true,restore:true,stop:true});store.close();
});
test('out-of-order native results do not leave a phantom running call',()=>{
 const store=new Store(':memory:'),engine=new Engine(store),session:Session={host:'codex',sessionId:'s',cwd:'/w'},task=engine.create(session,{origin:'a',goal:'b',criteria:['c']});
 const call={sessionId:'s',cwd:'/w',tool:'Read',callId:'late-start'};
 handleNative(engine,'codex',{...call,type:'PostToolUse',output:'complete'});
 assert.match(handleNative(engine,'codex',{...call,type:'PreToolUse'}).deny!,/captured result/);
 assert.equal(store.get(task.id).observations.length,1);assert.equal(Object.values(store.get(task.id).calls).some(c=>c.status==='running'),false);store.close();
});
test('late native results remain on their original goal after the same session switches goals',()=>{
 const store=new Store(':memory:'),engine=new Engine(store),s:Session={host:'codex',sessionId:'same',cwd:'/w'};
 const first=engine.create(s,{origin:'fixture',goal:'First',criteria:['First']});
 handleNative(engine,'codex',{type:'PreToolUse',sessionId:s.sessionId,cwd:s.cwd,tool:'Read',callId:'first-call',input:{path:'first.txt'}});
 engine.suspend(first.id,s);const second=engine.create(s,{origin:'fixture',goal:'Second',criteria:['Second']});
 const result=handleNative(engine,'codex',{type:'PostToolUse',sessionId:s.sessionId,cwd:s.cwd,tool:'Read',callId:'first-call',output:'late first result'});
 assert.match(result.context!,/eligible=false/);assert.equal(store.get(first.id).observations.length,1);assert.equal(store.get(first.id).observations[0]!.eligible,false);assert.equal(store.get(second.id).observations.length,0);
 handleNative(engine,'codex',{type:'PostToolUse',sessionId:s.sessionId,cwd:s.cwd,tool:'Read',callId:'second-call',output:'second result without pre-hook'});
 assert.equal(store.get(second.id).observations.length,1);assert.equal(store.get(second.id).observations[0]!.eligible,true);store.close();
});
for(const host of ['pi','claude','codex'] as Host[])test(`${host}: native evidence aliases drive one checkpoint and cross-CLI recovery`,async()=>{
 const store=new Store(':memory:'),engine=new Engine(store),session:Session={host,sessionId:'original',cwd:'/w'},runtime=new ToolRuntime(engine,host==='pi'?session:{...session,sessionId:''});
 handleNative(engine,host,{type:'SessionStart',sessionId:session.sessionId,cwd:session.cwd});
 try{
  const started:any=await runtime.invoke('cairn_start',{goal:'Verify marker',criteria:['Marker exists'],...(host==='pi'?{}:{session_id:session.sessionId})});
  handleNative(engine,host,{type:'PreToolUse',sessionId:session.sessionId,cwd:session.cwd,tool:'read',callId:'native-1',input:{path:'evidence.txt'}});
  const receipt=handleNative(engine,host,{type:'PostToolUse',sessionId:session.sessionId,cwd:session.cwd,tool:'read',callId:'native-1',input:{path:'evidence.txt'},output:{marker:'verified'}});assert.match(receipt.context!,/Cairn E1/);
  await runtime.invoke('cairn_checkpoint',{summary:'Marker verified',findings:[{key:'marker',text:'Marker exists',evidence:['E1'],covers:['c1']}],questions:[]});
  const compact=handleNative(engine,host,{type:'PostCompact',sessionId:session.sessionId,cwd:session.cwd});assert.match(compact.context!,/Marker verified/);
  handleNative(engine,host,{type:host==='pi'?'Settled':'Interrupt',sessionId:session.sessionId,cwd:session.cwd,aborted:true});assert.equal(store.get(started.taskId).status,'suspended');
  const nextHost:Host=host==='pi'?'claude':host==='claude'?'codex':'pi',next:Session={host:nextHost,sessionId:'next',cwd:'/w'},resumed=new ToolRuntime(engine,next);
  handleNative(engine,nextHost,{type:'SessionStart',sessionId:'next',cwd:'/w'});
  try{
   await assert.rejects(resumed.invoke('cairn_resume',{task_id:started.taskId}),/takeover/);
   await resumed.invoke('cairn_resume',{task_id:started.taskId,takeover:true});const state:any=await resumed.invoke('cairn_read',{});assert.match(JSON.stringify(state),/Marker verified/);
   await assert.rejects(runtime.invoke('cairn_finish',{}),/owner|owns|takeover/);
   await resumed.invoke('cairn_finish',{});const task=store.get(started.taskId);assert.equal(task.status,'completed');assert.equal(task.owner.epoch,2);assert.equal(task.claims.length,1);assert.equal(task.report!.citations[0]!.observationId,task.observations[0]!.id);
  }finally{await resumed.close();}
 }finally{await runtime.close();store.close();}
});
test('Pi tool registration follows actual contexts, compaction and session replacement',async()=>{
 const root=mkdtempSync(join(tmpdir(),'cairn-pi-adapter-')),handlers=new Map<string,any>(),tools=new Map<string,any>(),messages:any[]=[];
 const pi={on:(name:string,handler:any)=>handlers.set(name,handler),registerTool:(tool:any)=>tools.set(tool.name,tool),registerCommand:()=>{},sendMessage:(message:any,options:any)=>messages.push({message,options})};
 piExtension(pi);assert.equal(tools.size,5);for(const tool of tools.values())assert.equal(tool.parameters.properties?.session_id,undefined);
 const context=(id:string)=>({cwd:root,sessionManager:{getSessionId:()=>id},ui:{notify:()=>{}}}),first=context('first'),second=context('second');
 const emit=(name:string,ctx:any,extra:any={})=>handlers.get(name)({type:name,...extra},ctx),call=(name:string,input:any,ctx:any)=>tools.get(name).execute('cairn-call',input,undefined,undefined,ctx);
 try{
  await emit('session_start',first);const a=await call('cairn_start',{goal:'First goal'},first);assert.equal(a.details.owner.sessionId,'first');
  await assert.rejects(call('cairn_start',{goal:'Spoofed',session_id:'placeholder'},first),/authoritative/);
  await emit('session_before_compact',first);await emit('session_compact',first);assert.equal(messages.at(-1).options.triggerTurn,false);assert.match(messages.at(-1).message.content,/First goal/);
  await emit('agent_settled',first,{aborted:true});assert.equal((await call('cairn_read',{},first)).details.status,'suspended');
  await emit('session_start',second);const b=await call('cairn_start',{goal:'Second goal'},second);assert.equal(b.details.owner.sessionId,'second');assert.notEqual(a.details.taskId,b.details.taskId);
  assert.match((await emit('before_agent_start',second)).message.content,/Second goal/);
 }finally{await emit('session_shutdown',second);await emit('session_shutdown',second);rmSync(root,{recursive:true});}
});
test('Pi dynamically exposes original upstream arguments and withdraws removed whitelist tools',async()=>{
 const root=mkdtempSync(join(tmpdir(),'cairn-pi-dynamic-')),handlers=new Map<string,any>(),tools=new Map<string,any>();
 const pi={on:(name:string,handler:any)=>handlers.set(name,handler),registerTool:(tool:any)=>tools.set(tool.name,tool),registerCommand:()=>{},sendMessage:()=>{}},ctx={cwd:root,sessionManager:{getSessionId:()=> 'native'},ui:{notify:()=>{}}};
 piExtension(pi);const emit=(name:string,extra:any={})=>handlers.get(name)({type:name,...extra},ctx),call=(name:string,input:any)=>tools.get(name).execute('execute',input,undefined,undefined,ctx);
 let configStore:Store|undefined;
 try{
  await emit('session_start');await call('cairn_start',{goal:'Read upstream'});
  configStore=new Store(join(root,'.cairn/state.db'));
  configStore.setConfig('gateway',{servers:{fixture:{command:process.execPath,args:[resolve('tests/fixtures/upstream.mjs')]}},tools:[{name:'metrics',server:'fixture',upstream:'read',resultRefPath:'result_ref'}]});
  await emit('before_agent_start');const dynamic=tools.get('cairn_tool_metrics');assert.ok(dynamic);assert.equal(dynamic.parameters.properties.tool,undefined);assert.equal(dynamic.parameters.properties.arguments,undefined);
  assert.equal(await emit('tool_call',{toolName:'cairn_tool_metrics',toolCallId:'dynamic',input:{}}),undefined);
  const result=await call('cairn_tool_metrics',{});assert.equal(result.details.evidence.ref,'E1');assert.equal(result.details.evidence.resultRef,'ref-read');
  assert.equal(await emit('tool_result',{toolName:'cairn_tool_metrics',toolCallId:'dynamic',input:{},content:result.content}),undefined);
  const task=configStore.get(configStore.list()[0]!.id);assert.equal(task.observations.length,1);assert.equal(task.observations[0]!.source,'gateway');
  configStore.setConfig('gateway',{servers:{},tools:[]});await emit('before_agent_start');assert.equal(tools.get('cairn_tool_metrics').exposure,'hidden');
  await assert.rejects(call('cairn_tool_metrics',{}),/Unknown tool/);
 }finally{configStore?.close();await emit('session_shutdown');rmSync(root,{recursive:true});}
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
