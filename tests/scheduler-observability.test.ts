import {test} from 'node:test';
import assert from 'node:assert/strict';
import {projectEvent} from '../src/ui/view.js';
import {Engine} from '../src/core/engine.js';
import {Store} from '../src/core/store.js';

test('scheduler timeline names native phases, reports measured usage and hides private payloads',()=>{
  const base={seq:1,at:'2026-10-18T00:00:00Z'};
  const phase=projectEvent({...base,kind:'scheduler.dispatched',payload:{phase:'explore',branch:{key:'a',title:'Inspect a source'},candidate:'DO_NOT_PROJECT'}});
  assert.equal(phase.title,'派发宿主阶段');assert.match(phase.summary,/explore.*Inspect a source/);
  assert.equal(JSON.stringify(phase).includes('DO_NOT_PROJECT'),false);
  const returned=projectEvent({...base,kind:'scheduler.host_returned',payload:{phase:'reason',sessionRef:'native:one',metrics:{wallSeconds:2.4,usage:{input_tokens:12,output_tokens:3}},output:'DO_NOT_PROJECT'}});
  assert.match(returned.detail!,/12/);assert.match(returned.detail!,/2.4/);assert.equal(JSON.stringify(returned).includes('DO_NOT_PROJECT'),false);
  assert.equal(projectEvent({...base,kind:'scheduler.heartbeat',payload:{}}).category,'advanced');
});

test('scheduler context is bounded and exposes neither lease token nor unapplied candidates',()=>{
  const store=new Store(':memory:'),engine=new Engine(store),owner={host:'mcp' as const,sessionId:'coordinator',cwd:'/tmp'};
  try{
    const task=engine.create(owner,{origin:'user',goal:'General goal',criteria:['observable result'],evidenceMode:'curated'});
    task.scheduler={version:1,epoch:1,bootstrapDone:true,sequence:32,status:'running',lease:{token:'TOKEN_SENTINEL',expiresAt:'2099-01-01T00:00:00Z'},failedBranches:[],inflight:Array.from({length:32},(_,i)=>({id:String(i),phase:'explore',startedAt:'2026-10-18T00:00:00Z',fingerprint:'x',branch:{key:String(i),title:'长'.repeat(2000)},sessionRef:'session'.repeat(600),candidate:'DO_NOT_PROJECT'}))};
    store.save(task,'test.seed',{},engine.at());const context=engine.context(task.id),serialized=JSON.stringify(context);
    assert.ok(Buffer.byteLength(serialized)<12000);assert.equal(serialized.includes('TOKEN_SENTINEL'),false);assert.equal(serialized.includes('DO_NOT_PROJECT'),false);
    assert.equal(context.scheduler?.phases,32);assert.ok(context.scheduler!.omittedFlights>=28);
  }finally{store.close();}
});
