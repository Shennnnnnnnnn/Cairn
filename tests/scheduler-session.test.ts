import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Engine} from '../src/core/engine.js';
import {Store} from '../src/core/store.js';
import {Scheduler,schedulerPolicy,type HostExecutor,type HostRequest,type SchedulerOptions} from '../src/scheduler.js';
import {projectEvent} from '../src/ui/view.js';

function fixture(){
  const cwd=mkdtempSync(join(tmpdir(),'cairn-session-policy-')),path=join(cwd,'state.db');
  const store=new Store(path),engine=new Engine(store),owner={host:'mcp' as const,sessionId:'owner',cwd};
  const task=engine.create(owner,{origin:'Two local documents',goal:'Compare the documented versions',criteria:['A grounded comparison'],evidenceMode:'curated'});
  return {cwd,path,store,engine,owner,task,close(){store.close();rmSync(cwd,{recursive:true,force:true});}};
}
const fact=(key='answer',covers=['c1'])=>({key,text:'Documented version comparison',status:'supported',basis:'Read both original headers',covers});
function board(request:HostRequest){
  const input=JSON.parse(request.prompt.split('Saved blackboard:\n').at(-1)!);
  return input.fullSnapshot?JSON.parse(readFileSync(input.fullSnapshot.path,'utf8')):input;
}

test('Default Bootstrap, Reason and sequential Explore actually share one native session and retain proposal review',async()=>{
  const f=fixture(),requests:HostRequest[]=[],native=new Set<string>();let active=0,maximum=0;
  try{
    const executor:HostExecutor={canResume:()=>true,async execute(request){
      requests.push(request);assert.ok(requests.length<=6,'No repeated empty review');
      assert.equal(request.sessionMode,'single');assert.match(request.prompt,/Session policy: single/);
      assert.equal(request.resume,requests.length===1?undefined:'native:shared');
      assert.equal(request.contextMode,requests.length===1?'full':'delta');
      const sessionRef=request.resume??'native:shared';native.add(sessionRef);
      request.onSession?.(sessionRef);
      const reply=(data:unknown)=>({output:JSON.stringify(data),sessionRef});
      const saved=board(request);
      if(request.phase==='bootstrap')return reply({decision:'continue',checkpoint:{findings:[fact('seed',[])]},intents:[{key:'a',title:'Read header A'},{key:'b',title:'Read header B'}]});
      if(request.phase==='explore'){
        active++;maximum=Math.max(maximum,active);await new Promise(resolve=>setImmediate(resolve));active--;
        return reply({decision:'continue',checkpoint:{findings:[{key:'header',text:'Observed header '+request.branch!.key,basis:'Read the assigned source'}]}});
      }
      assert.equal(request.phase,'reason');
      const proposals=saved.findings.filter((item:any)=>item.key.startsWith('branch:'));
      assert.ok(proposals.every((item:any)=>item.status==='proposed'&&item.covers.length===0));
      assert.deepEqual(f.store.get(f.task.id).criteria[0]!.claimIds,[],'Local Explore cannot grant coverage');
      if(proposals.length<2)return reply({decision:'continue'});
      return reply({decision:'complete',checkpoint:{findings:proposals.map((item:any)=>({...fact(item.key),text:item.text}))}});
    }};
    const result=await new Scheduler(f.engine,f.owner,executor).run(f.task.id);
    assert.equal(result.status,'completed',result.reason);assert.equal(maximum,1);assert.equal(native.size,1);
    assert.deepEqual(requests.map(r=>r.phase),['bootstrap','reason','explore','reason','explore','reason']);
    assert.deepEqual(f.engine.context(f.task.id).scheduler!.execution,{sessionMode:'single',coordinatorMode:'reuse-delta',maxParallel:1});
    const events=f.store.events(f.task.id),policy=events.find(e=>e.kind==='scheduler.policy_selected')!;
    assert.ok(policy.seq<events.find(e=>e.kind==='scheduler.dispatched')!.seq);
    assert.equal(projectEvent(policy).summary,'单会话 · 按顺序探索');
    assert.ok(f.store.get(f.task.id).claims.filter(c=>c.key?.startsWith('branch:')).every(c=>c.history?.some(h=>h.status==='proposed')));
    assert.deepEqual(f.store.get(f.task.id).budget,{},'Session policy is not a task budget');
  }finally{f.close();}
});

