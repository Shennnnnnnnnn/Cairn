import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {setTimeout as delay} from 'node:timers/promises';
import {Store} from '../src/core/store.js';
import {Engine} from '../src/core/engine.js';
import {Gateway,gatewaySchema,valueAt,structuredResult} from '../src/gateway.js';
import type {Session} from '../src/core/types.js';

function setup(evidenceMode:'captured'|'curated'='captured'){
 const dir=mkdtempSync(join(tmpdir(),'cairn-gateway-catalog-')),audit=join(dir,'audit.jsonl'),store=new Store(':memory:'),engine=new Engine(store),session:Session={host:'pi',sessionId:'fixture',cwd:dir};
 const config=gatewaySchema.parse({servers:{fixture:{command:process.execPath,args:[resolve('tests/fixtures/gateway-catalog.mjs'),audit]}},tools:['read','slow','rpc_error','crash'].map(name=>({name,server:'fixture',upstream:name,resultRefPath:'result_ref',scopePaths:{environment:'environment'},timeoutMs:name==='slow'?100:2000}))});
 store.setConfig('gateway',config);
 const task=engine.create(session,{origin:'fixture',goal:'Diagnose measured behavior',criteria:['A supported conclusion'],scope:{environment:'staging'},evidenceMode}),gateway=new Gateway(engine);
 const events=()=>readFileSync(audit,'utf8').trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));
 const readyReport=async()=>{
  const observation=await gateway.call(task.id,session,'read',{probe:'measured'}),claim=engine.claim(task.id,session,{text:'A measured cause',status:'supported',supports:[observation.id],refutes:[]});
  engine.satisfy(task.id,session,'c1',[claim.id]);
  engine.report(task.id,session,{summary:'A measured cause',citations:[{observationId:observation.id,statement:'Observed measurement'}]});
 };
 const cleanup=async()=>{await gateway.close();store.close();rmSync(dir,{recursive:true,force:true});};
 return {dir,audit,store,engine,session,task,gateway,config,events,readyReport,cleanup};
}


test('gateway whitelist rejects unsafe or duplicate dynamic tool names and mapping paths',()=>{
 const base={servers:{fixture:{command:process.execPath}},tools:[{name:'read',server:'fixture',upstream:'read'}]};
 assert.ok(gatewaySchema.safeParse(base).success);
 for(const name of ['bad.name','bad name','__proto__','constructor','prototype','x'.repeat(54)])assert.equal(gatewaySchema.safeParse({...base,tools:[{...base.tools[0],name}]}).success,false,name);
 assert.equal(gatewaySchema.safeParse({...base,tools:[base.tools[0],base.tools[0]]}).success,false);
 assert.equal(gatewaySchema.safeParse({...base,tools:[{...base.tools[0],scopePaths:{environment:'metadata.environment'}}]}).success,true);
 assert.equal(valueAt(Object.create({field:'inherited'}),'field'),undefined);assert.equal(valueAt({payload:{}},'payload.constructor'),undefined);
 for(const resultRefPath of ['payload.__proto__.ref','payload..ref','constructor.ref'])assert.equal(gatewaySchema.safeParse({...base,tools:[{...base.tools[0],resultRefPath}]}).success,false,resultRefPath);
});

