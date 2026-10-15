import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {Store} from '../src/core/store.js';
import {Engine} from '../src/core/engine.js';
import {normalize,handleNative,hookOutput,isCairnTool,observedCapabilities,nativeProgress} from '../src/adapters/hooks.js';
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
test('only actual Cairn host namespaces bypass recursive capture',()=>{
 assert.equal(isCairnTool('pi','cairn_finish'),true);assert.equal(isCairnTool('pi','cairn_tool_metrics'),true);
 assert.equal(isCairnTool('claude','mcp__plugin_cairn_cairn__cairn_checkpoint'),true);assert.equal(isCairnTool('codex','mcp__cairn__cairn_tool_logs'),true);
 for(const name of ['mcp__other__cairn_read','not_cairn_read','cairn_fake','mcp__cairn__cairn_read_extra'])assert.equal(isCairnTool('codex',name),false);
 const store=new Store(':memory:'),engine=new Engine(store),s:Session={host:'codex',sessionId:'s',cwd:'/w'},task=engine.create(s,{origin:'a',goal:'b',criteria:['c']});
 assert.deepEqual(handleNative(engine,'codex',{type:'PreToolUse',sessionId:'s',cwd:'/w',tool:'mcp__other__cairn_read',callId:'spoof'}),{});assert.ok(store.get(task.id).calls['codex:s:spoof']);
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
  const started:any=await runtime.invoke('cairn_start',{goal:'Verify marker',criteria:['Marker exists'],evidence_mode:'captured',...(host==='pi'?{}:{session_id:session.sessionId})});
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
 piExtension(pi);assert.equal(tools.size,6);for(const tool of tools.values())assert.equal(tool.parameters.properties?.session_id,undefined);
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
  await emit('session_start');await call('cairn_start',{goal:'Read upstream',evidence_mode:'captured'});
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

for(const host of ['pi','claude','codex'] as Host[])test(`${host}: curated goals leave native tools unrecorded and unrestricted`,()=>{
 const store=new Store(':memory:'),engine=new Engine(store),s:Session={host,sessionId:'curated',cwd:'/w'};
 const task=engine.create(s,{origin:'user',goal:'Finish the outcome',criteria:['Outcome reviewed'],evidenceMode:'curated',budget:{deadline:'2000-01-01T00:00:00.000Z'}});
 const before=store.events(task.id).length;
 const event={sessionId:s.sessionId,cwd:s.cwd,tool:'native_arbitrary_tool',callId:'native-untracked',input:{sensitive:'raw-input-sentinel'},output:{sensitive:'raw-output-sentinel'}};
 engine.beforeTool=()=>{throw new Error('Curated hooks must not reserve calls');};
 engine.observe=()=>{throw new Error('Curated hooks must not capture results');};
 assert.deepEqual(handleNative(engine,host,{...event,type:'PreToolUse'}),{});
 assert.deepEqual(handleNative(engine,host,{...event,type:'PostToolUse'}),{});
 assert.deepEqual(handleNative(engine,host,{...event,type:'PostToolUseFailure',isError:true}),{});
 const saved=store.get(task.id);assert.deepEqual(saved.calls,{});assert.deepEqual(saved.observations,[]);assert.equal(saved.revision,task.revision);
 assert.equal(store.events(task.id).length,before);assert.doesNotMatch(JSON.stringify(store.events(task.id)),/raw-input-sentinel|raw-output-sentinel|native_arbitrary_tool/);
 store.close();
});

test('captured Codex plan progress requires an eligible reserved call in the current task and epoch',()=>{
 const store=new Store(':memory:'),engine=new Engine(store),s:Session={host:'codex',sessionId:'plan',cwd:'/w'};
 const task=engine.create(s,{origin:'user',goal:'Investigate',criteria:['Reviewed'],evidenceMode:'captured'});
 const event={type:'PostToolUse',sessionId:s.sessionId,cwd:s.cwd,tool:'update_plan',callId:'raw-call-id-sentinel',input:{explanation:'private-explanation-sentinel',plan:[{step:'Read sources',status:'completed'},{step:'Check cause',status:'in_progress'},{step:'Write report',status:'pending'}]},output:{private:'raw-result-sentinel'}};
 handleNative(engine,'codex',{...event,type:'PreToolUse'});assert.match(handleNative(engine,'codex',event).context!,/Cairn E1/);
 let saved=store.get(task.id);assert.deepEqual(saved.progress?.map(p=>[p.title,p.status,p.source]),[['Read sources','completed','host'],['Check cause','running','host'],['Write report','pending','host']]);
 assert.equal(Object.values(saved.calls)[0]!.status,'finished');assert.equal(saved.observations.length,1);
 const progressEvents=store.events(task.id).filter(e=>e.kind==='progress.updated');assert.doesNotMatch(JSON.stringify(progressEvents),/private-explanation-sentinel|raw-result-sentinel|raw-call-id-sentinel|update_plan/);
 const revision=saved.revision;handleNative(engine,'codex',event);assert.equal(store.get(task.id).revision,revision,'duplicate semantic plan makes no additional event');
 const second={...event,callId:'plan-2',input:{plan:[{step:'Read sources',status:'completed'},{step:'Check cause',status:'completed'}]}};
 handleNative(engine,'codex',{...second,type:'PreToolUse'});handleNative(engine,'codex',second);
 saved=store.get(task.id);assert.equal(saved.progress?.find(p=>p.key==='codex-plan-3')?.status,'cancelled');
 const restored=handleNative(engine,'codex',{type:'RestoreContext',sessionId:s.sessionId,cwd:s.cwd});assert.match(restored.context!,/Check cause/);
 engine.suspend(task.id,s);const next:Session={host:'pi',sessionId:'next',cwd:'/w'};engine.resume(task.id,next,true);
 assert.equal(store.get(task.id).progress?.find(p=>p.key==='codex-plan-2')?.status,'completed');
 const fenced=JSON.stringify(store.get(task.id).progress);handleNative(engine,'codex',{...event,input:{plan:[{step:'Stale owner',status:'in_progress'}]}});assert.equal(JSON.stringify(store.get(task.id).progress),fenced);
 store.close();
});

test('curated late Codex plans never attach to a different task in the same native session',()=>{
 const store=new Store(':memory:'),engine=new Engine(store),s:Session={host:'codex',sessionId:'same',cwd:'/w'};
 const first=engine.create(s,{origin:'user',goal:'First',criteria:['First done'],evidenceMode:'curated'});
 const event={sessionId:s.sessionId,cwd:s.cwd,tool:'update_plan',callId:'old-plan',input:{plan:[{step:'First task work',status:'in_progress'}]},output:{}};
 handleNative(engine,'codex',{...event,type:'PreToolUse'});engine.suspend(first.id,s);
 const second=engine.create(s,{origin:'user',goal:'Second',criteria:['Second done'],evidenceMode:'curated',progress:[{key:'second',title:'Second task work',status:'running'}]});
 const before=store.get(second.id),events=store.events(second.id);handleNative(engine,'codex',{...event,type:'PostToolUse'});
 assert.deepEqual(store.get(second.id),before);assert.deepEqual(store.events(second.id),events);assert.equal(store.get(first.id).progress,undefined);
 assert.deepEqual(store.get(second.id).calls,{});assert.deepEqual(store.get(second.id).observations,[]);assert.doesNotMatch(JSON.stringify(store.events(second.id)),/First task work|old-plan|update_plan/);
 store.close();
});

test('captured plan results without a reservation or from an old task cannot update current progress',()=>{
 const store=new Store(':memory:'),engine=new Engine(store),s:Session={host:'codex',sessionId:'same',cwd:'/w'};
 const first=engine.create(s,{origin:'user',goal:'First',criteria:['First done'],evidenceMode:'captured'});
 const event={sessionId:s.sessionId,cwd:s.cwd,tool:'update_plan',callId:'old-plan',input:{plan:[{step:'First task work',status:'in_progress'}]},output:{}};
 handleNative(engine,'codex',{...event,type:'PreToolUse'});engine.suspend(first.id,s);
 const second=engine.create(s,{origin:'user',goal:'Second',criteria:['Second done'],evidenceMode:'captured'});
 handleNative(engine,'codex',{...event,type:'PostToolUse'});assert.equal(store.get(second.id).progress,undefined);assert.equal(store.get(first.id).progress,undefined);
 handleNative(engine,'codex',{...event,type:'PostToolUse',callId:'no-reservation'});assert.equal(store.get(second.id).progress,undefined);
 assert.equal(store.get(first.id).observations.length,1);assert.equal(store.get(first.id).observations[0]!.eligible,false);assert.equal(store.get(second.id).observations.length,1);
 store.close();
});

test('unknown host plan contracts, failures and forged plan-like names use checkpoint progress fallback',()=>{
 const event={type:'PostToolUse',sessionId:'s',cwd:'/w',tool:'update_plan',input:{plan:[{step:'A real step',status:'in_progress'}]}};
 assert.equal(nativeProgress('pi',event),undefined);assert.equal(nativeProgress('claude',{...event,tool:'TaskUpdate'}),undefined);
 assert.equal(nativeProgress('codex',{...event,isError:true}),undefined);assert.equal(nativeProgress('codex',{...event,type:'PreToolUse'}),undefined);
 assert.equal(nativeProgress('codex',{...event,tool:'mcp__unrelated__update_plan'}),undefined);
 for(const plan of [[{step:'A',status:'constructor'}],[{step:'',status:'pending'}],[{step:'A',status:'unknown'}],{step:'A',status:'pending'}])assert.equal(nativeProgress('codex',{...event,input:{plan}}),undefined);
});

for(const host of ['pi','claude','codex'] as Host[])test(`${host}: curated checkpoint progress and references survive explicit cross-session recovery`,async()=>{
 const store=new Store(':memory:'),engine=new Engine(store),s:Session={host,sessionId:'curated-root',cwd:'/w'},runtime=new ToolRuntime(engine,s);
 handleNative(engine,host,{type:'SessionStart',sessionId:s.sessionId,cwd:s.cwd});
 try{
  const started:any=await runtime.invoke('cairn_start',{goal:'Review source file',criteria:['Cause checked']});assert.equal(store.get(started.taskId).evidenceMode,'curated');
  await runtime.invoke('cairn_checkpoint',{summary:'Read the source and found a candidate cause',findings:[{key:'cause',text:'The conversion is duplicated',status:'proposed',basis:'The same mapping is applied at both boundaries',references:['src/mapping.ts:20']}],progress:[{key:'source',title:'Read source',status:'completed'},{key:'verify',title:'Check cause',status:'running'}],questions:['Confirm the output fixture']});
  const child:Session={host,sessionId:'native-child-context',cwd:'/w'};handleNative(engine,host,{type:'SessionStart',sessionId:child.sessionId,cwd:child.cwd});assert.equal(engine.active(child),undefined);assert.equal(store.get(started.taskId).owner.sessionId,s.sessionId,'a subagent context does not take over the goal');
  handleNative(engine,host,{type:'Interrupt',sessionId:s.sessionId,cwd:s.cwd});
  const next:Session={host,sessionId:'curated-next',cwd:'/w'};engine.resume(started.taskId,next,true);
  const context=handleNative(engine,host,{type:'RestoreContext',sessionId:next.sessionId,cwd:next.cwd}).context!;assert.match(context,/Read source/);assert.match(context,/src\/mapping.ts:20/);assert.match(context,/Confirm the output fixture/);
  assert.equal(store.get(started.taskId).progress?.find(p=>p.key==='verify')?.status,'blocked');
  assert.deepEqual(store.get(started.taskId).observations,[]);assert.deepEqual(store.get(started.taskId).calls,{});
 }finally{await runtime.close();store.close();}
});

test('Pi injects only changed checkpoints and refreshes the same state after compaction',async()=>{
 const root=mkdtempSync(join(tmpdir(),'cairn-pi-curated-context-')),handlers=new Map<string,any>(),tools=new Map<string,any>();
 const pi={on:(name:string,handler:any)=>handlers.set(name,handler),registerTool:(tool:any)=>tools.set(tool.name,tool),registerCommand:()=>{},sendMessage:()=>{}},ctx={cwd:root,sessionManager:{getSessionId:()=> 'native'},ui:{notify:()=>{}}};
 piExtension(pi);const emit=(name:string,extra:any={})=>handlers.get(name)({type:name,...extra},ctx);
 try{
  await emit('session_start');const invoke=(name:string,input:any)=>tools.get(name).execute('execute',input,undefined,undefined,ctx);
  await invoke('cairn_start',{goal:'A curated task'});assert.match((await emit('before_agent_start')).message.content,/A curated task/);
  assert.equal(await emit('before_agent_start'),undefined);
  await emit('tool_call',{toolName:'read',toolCallId:'native-read',input:{path:'anywhere'}});await emit('tool_result',{toolName:'read',toolCallId:'native-read',content:[{type:'text',text:'private'}]});assert.equal(await emit('before_agent_start'),undefined);
  await invoke('cairn_checkpoint',{summary:'Source reviewed',progress:[{key:'review',title:'Review source',status:'completed'}]});assert.match((await emit('before_agent_start')).message.content,/Source reviewed/);assert.equal(await emit('before_agent_start'),undefined);
  await emit('session_compact');assert.match((await emit('before_agent_start')).message.content,/Source reviewed/);
 }finally{await emit('session_shutdown');rmSync(root,{recursive:true});}
});