test('Explicit multi-session capacity does not force any Explore when the goal is already supported',async()=>{
  const f=fixture();let calls=0;
  try{
    const result=await new Scheduler(f.engine,f.owner,{async execute(request){
      calls++;assert.equal(request.phase,'bootstrap');assert.equal(request.sessionMode,'multi');
      assert.match(request.prompt,/Zero intents is valid/);
      return {output:JSON.stringify({decision:'complete',checkpoint:{findings:[fact()]}})};
    }},{sessionMode:'multi',maxParallel:3}).run(f.task.id);
    assert.equal(result.status,'completed',result.reason);assert.equal(calls,1);
    assert.deepEqual(f.store.get(f.task.id).scheduler!.execution,{sessionMode:'multi',coordinatorMode:'fresh-full',maxParallel:3});
  }finally{f.close();}
});

test('Single-session policy and locator survive reload and owner takeover, with a full input after restart',async()=>{
  const f=fixture();let second:Store|undefined;
  try{
    const first=await new Scheduler(f.engine,f.owner,{async execute(){
      return {sessionRef:'native:retained',output:JSON.stringify({decision:'suspend',reason:'Need the second document',checkpoint:{findings:[fact('seed',[])]}})};
    }}).run(f.task.id);
    assert.equal(first.status,'suspended');f.store.close();
    second=new Store(f.path);const engine=new Engine(second),owner={...f.owner,sessionId:'next-owner'};
    engine.resume(f.task.id,owner,true);
    let calls=0;
    const result=await new Scheduler(engine,owner,{canResume:ref=>ref==='native:retained',async execute(request){
      calls++;assert.equal(request.phase,'reason');assert.equal(request.resume,'native:retained');assert.equal(request.contextMode,'full');
      assert.ok(board(request).findings.some((item:any)=>item.key==='seed'));
      return {sessionRef:request.resume,output:JSON.stringify({decision:'complete',checkpoint:{findings:[fact()]}})};
    }}).run(f.task.id);
    assert.equal(result.status,'completed',result.reason);assert.equal(calls,1);
    assert.equal(second.get(f.task.id).scheduler!.coordinator!.sessionRef,'native:retained');
  }finally{second?.close();rmSync(f.cwd,{recursive:true,force:true});}
});

for(const missing of ['locator','canResume','availability'] as const)test('Single-session continuation refuses a new session without '+missing,async()=>{
  const f=fixture();let calls=0;
  try{
    const executor:HostExecutor={async execute(){
      calls++;return {sessionRef:missing==='locator'?undefined:'native:first',output:JSON.stringify({decision:'continue',checkpoint:{findings:[fact('seed',[])]}})};
    }};
    if(missing!=='canResume')executor.canResume=()=>missing!=='availability';
    const result=await new Scheduler(f.engine,f.owner,executor).run(f.task.id);
    assert.equal(result.status,'failed');assert.match(result.reason!,/session|availability/i);assert.equal(calls,1);
    assert.deepEqual(f.store.get(f.task.id).claims.map(c=>c.key),['seed']);
  }finally{f.close();}
});

test('A host returning a different native session cannot publish its result as a single-session continuation',async()=>{
  const f=fixture();let calls=0;
  try{
    const result=await new Scheduler(f.engine,f.owner,{canResume:()=>true,async execute(request){
      calls++;return {sessionRef:calls===1?'native:first':'native:replacement',output:JSON.stringify(calls===1?{decision:'continue',checkpoint:{findings:[fact('seed',[])]}}:{decision:'complete',checkpoint:{findings:[fact()]}})};
    }}).run(f.task.id);
    assert.equal(result.status,'failed');assert.match(result.reason!,/exact requested native session/);assert.equal(calls,2);
    assert.deepEqual(f.store.get(f.task.id).claims.map(c=>c.key),['seed']);
  }finally{f.close();}
});