test('parallel catalog and calls share one real upstream process and cached paginated original schemas',async()=>{
 const fixture=setup();
 try{
  const [first,second,a,b]=await Promise.all([fixture.gateway.list(),fixture.gateway.list(),fixture.gateway.call(fixture.task.id,fixture.session,'read',{probe:'a'}),fixture.gateway.call(fixture.task.id,fixture.session,'read',{probe:'b'})]);
  assert.equal(first.length,4);assert.deepEqual(first,second);
  const schema=first.find(tool=>tool.name==='read')!.inputSchema;
  assert.equal(schema.description,'Preserved upstream object');assert.equal((schema.properties?.probe as any).description,'Original typed argument');assert.deepEqual(schema.required,['probe']);assert.equal(schema.additionalProperties,false);assert.ok(schema.$defs);
  assert.equal((a.output as any).structuredContent.pid,(b.output as any).structuredContent.pid);
  assert.equal(fixture.events().filter(event=>event.event==='start').length,1);
  assert.equal(fixture.events().filter(event=>event.event==='list').length,2);
  (schema.properties!.probe as any).description='caller changed';
  assert.equal(((await fixture.gateway.list()).find(tool=>tool.name==='read')!.inputSchema.properties!.probe as any).description,'Original typed argument');
  assert.equal(fixture.events().filter(event=>event.event==='list').length,2);
  await fixture.gateway.close();await fixture.gateway.close();
  assert.ok(fixture.events().some(event=>event.event==='exit'));
  await assert.rejects(fixture.gateway.list(),/closed/);
 }finally{await fixture.cleanup();}
});

test('scope failures retain raw results, RPC errors preserve transport and closed connections reconnect without retries',async()=>{
 const fixture=setup();
 try{
  const bad=structuredClone(fixture.config);bad.tools.find(tool=>tool.name==='read')!.scopePaths={environment:'absent'};fixture.store.setConfig('gateway',bad);
  await assert.rejects(fixture.gateway.call(fixture.task.id,fixture.session,'read',{probe:'scope'}),/Missing upstream scope/);
  const observed=fixture.store.get(fixture.task.id).observations.at(-1)!;
  assert.equal(observed.status,'error');assert.equal((observed.output as any).structuredContent.probe,'scope');
  fixture.store.setConfig('gateway',fixture.config);
  await fixture.gateway.call(fixture.task.id,fixture.session,'read',{probe:'healthy'});
  assert.equal(fixture.events().filter(event=>event.event==='start').length,1);
  await assert.rejects(fixture.gateway.call(fixture.task.id,fixture.session,'rpc_error',{}),/Fixture RPC failure/);
  await fixture.gateway.call(fixture.task.id,fixture.session,'read',{probe:'after-rpc-error'});
  assert.equal(fixture.events().filter(event=>event.event==='start').length,1);
  await assert.rejects(fixture.gateway.call(fixture.task.id,fixture.session,'crash',{}),/Connection closed/);
  await fixture.gateway.call(fixture.task.id,fixture.session,'read',{probe:'reconnected'});
  assert.equal(fixture.events().filter(event=>event.event==='start').length,2);
  assert.equal(fixture.events().filter(event=>event.event==='call'&&event.name==='rpc_error').length,1);
  await assert.rejects(fixture.gateway.call(fixture.task.id,fixture.session,'slow',{}),/timed out/i);
  assert.equal(fixture.store.get(fixture.task.id).observations.at(-1)?.status,'error');
  assert.ok(Object.values(fixture.store.get(fixture.task.id).calls).every(call=>call.status==='finished'));
 }finally{await fixture.cleanup();}
});


