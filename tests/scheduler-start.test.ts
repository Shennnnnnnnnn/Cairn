import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Engine} from '../src/core/engine.js';
import {Store} from '../src/core/store.js';
import {Scheduler,type HostRequest,type SchedulerOptions} from '../src/scheduler.js';
import type {SchedulerStartMode} from '../src/index.js';
import {projectEvent} from '../src/ui/view.js';

function fixture(){
  const cwd=mkdtempSync(join(tmpdir(),'cairn-start-policy-')),path=join(cwd,'state.db');
  const store=new Store(path),engine=new Engine(store),owner={host:'mcp' as const,sessionId:'owner',cwd};
  const task=engine.create(owner,{origin:'Generic local source',goal:'Compare the documented versions',criteria:['A grounded comparison'],evidenceMode:'curated'});
  return {cwd,path,store,engine,owner,task,close(){store.close();rmSync(cwd,{recursive:true,force:true});}};
}
const complete=()=>({output:JSON.stringify({decision:'complete',checkpoint:{findings:[{key:'comparison',text:'The documented versions differ',status:'supported',basis:'Compared both source headers',covers:['c1']}]}})});

const startModes:readonly SchedulerStartMode[]=['auto','bootstrap-first','reason-first'];
for(const mode of startModes)test(`Start mode ${mode} executes only the selected initial phase`,async()=>{
  const f=fixture(),requests:HostRequest[]=[];
  try{
    const result=await new Scheduler(f.engine,f.owner,{async execute(request){requests.push(request);return complete();}},{startMode:mode}).run(f.task.id);
    assert.equal(result.status,'completed',result.reason);
    assert.deepEqual(requests.map(r=>r.phase),[mode==='reason-first'?'reason':'bootstrap']);
    assert.equal(requests[0]!.resume,undefined);assert.equal(requests[0]!.contextMode,'full');
    const start=f.store.get(f.task.id).scheduler!.start!;
    assert.equal(start.requested,mode);assert.equal(start.selected,mode==='reason-first'?mode:'bootstrap-first');
    assert.equal(start.basis,mode==='auto'?'new-task':'explicit');
    assert.deepEqual(f.engine.context(f.task.id).scheduler!.start,start);
    const events=f.store.events(f.task.id),choice=events.find(e=>e.kind==='scheduler.start_selected')!;
    assert.ok(choice.seq<events.find(e=>e.kind==='scheduler.dispatched')!.seq);
    assert.equal(events.filter(e=>e.kind==='scheduler.start_selected').length,1);
  }finally{f.close();}
});

for(const saved of ['finding','question','next','intent','report'] as const)test(`Auto reviews a saved ${saved} without running Bootstrap`,async()=>{
  const f=fixture();
  try{
    const input=
      saved==='finding'?{findings:[{key:'source',text:'A source was inspected',status:'proposed' as const,covers:[]}]}:
      saved==='question'?{questions:['Which source version is authoritative?']}:
      saved==='next'?{next:'Compare the second header'}:
      saved==='intent'?{progress:[{key:'compare',title:'Compare the two headers',status:'pending' as const,delegated:true}]}:
      {report:{summary:'An initial comparison needs review'}};
    f.engine.checkpoint(f.task.id,f.owner,{summary:'Saved initial work',...input});
    // Isolate each routing signal from the automatically synthesized report.
    if(saved!=='report'){const task=f.store.get(f.task.id);task.report=undefined;f.store.save(task,'test.isolate',{},f.engine.at());}
    let calls=0;
    const result=await new Scheduler(f.engine,f.owner,{async execute(request){
      calls++;assert.equal(request.phase,'reason');
      return {output:'{"decision":"suspend","reason":"The saved work needs additional source access"}'};
    }}).run(f.task.id);
    assert.equal(result.status,'suspended',result.reason);assert.equal(calls,1);
    const start=f.store.get(f.task.id).scheduler!.start!;
    assert.equal(start.selected,'reason-first');assert.equal(start.basis,'saved-state');
  }finally{f.close();}
});

test('Auto routes pending human feedback to review without guessing difficulty from domain words',async()=>{
  const f=fixture();
  try{
    const task=f.store.get(f.task.id);task.goal='复杂多分支 I/O memory security '+ 'Compare the original source. '.repeat(40);
    f.store.save(task,'test.goal',{},f.engine.at());f.engine.addHint(task.id,'Preserve the original source and check carefully');
    const result=await new Scheduler(f.engine,f.owner,{canResume:()=>true,async execute(request){assert.equal(request.phase,'reason');const saved=JSON.parse(request.prompt.split('Saved blackboard:\n')[1]!);const value=JSON.parse(complete().output);return {sessionRef:request.resume??'native:review',output:JSON.stringify({...value,review:{snapshot:saved.globalReview.snapshot,summary:'Reviewed the human input and saved evidence'}})};}}).run(task.id);
    assert.equal(result.status,'completed');assert.equal(f.store.get(task.id).scheduler!.start!.basis,'saved-state');
  }finally{f.close();}
});

test('Explicit Bootstrap-first overrides auto review for a task with facts but no scheduler history',async()=>{
  const f=fixture();
  try{
    f.engine.checkpoint(f.task.id,f.owner,{summary:'Saved initial source',findings:[{key:'source',text:'A saved source header',status:'proposed',covers:[]}]});
    const result=await new Scheduler(f.engine,f.owner,{async execute(request){assert.equal(request.phase,'bootstrap');return complete();}},{startMode:'bootstrap-first'}).run(f.task.id);
    assert.equal(result.status,'completed');assert.equal(f.store.get(f.task.id).scheduler!.start!.basis,'explicit');
  }finally{f.close();}
});

