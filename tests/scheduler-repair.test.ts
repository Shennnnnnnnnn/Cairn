import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,readdirSync,realpathSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Engine,type EngineOptions} from '../src/core/engine.js';
import {Store} from '../src/core/store.js';
import {Scheduler,type HostExecutor,type HostRequest,type HostResult} from '../src/scheduler.js';

function fixture(options:EngineOptions={}){
  const cwd=mkdtempSync(join(tmpdir(),'cairn-phase-repair-')),store=new Store(join(cwd,'state.db')),engine=new Engine(store,undefined,options);
  const owner={host:'mcp' as const,sessionId:'coordinator-owner',cwd};
  const task=engine.create(owner,{origin:'A local source',goal:'Deliver a checked result',criteria:['The result has actual grounds'],constraints:['Use only local assigned inputs'],evidenceMode:'curated'});
  return {cwd,store,engine,owner,task,close(){store.close();rmSync(cwd,{recursive:true,force:true});}};
}
const fact=(key='answer',covers=['c1'])=>({key,text:`Actual result ${key}`,status:'supported',basis:'Inspected the assigned source',covers});
const result=(value:unknown,sessionRef='native:coordinator',toolCalls=0):HostResult=>({output:JSON.stringify(value),sessionRef,metrics:{toolCalls}});
const seed=()=>({decision:'continue',checkpoint:{findings:[fact('seed',[])]}});
const complete=(key='answer')=>({decision:'complete',checkpoint:{findings:[fact(key)]}});
const oversized=()=>({decision:'complete',checkpoint:{findings:[{...fact(),references:Array(9).fill('https://example.test/source')}]}});
const board=(request:HostRequest)=>JSON.parse(request.prompt.split('Saved blackboard:\n').at(-1)!);

test('Reason repairs an overlong references array in the same session without losing the original fingerprint',async()=>{
  const f=fixture();let reasons=0;const requests:HostRequest[]=[];
  try{
    const executor:HostExecutor={canResume:()=>true,execute:async request=>{
      requests.push(request);
      if(request.phase==='bootstrap')return result(seed());
      assert.equal(request.phase,'reason');assert.equal(request.resume,'native:coordinator');reasons++;
      if(!request.repair)return result(oversized());
      assert.equal(request.contextMode,'repair');assert.equal(request.repair.attempt,1);
      assert.ok(request.repair.issues.some(issue=>issue.path.includes('references')&&issue.message.includes('8')));
      assert.ok(!request.prompt.includes('Saved blackboard:\n'),'Output correction must not resend the whole board');
      assert.deepEqual(f.store.get(f.task.id).claims.map(c=>c.key),['seed']);
      return result(complete());
    }};
    const run=await new Scheduler(f.engine,f.owner,executor,{coordinatorMode:'reuse-delta'}).run(f.task.id);
    assert.equal(run.status,'completed',run.reason);assert.equal(reasons,2);
    assert.equal(f.store.get(f.task.id).claims.find(c=>c.key==='answer')?.references,undefined,'The host must not silently truncate or fabricate references');
    assert.ok(f.store.events(f.task.id).some(e=>e.kind==='scheduler.repair_requested'));
    assert.ok(!f.store.events(f.task.id).some(e=>e.kind==='scheduler.stale_reason'));
  }finally{f.close();}
});

test('A repeated output error ends correction even when a different error intervened',async()=>{
  const f=fixture();let reasons=0;
  try{
    const executor:HostExecutor={canResume:()=>true,execute:async request=>{
      if(request.phase==='bootstrap')return result(seed());
      reasons++;assert.ok(reasons<=3,'Repeated invalid output must not loop');
      return result(reasons===2?{decision:'complete',unexpected:'field'}:oversized());
    }};
    const run=await new Scheduler(f.engine,f.owner,executor,{coordinatorMode:'reuse-delta'}).run(f.task.id);
    assert.equal(run.status,'failed');assert.match(run.reason!,/repeated.*output|same.*error/i);assert.equal(reasons,3);
    assert.deepEqual(f.store.get(f.task.id).claims.map(c=>c.key),['seed']);
  }finally{f.close();}
});