test('cancelling or timing out one request leaves independent requests on the shared transport running',async()=>{
 const fixture=setup();
 try{
  const config=structuredClone(fixture.config);config.tools.find(tool=>tool.name==='slow')!.timeoutMs=2000;fixture.store.setConfig('gateway',config);
  await fixture.gateway.list();
  const controller=new AbortController();
  const cancelled=fixture.gateway.call(fixture.task.id,fixture.session,'slow',{delayMs:1000},controller.signal);
  const peer=fixture.gateway.call(fixture.task.id,fixture.session,'slow',{delayMs:100});
  const read=fixture.gateway.call(fixture.task.id,fixture.session,'read',{probe:'parallel'});
  const abort=setTimeout(()=>controller.abort(),25);
  const [cancelledResult,peerResult,readResult]=await Promise.allSettled([cancelled,peer,read]);clearTimeout(abort);
  assert.equal(cancelledResult.status,'rejected');assert.equal(peerResult.status,'fulfilled');assert.equal(readResult.status,'fulfilled');
  assert.equal(fixture.events().filter(event=>event.event==='start').length,1);
  config.tools.find(tool=>tool.name==='slow')!.timeoutMs=100;fixture.store.setConfig('gateway',config);
  const [timedOut,finished]=await Promise.allSettled([fixture.gateway.call(fixture.task.id,fixture.session,'slow',{delayMs:500}),fixture.gateway.call(fixture.task.id,fixture.session,'slow',{delayMs:25})]);
  assert.equal(timedOut.status,'rejected');assert.equal(finished.status,'fulfilled');
  await fixture.gateway.call(fixture.task.id,fixture.session,'read',{probe:'after-timeout'});
  assert.equal(fixture.events().filter(event=>event.event==='start').length,1);
  assert.ok(Object.values(fixture.store.get(fixture.task.id).calls).every(call=>call.status==='finished'));
 }finally{await fixture.cleanup();}
});

test('idempotent close waits for an in-flight connection and releases its process',async()=>{
 const fixture=setup();
 try{
  const config=structuredClone(fixture.config);config.servers.fixture!.args.push('250');fixture.store.setConfig('gateway',config);
  const listing=fixture.gateway.list().then(value=>({value}),error=>({error}));
  for(let attempt=0;attempt<100&&!existsSync(fixture.audit);attempt++)await delay(10);
  assert.ok(existsSync(fixture.audit),'fixture process started before closing');
  const first=fixture.gateway.close(),second=fixture.gateway.close();assert.equal(first,second);
  await first;assert.ok('error' in await listing);
  assert.ok(fixture.events().some(event=>event.event==='exit'));
 }finally{await fixture.cleanup();}
});

test('curated MCP passthrough returns real upstream results without tool events or observations',async()=>{
 const fixture=setup('curated');
 try{
  fixture.store.transaction(()=>{const task=fixture.store.get(fixture.task.id);task.budget.deadline='2000-01-01T00:00:00.000Z';fixture.store.save(task,'fixture.advisory-deadline',{},fixture.engine.at());});
  const before=fixture.store.get(fixture.task.id),events=fixture.store.events(fixture.task.id);
  fixture.engine.beforeTool=()=>{throw new Error('Unrecorded calls cannot reserve tool budgets');};
  fixture.engine.observe=()=>{throw new Error('Unrecorded calls cannot create observations');};
  const [a,b]=await Promise.all([fixture.gateway.callUnrecorded(fixture.task.id,fixture.session,'read',{probe:'private-unrecorded-a'}),fixture.gateway.callUnrecorded(fixture.task.id,fixture.session,'read',{probe:'private-unrecorded-b'})]);
  const valueA=structuredResult(a) as Record<string,unknown>,valueB=structuredResult(b) as Record<string,unknown>;
  assert.equal(valueA.probe,'private-unrecorded-a');assert.equal(valueB.probe,'private-unrecorded-b');assert.equal(valueA.pid,valueB.pid);
  const saved=fixture.store.get(fixture.task.id);assert.deepEqual(saved,before);assert.deepEqual(fixture.store.events(fixture.task.id),events);assert.deepEqual(saved.calls,{});assert.deepEqual(saved.observations,[]);
  assert.doesNotMatch(JSON.stringify(fixture.store.events(fixture.task.id)),/private-unrecorded/);assert.equal(fixture.events().filter(event=>event.event==='start').length,1);
  await assert.rejects(fixture.gateway.callUnrecorded(fixture.task.id,fixture.session,'rpc_error',{}),/Fixture RPC failure/);
  assert.deepEqual(fixture.store.get(fixture.task.id),before);assert.deepEqual(fixture.store.events(fixture.task.id),events);
 }finally{await fixture.cleanup();}
});