for(const mode of ['fresh-full','reuse-delta'] as const)test(`Reason-first preserves independent Explore and ${mode} coordinator semantics`,async()=>{
  const f=fixture(),requests:HostRequest[]=[];let reasons=0;
  try{
    const result=await new Scheduler(f.engine,f.owner,{
      canResume:()=>true,
      async execute(request){
        requests.push(request);
        const reply=(value:unknown)=>({output:JSON.stringify(value),sessionRef:request.resume??`native:${requests.length}`});
        if(request.phase==='explore'){
          assert.equal(request.resume,undefined);
          return reply({decision:'continue',checkpoint:{findings:[{key:'headers',text:'Header A is v1; header B is v2',basis:'Read both headers'}]}});
        }
        assert.equal(request.phase,'reason');reasons++;
        if(reasons===1){assert.equal(request.contextMode,'full');assert.equal(request.resume,undefined);return reply({decision:'continue',intents:[{key:'headers',title:'Read the two original version headers'}]});}
        assert.equal(request.resume,mode==='reuse-delta'?'native:1':undefined);
        assert.equal(request.contextMode,mode==='reuse-delta'?'delta':'full');
        const board=JSON.parse(request.prompt.split('Saved blackboard:\n').at(-1)!);
        const full=board.fullSnapshot?JSON.parse(readFileSync(board.fullSnapshot.path,'utf8')):board;
        const proposal=full.findings.find((p:any)=>p.key.startsWith('branch:'));
        assert.equal(proposal.status,'proposed');assert.deepEqual(proposal.covers,[]);
        return reply({decision:'complete',checkpoint:{findings:[{key:proposal.key,text:proposal.text,status:'supported',basis:'Owner compared the original headers',covers:['c1']}]}});
      },
    },{sessionMode:'multi',startMode:'reason-first',coordinatorMode:mode}).run(f.task.id);
    assert.equal(result.status,'completed',result.reason);assert.equal(result.phases,3);
    assert.deepEqual(requests.map(r=>r.phase),['reason','explore','reason']);
  }finally{f.close();}
});

for(const first of ['bootstrap-first','reason-first'] as const)test(`Resume preserves the saved ${first} decision across reload and a changed flag`,async()=>{
  const f=fixture();
  try{
    const firstRun=await new Scheduler(f.engine,f.owner,{async execute(){return {output:'{"decision":"suspend","reason":"Need an additional source"}'};}},{sessionMode:'multi',startMode:first}).run(f.task.id);
    assert.equal(firstRun.status,'suspended');
    const saved=f.store.get(f.task.id).scheduler!.start;f.store.close();
    const store=new Store(f.path),engine=new Engine(store);
    try{
      engine.resume(f.task.id,f.owner);
      const result=await new Scheduler(engine,f.owner,{async execute(request){assert.equal(request.phase,'reason');return complete();}},{startMode:first==='reason-first'?'bootstrap-first':'reason-first'}).run(f.task.id);
      assert.equal(result.status,'completed',result.reason);assert.deepEqual(store.get(f.task.id).scheduler!.start,saved);
      assert.equal(store.events(f.task.id).filter(e=>e.kind==='scheduler.start_selected').length,1);
    }finally{store.close();}
  }finally{rmSync(f.cwd,{recursive:true,force:true});}
});

test('A new entry flag cannot bypass native liveness checks on a legacy in-flight task',async()=>{
  const f=fixture();let calls=0;
  try{
    const task=f.store.get(f.task.id);
    task.scheduler={version:1,epoch:task.owner.epoch,bootstrapDone:true,sequence:1,status:'interrupted',failedBranches:[],inflight:[{id:'old-phase',phase:'bootstrap',startedAt:task.createdAt,fingerprint:'old',sessionRef:'native:old'}]};
    f.store.save(task,'test.legacy',{},f.engine.at());
    const result=await new Scheduler(f.engine,f.owner,{canResume:()=>false,async execute(){calls++;return complete();}},{startMode:'reason-first'}).run(task.id);
    assert.equal(result.status,'failed');assert.match(result.reason!,/process exit is unknown/);assert.equal(calls,0);
    assert.equal(f.store.get(task.id).scheduler!.start,undefined);
    assert.equal(f.store.get(task.id).scheduler!.inflight[0]!.sessionRef,'native:old');
  }finally{f.close();}
});

test('Invalid SDK start mode is rejected before scheduler state is written',()=>{
  const f=fixture();
  try{
    assert.throws(()=>new Scheduler(f.engine,f.owner,{async execute(){return complete();}},{startMode:'unknown'} as unknown as SchedulerOptions),/startMode must be/);
    assert.equal(f.store.get(f.task.id).scheduler,undefined);
  }finally{f.close();}
});

test('Timeline displays the selected entry and rationale without unaccepted results',()=>{
  const event=projectEvent({seq:1,at:'2026-10-18T00:00:00Z',kind:'scheduler.start_selected',payload:{requested:'auto',selected:'reason-first',basis:'saved-state',reason:'Review saved findings before doing more work',candidate:'PRIVATE_SENTINEL'}});
  assert.equal(event.title,'选择启动方式');assert.equal(event.summary,'auto → reason-first');
  assert.match(event.detail!,/Review saved findings/);assert.equal(JSON.stringify(event).includes('PRIVATE_SENTINEL'),false);
});