test('A hint arriving during output correction still invalidates the old Reason result',async()=>{
  const f=fixture();let reasons=0;
  try{
    const executor:HostExecutor={canResume:()=>true,execute:async request=>{
      if(request.phase==='bootstrap')return result(seed());
      reasons++;
      if(reasons===1){f.engine.addHint(f.task.id,'Inspect the changed requirement');return result(oversized());}
      if(request.repair)return result(complete('discarded-output'));
      assert.ok(request.prompt.includes('Inspect the changed requirement'));return result(complete('fresh-review'));
    }};
    const run=await new Scheduler(f.engine,f.owner,executor,{coordinatorMode:'reuse-delta'}).run(f.task.id);
    assert.equal(run.status,'completed',run.reason);assert.equal(reasons,3);
    assert.ok(f.store.events(f.task.id).some(e=>e.kind==='scheduler.stale_reason'));
    assert.ok(!f.store.get(f.task.id).claims.some(c=>c.key==='discarded-output'));
  }finally{f.close();}
});

test('An invalid intent cannot partially commit its accompanying supported finding',async()=>{
  const f=fixture();
  try{
    const executor:HostExecutor={execute:async()=>({output:JSON.stringify({...complete(),intents:[{key:'inspect',title:'Inspect another input',from:['missing-source']}]})})};
    const run=await new Scheduler(f.engine,f.owner,executor,{coordinatorMode:'reuse-delta'}).run(f.task.id);
    assert.equal(run.status,'failed');
    const saved=f.store.get(f.task.id);assert.deepEqual(saved.claims,[]);assert.deepEqual(saved.criteria[0]!.claimIds,[]);assert.deepEqual(saved.progress??[],[]);
  }finally{f.close();}
});

for(const toolCalls of [1,undefined])test(`Correction rejects ${toolCalls===undefined?'unobserved':'nonzero'} native tool activity`,async()=>{
  const f=fixture();
  try{
    const executor:HostExecutor={canResume:()=>true,execute:async request=>{
      if(request.phase==='bootstrap')return result(seed());
      if(!request.repair)return result(oversized());
      return {...result(complete()),metrics:toolCalls===undefined?{}:{toolCalls}};
    }};
    const run=await new Scheduler(f.engine,f.owner,executor,{coordinatorMode:'reuse-delta'}).run(f.task.id);
    assert.equal(run.status,'failed');assert.match(run.reason!,/tool|action/i);
    assert.ok(!f.store.get(f.task.id).claims.some(c=>c.key==='answer'));
  }finally{f.close();}
});

test('Reused Reason receives deltas plus an accessible complete snapshot, while Explore stays separate',async()=>{
  const f=fixture();let reasons=0;const marker='Unchanged evidence and counterevidence '.repeat(22).trim();
  try{
    const executor:HostExecutor={canResume:()=>true,execute:async request=>{
      if(request.phase==='bootstrap')return result({decision:'continue',checkpoint:{findings:[{...fact('seed',[]),text:marker}]}});
      if(request.phase==='explore'){
        assert.equal(request.resume,undefined);return result({decision:'continue',checkpoint:{findings:[{key:'observation',text:'Actual branch observation',status:'proposed',basis:'Checked the selected source',covers:[]}]}},'native:worker');
      }
      reasons++;assert.equal(request.resume,'native:coordinator');
      if(reasons===1)return result({decision:'continue',intents:[{key:'inspect',title:'Check the unresolved distinction',from:['seed']}]});
      assert.equal(request.contextMode,'delta');assert.ok(!request.prompt.includes(marker));
      const input=board(request);assert.ok(input.fullSnapshot.path.startsWith(realpathSync(f.cwd)));
      const full=JSON.parse(readFileSync(input.fullSnapshot.path,'utf8'));assert.ok(full.findings.some((c:any)=>c.key==='seed'&&c.text===marker));
      const proposal=input.findings.find((c:any)=>c.key.startsWith('branch:'));
      assert.ok(proposal);assert.equal(proposal.status,'proposed');assert.deepEqual(proposal.covers,[]);
      return result({decision:'complete',checkpoint:{findings:[{key:proposal.key,text:proposal.text,status:'supported',basis:'Owner independently checked the referenced result',covers:['c1']}]}});
    }};
    const run=await new Scheduler(f.engine,f.owner,executor,{coordinatorMode:'reuse-delta'}).run(f.task.id);
    assert.equal(run.status,'completed',run.reason);assert.equal(reasons,2);
  }finally{f.close();}
});

test('An unavailable coordinator does not launch a competing native session',async()=>{
  const f=fixture();let calls=0;
  try{
    const executor:HostExecutor={canResume:()=>false,execute:async()=>{calls++;return result(seed());}};
    const run=await new Scheduler(f.engine,f.owner,executor,{coordinatorMode:'reuse-delta'}).run(f.task.id);
    assert.equal(run.status,'failed');assert.match(run.reason!,/availability|competing/);assert.equal(calls,1);
    assert.deepEqual(f.store.get(f.task.id).claims.map(c=>c.key),['seed']);
  }finally{f.close();}
});