test('unrecorded passthrough requires active ownership and the matching evidence mode',async()=>{
 const fixture=setup('curated');
 try{
  await fixture.gateway.list();const before=fixture.events().filter(event=>event.event==='call').length;
  await assert.rejects(fixture.gateway.call(fixture.task.id,fixture.session,'read',{probe:'wrong-mode'}),/unrecorded forwarding/);
  await assert.rejects(fixture.gateway.callUnrecorded(fixture.task.id,fixture.session,'unknown',{}),/configured MCP/);
  await assert.rejects(fixture.gateway.callUnrecorded(fixture.task.id,{...fixture.session,cwd:'/wrong-directory'},'read',{probe:'wrong'}),/owns|takeover/);
  fixture.engine.suspend(fixture.task.id,fixture.session);await assert.rejects(fixture.gateway.callUnrecorded(fixture.task.id,fixture.session,'read',{probe:'paused'}),/suspended/);
  const next={...fixture.session,sessionId:'next'};fixture.engine.resume(fixture.task.id,next,true);
  await assert.rejects(fixture.gateway.callUnrecorded(fixture.task.id,fixture.session,'read',{probe:'stale'}),/owns|takeover/);
  assert.equal(fixture.events().filter(event=>event.event==='call').length,before);
  assert.deepEqual(fixture.store.get(fixture.task.id).calls,{});assert.deepEqual(fixture.store.get(fixture.task.id).observations,[]);
 }finally{await fixture.cleanup();}
 const captured=setup();
 try{await assert.rejects(captured.gateway.callUnrecorded(captured.task.id,captured.session,'read',{probe:'bypass'}),/curated task/);assert.equal(existsSync(captured.audit),false);}
 finally{await captured.cleanup();}
});

test('curated requests preserve shared-transport cancellation isolation without saving failures',async()=>{
 const fixture=setup('curated');
 try{
  const config=structuredClone(fixture.config);config.tools.find(tool=>tool.name==='slow')!.timeoutMs=2000;fixture.store.setConfig('gateway',config);await fixture.gateway.list();
  const before=fixture.store.get(fixture.task.id),controller=new AbortController();
  const cancelled=fixture.gateway.callUnrecorded(fixture.task.id,fixture.session,'slow',{delayMs:1000},controller.signal);
  const peer=fixture.gateway.callUnrecorded(fixture.task.id,fixture.session,'slow',{delayMs:75});
  const abort=setTimeout(()=>controller.abort(),25),results=await Promise.allSettled([cancelled,peer]);clearTimeout(abort);
  assert.equal(results[0]!.status,'rejected');assert.equal(results[1]!.status,'fulfilled');
  await fixture.gateway.callUnrecorded(fixture.task.id,fixture.session,'read',{probe:'after-cancel'});
  assert.equal(fixture.events().filter(event=>event.event==='start').length,1);assert.deepEqual(fixture.store.get(fixture.task.id),before);
 }finally{await fixture.cleanup();}
});

test('unrecorded calls recheck ownership after a slow connection before dispatching',async()=>{
 const fixture=setup('curated');
 try{
  const config=structuredClone(fixture.config);config.servers.fixture!.args.push('250');fixture.store.setConfig('gateway',config);
  const call=fixture.gateway.callUnrecorded(fixture.task.id,fixture.session,'read',{probe:'should-not-dispatch'}).then(value=>({value}),error=>({error}));
  for(let attempt=0;attempt<100&&!existsSync(fixture.audit);attempt++)await delay(10);
  assert.ok(existsSync(fixture.audit));fixture.engine.suspend(fixture.task.id,fixture.session);
  const result=await call;assert.ok('error' in result);assert.match(String(result.error),/suspended/);
  assert.equal(fixture.events().filter(event=>event.event==='call').length,0);assert.deepEqual(fixture.store.get(fixture.task.id).calls,{});assert.deepEqual(fixture.store.get(fixture.task.id).observations,[]);
 }finally{await fixture.cleanup();}
});
