import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {setTimeout as delay} from 'node:timers/promises';
import {Store} from '../src/core/store.js';
import {Engine} from '../src/core/engine.js';
import {Gateway,gatewaySchema,publicInputSchema,valueAt} from '../src/gateway.js';
import type {Session} from '../src/core/types.js';

function setup(){
 const dir=mkdtempSync(join(tmpdir(),'cairn-gateway-catalog-')),audit=join(dir,'audit.jsonl'),store=new Store(':memory:'),engine=new Engine(store),session:Session={host:'pi',sessionId:'fixture',cwd:dir};
 const config=gatewaySchema.parse({servers:{fixture:{command:process.execPath,args:[resolve('tests/fixtures/gateway-catalog.mjs'),audit]}},tools:['read','submit','receipt','slow','rpc_error','crash'].map(name=>({name,server:'fixture',upstream:name,role:name==='submit'?'submit':name==='receipt'?'receipt':'read',resultRefPath:'result_ref',scopePaths:{teamId:'team_id'},reportPath:name==='submit'?'payload.report':undefined,receiptPath:['submit','receipt'].includes(name)?'receipt':undefined,timeoutMs:name==='slow'?100:2000}))});
 store.setConfig('gateway',config);
 const task=engine.create(session,{origin:'fixture',goal:'Diagnose measured behavior',criteria:['A supported conclusion'],scope:{teamId:'team'}}),gateway=new Gateway(engine);
 const events=()=>readFileSync(audit,'utf8').trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));
 const readyReport=async()=>{
  const observation=await gateway.call(task.id,session,'read',{probe:'measured'}),claim=engine.claim(task.id,session,{text:'A measured cause',status:'supported',supports:[observation.id],refutes:[]});
  engine.satisfy(task.id,session,'c1',[claim.id]);
  engine.report(task.id,session,{summary:'A measured cause',citations:[{observationId:observation.id,statement:'Observed measurement'}]});
 };
 const cleanup=async()=>{await gateway.close();store.close();rmSync(dir,{recursive:true,force:true});};
 return {dir,audit,store,engine,session,task,gateway,config,events,readyReport,cleanup};
}

test('public gateway schemas preserve original constraints and remove only injected report fields',()=>{
 const schema={type:'object' as const,properties:{payload:{type:'object',properties:{report:{type:'object'},label:{type:'string',description:'Keep upstream description'}},required:['report','label'],additionalProperties:false}},required:['payload'],additionalProperties:false,$defs:{unchanged:{type:'string'}}};
 const original=structuredClone(schema),publicSchema=publicInputSchema(schema,{role:'submit',reportPath:'payload.report'});
 assert.deepEqual(schema,original);
 assert.deepEqual(publicSchema.properties.payload.properties,{label:original.properties.payload.properties.label});
 assert.deepEqual(publicSchema.properties.payload.required,['label']);
 assert.deepEqual(publicSchema.required,['payload']);assert.equal(publicSchema.additionalProperties,false);assert.deepEqual(publicSchema.$defs,original.$defs);
 assert.deepEqual(publicInputSchema(schema,{role:'read'}),schema);
 const top={type:'object' as const,properties:{report:{type:'object'},target:{type:'string'}},required:['report','target']};
 assert.deepEqual(publicInputSchema(top,{role:'submit',reportPath:'report'}),{type:'object',properties:{target:{type:'string'}},required:['target']});
 const indirect={type:'object' as const,properties:{payload:{$ref:'#/$defs/payload'}},$defs:{payload:{type:'object',properties:{report:{type:'object'}}}}};
 assert.deepEqual(publicInputSchema(indirect,{role:'submit',reportPath:'payload.report'}),indirect);
});

test('gateway whitelist rejects unsafe or duplicate dynamic tool names and mapping paths',()=>{
 const base={servers:{fixture:{command:process.execPath}},tools:[{name:'read',server:'fixture',upstream:'read'}]};
 assert.ok(gatewaySchema.safeParse(base).success);
 for(const name of ['bad.name','bad name','__proto__','constructor','prototype','x'.repeat(54)])assert.equal(gatewaySchema.safeParse({...base,tools:[{...base.tools[0],name}]}).success,false,name);
 assert.equal(gatewaySchema.safeParse({...base,tools:[base.tools[0],base.tools[0]]}).success,false);
 assert.equal(gatewaySchema.safeParse({...base,tools:[{...base.tools[0],scopePaths:{unexpected:'value'}}]}).success,false);
 assert.equal(valueAt(Object.create({receipt:'inherited'}),'receipt'),undefined);assert.equal(valueAt({payload:{}},'payload.constructor'),undefined);
 for(const reportPath of ['payload.__proto__.report','payload..report','constructor.report'])assert.equal(gatewaySchema.safeParse({...base,tools:[{...base.tools[0],role:'submit',reportPath,receiptPath:'receipt'}]}).success,false,reportPath);
});

test('parallel catalog and calls share one real upstream process and cached paginated original schemas',async()=>{
 const fixture=setup();
 try{
  const [first,second,a,b]=await Promise.all([fixture.gateway.list(),fixture.gateway.list(),fixture.gateway.call(fixture.task.id,fixture.session,'read',{probe:'a'}),fixture.gateway.call(fixture.task.id,fixture.session,'read',{probe:'b'})]);
  assert.equal(first.length,6);assert.deepEqual(first,second);
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
  const bad=structuredClone(fixture.config);bad.tools.find(tool=>tool.name==='read')!.scopePaths={teamId:'absent'};fixture.store.setConfig('gateway',bad);
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

test('receipt reconciliation requires a prior submission and preserves ambiguous successful submission evidence',async()=>{
 const fixture=setup();
 try{
  await fixture.readyReport();
  const early=await fixture.gateway.call(fixture.task.id,fixture.session,'receipt',{});
  assert.ok(early.receipt);assert.equal(fixture.store.get(fixture.task.id).delivery,undefined);
  const config=structuredClone(fixture.config);config.tools.find(tool=>tool.name==='submit')!.receiptPath='missing';fixture.store.setConfig('gateway',config);
  const callerArgs={payload:{label:'original'}};
  await assert.rejects(fixture.gateway.call(fixture.task.id,fixture.session,'submit',callerArgs),/reconcile/);
  assert.deepEqual(callerArgs,{payload:{label:'original'}});
  const submitted=fixture.store.get(fixture.task.id).observations.filter(observation=>observation.tool==='submit');
  assert.equal(submitted.length,1);assert.equal(submitted[0]!.status,'success');assert.ok((submitted[0]!.output as any).structuredContent.receipt);
  assert.deepEqual((submitted[0]!.input as any).payload.report,fixture.store.get(fixture.task.id).report);
  await assert.rejects(fixture.gateway.call(fixture.task.id,fixture.session,'submit',{payload:{label:'retry'}}),/prior submission/);
  await assert.rejects(fixture.gateway.call(fixture.task.id,fixture.session,'receipt',{team:'foreign'}),/scope/);
  assert.equal(fixture.store.get(fixture.task.id).delivery,undefined);
  const receipt=await fixture.gateway.call(fixture.task.id,fixture.session,'receipt',{});
  assert.deepEqual(fixture.store.get(fixture.task.id).delivery?.receipt,receipt.receipt);
  assert.equal(fixture.events().filter(event=>event.event==='call'&&event.name==='submit').length,1);
  assert.equal(fixture.store.get(fixture.task.id).observations.filter(observation=>observation.tool==='submit').length,1);
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