test('Abort during output correction preserves accepted facts and never applies the candidate',async()=>{
  const f=fixture(),controller=new AbortController();let calls=0;
  try{
    const executor:HostExecutor={canResume:()=>true,execute:async request=>{
      calls++;
      if(request.phase==='bootstrap')return result(seed());
      if(!request.repair)return result(oversized());
      controller.abort();return result(complete());
    }};
    const run=await new Scheduler(f.engine,f.owner,executor,{coordinatorMode:'reuse-delta'}).run(f.task.id,controller.signal);
    assert.equal(run.status,'interrupted');assert.equal(calls,3);
    assert.deepEqual(f.store.get(f.task.id).claims.map(c=>c.key),['seed']);
  }finally{f.close();}
});

test('An unsafe snapshot directory falls back to complete context without following its symlink',async()=>{
  const f=fixture(),outside=mkdtempSync(join(tmpdir(),'cairn-context-outside-'));let calls=0;
  try{
    symlinkSync(outside,join(f.cwd,'.cairn'));
    const executor:HostExecutor={canResume:()=>true,execute:async request=>{
      calls++;
      if(request.phase==='bootstrap')return result(seed());
      assert.equal(request.contextMode,'full');assert.ok(board(request).findings.some((c:any)=>c.key==='seed'));
      assert.equal(board(request).fullSnapshot,undefined);return result(complete());
    }};
    const run=await new Scheduler(f.engine,f.owner,executor,{coordinatorMode:'reuse-delta'}).run(f.task.id);
    assert.equal(run.status,'completed',run.reason);assert.equal(calls,2);assert.deepEqual(readdirSync(outside),[]);
    assert.ok(f.store.events(f.task.id).some(e=>e.kind==='scheduler.context_projection_failed'));
  }finally{f.close();rmSync(outside,{recursive:true,force:true});}
});

for(const sessionRef of [undefined,'possibly-live-coordinator'])test(`Recovered Reason with ${sessionRef?'unconfirmed process exit':'no session locator'} cannot launch another coordinator`,async()=>{
  const f=fixture();let calls=0;
  try{
    const saved=f.store.get(f.task.id);
    saved.scheduler={version:1,epoch:saved.owner.epoch,bootstrapDone:true,sequence:1,status:'running',failedBranches:[],inflight:[{id:'old-reason',phase:'reason',startedAt:saved.createdAt,fingerprint:'old',sessionRef}]};
    f.store.save(saved,'test.crash',{},f.engine.at());
    const executor:HostExecutor={canResume:()=>false,execute:async()=>{calls++;return result(complete());}};
    const run=await new Scheduler(f.engine,f.owner,executor,{coordinatorMode:'reuse-delta'}).run(f.task.id);
    assert.equal(run.status,'failed');assert.equal(calls,0);assert.equal(f.store.get(f.task.id).scheduler?.inflight[0]?.id,'old-reason');
  }finally{f.close();}
});

for(const boundReference of [false,true])test(`A Reason artifact-only repair ${boundReference?'does not silently refresh old finding references':'reaches verification without restating facts'}`,async()=>{
  let checks=0,calls=0;
  const f=fixture({completionVerifier:{id:'test:artifact-content',artifacts:['result.txt'],verify:task=>{
    checks++;const ok=readFileSync(join(task.owner.cwd,'result.txt'),'utf8')==='good';
    return {ok,...(ok?{}:{issues:[{message:'Correct the named result.txt content'}]})};
  }}});
  try{
    const executor:HostExecutor={canResume:()=>true,execute:async request=>{
      calls++;assert.ok(calls<=3,'An unchanged completion must terminate');
      writeFileSync(join(f.cwd,'result.txt'),request.phase==='bootstrap'?'bad':'good');
      return result(request.phase==='bootstrap'?{decision:'complete',checkpoint:{findings:[{...fact(),...(boundReference?{references:['result.txt']}:{})}]}}:{decision:'complete'});
    }};
    const run=await new Scheduler(f.engine,f.owner,executor,{coordinatorMode:'reuse-delta'}).run(f.task.id);
    assert.ok(!f.store.events(f.task.id).some(e=>e.kind==='scheduler.stale_reason'),'Native deliverable writes do not constitute an external blackboard change');
    assert.equal(run.status,boundReference?'suspended':'completed',run.reason);
    assert.equal(checks,boundReference?1:2);
    if(!boundReference)assert.equal(calls,2,'A named artifact repair requires no redundant review');
  }finally{f.close();}
});