for(const failure of ['invalid-output','host-error'])test('Single-session '+failure+' cannot bypass native availability checks through repair or conclude',async()=>{
  const f=fixture();let calls=0;
  try{
    const result=await new Scheduler(f.engine,f.owner,{async execute(){
      calls++;return {sessionRef:'native:original',output:'not JSON',...(failure==='host-error'?{error:'Upstream failure'}:{})};
    }}).run(f.task.id);
    assert.equal(result.status,'failed');assert.match(result.reason!,/availability/);assert.equal(calls,1);
    assert.equal(f.store.get(f.task.id).scheduler!.coordinator!.sessionRef,'native:original');
  }finally{f.close();}
});

test('Interrupted single-session Bootstrap concludes the saved native session before continuing, without repeating exploration',async()=>{
  const f=fixture(),controller=new AbortController(),requests:HostRequest[]=[];
  try{
    const interrupted=await new Scheduler(f.engine,f.owner,{async execute(request){
      request.onSession?.('native:interrupted');controller.abort();
      return {sessionRef:'native:interrupted',output:'{"decision":"continue"}'};
    }}).run(f.task.id,controller.signal);
    assert.equal(interrupted.status,'interrupted');
    f.engine.resume(f.task.id,f.owner);
    const resumed=await new Scheduler(f.engine,f.owner,{canResume:()=>true,async execute(request){
      requests.push(request);assert.equal(request.resume,'native:interrupted');
      return {sessionRef:request.resume,output:JSON.stringify(request.phase==='conclude'
        ?{decision:'continue',checkpoint:{findings:[fact('seed',[])]}}
        :{decision:'complete',checkpoint:{findings:[fact()]}})};
    }}).run(f.task.id);
    assert.equal(resumed.status,'completed',resumed.reason);
    assert.deepEqual(requests.map(r=>r.phase),['conclude','reason']);
    assert.equal(f.store.get(f.task.id).scheduler!.execution!.sessionMode,'single');
  }finally{f.close();}
});

test('Invalid or contradictory session policy is rejected before state changes; parallel alone never enables multi',async()=>{
  const f=fixture();
  try{
    for(const options of [{maxParallel:2},{coordinatorMode:'fresh-full'},{sessionMode:'single',maxParallel:2}] as SchedulerOptions[]){
      await assert.rejects(new Scheduler(f.engine,f.owner,{execute:async()=>{throw new Error('Must not execute');}},options).run(f.task.id),/Single-session execution requires/);
      assert.equal(f.store.get(f.task.id).scheduler,undefined);
    }
    assert.throws(()=>schedulerPolicy({sessionMode:'invalid'} as unknown as SchedulerOptions),/sessionMode must be/);
  }finally{f.close();}
});

test('Saved multi-session policy survives resume, and in-flight work cannot silently switch session mode',async()=>{
  const f=fixture();
  try{
    await new Scheduler(f.engine,f.owner,{async execute(){return {output:'{"decision":"suspend","reason":"Need an input"}'};}},{sessionMode:'multi',maxParallel:2,coordinatorMode:'reuse-delta'}).run(f.task.id);
    const saved=f.store.get(f.task.id).scheduler!;
    assert.deepEqual(schedulerPolicy({},saved),saved.execution);
    assert.deepEqual(schedulerPolicy({sessionMode:'single'},saved),{sessionMode:'single',maxParallel:1,coordinatorMode:'reuse-delta'});
    saved.inflight=[{id:'old',phase:'explore',startedAt:f.task.createdAt,fingerprint:'old',sessionRef:'native:worker'}];
    assert.throws(()=>schedulerPolicy({sessionMode:'single'},saved),/Settle saved in-flight/);
    const legacy={...saved,execution:undefined,inflight:[]};
    assert.deepEqual(schedulerPolicy({},legacy),{sessionMode:'multi',maxParallel:1,coordinatorMode:'fresh-full'});
  }finally{f.close();}
});
