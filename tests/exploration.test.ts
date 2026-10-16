import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../src/core/store.js';
import {Engine} from '../src/core/engine.js';
import {ToolRuntime} from '../src/tools.js';
import {needsReview} from '../src/core/exploration.js';
import {semanticGraph} from '../src/core/graph.js';
import {projectTask,projectEvent} from '../src/ui/view.js';
import {projectGraph,layoutGraph} from '../src/ui/graph.js';
import {compareCheckpoint} from '../src/ui/replay.js';
import {handleNative} from '../src/adapters/hooks.js';
import type {Host} from '../src/core/types.js';

function fixture(host:Host='codex'){
 const store=new Store(':memory:');let clock=0;
 const engine=new Engine(store,()=>new Date(Date.UTC(2026,9,16)+clock++*1000));
 const session={host,sessionId:'main',cwd:'/fixture'},runtime=new ToolRuntime(engine,session);
 const task=engine.create(session,{origin:'reported error',goal:'fix it',criteria:['fixed'],evidenceMode:'curated'});
 const update=(input:any)=>runtime.invoke('cairn_update',input) as Promise<any>;
 const snapshot=()=>engine.context(task.id).graph.snapshot;
 const review=()=>update({review:{snapshot:snapshot(),summary:'Read the graph, reconciled sources and results'}});
 const source=()=>update({finding:{key:'source',text:'Cache key omits region',basis:'Checked fixture',covers:[]}});
 const explore=()=>update({branch:{key:'test',title:'Test cache explanation',status:'running',from:['source']}});
 const output=()=>update({finding:{key:'result',text:'Regression passed',basis:'Actual regression',covers:['c1'],producedBy:'test'}});
 return {store,engine,session,runtime,task,update,snapshot,review,source,explore,output};
}

test('versioned source facts connect an exploration to its explicit output in both model and UI',async()=>{
 const f=fixture();try{
  await f.source();await f.explore();await f.output();
  const task=f.store.get(f.task.id),source=task.claims[0]!,result=task.claims[1]!;
  assert.deepEqual(task.branches![0]!.from,[source.id]);assert.equal(result.derivation!.inputs[0]!.revision,1);
  const model=semanticGraph(task,f.engine.evaluate(task)),ui=projectGraph(projectTask(f.engine,task));
  const exploration=model.nodes.find(node=>node.kind==='exploration')!;
  for(const edge of [{from:`claim:${source.id}`,to:exploration.id,relation:'input'},{from:exploration.id,to:`claim:${result.id}`,relation:'produces'}]){
   assert.ok(model.edges.some(e=>e.from===edge.from&&e.to===edge.to&&e.relation===edge.relation));
   assert.ok(ui.edges.some(e=>e.from===edge.from&&e.to===edge.to&&e.relation===edge.relation));
  }
  const layout=layoutGraph(ui,'vertical'),a=layout.nodes.find(n=>n.id===`claim:${source.id}`)!,b=layout.nodes.find(n=>n.id===exploration.id)!,c=layout.nodes.find(n=>n.id===`claim:${result.id}`)!;
  assert.ok(a.rank<b.rank&&b.rank<c.rank);
  await f.update({finding:{key:'member',text:'Only a member',basis:'Independent fact',branch:'test',covers:[]}});
  const member=f.store.get(f.task.id).claims.find(c=>c.key==='member')!;
  assert.ok(!semanticGraph(f.store.get(f.task.id),f.engine.check(f.task.id)).edges.some(e=>e.to===`claim:${member.id}`&&e.relation==='produces'));
  assert.equal(Object.keys(task.calls).length,0);assert.equal(task.observations.length,0);
 }finally{await f.runtime.close();f.store.close();}
});

test('source lookup rejects foreign, uncertain and cyclic evidence and rolls back atomically',async()=>{
 const f=fixture();try{
  await f.source();const before=f.store.events(f.task.id).length;
  await assert.rejects(f.update({branch:{key:'bad',title:'bad',status:'running',from:['foreign']}}),/unknown/);
  assert.equal(f.store.events(f.task.id).length,before);assert.equal(f.store.get(f.task.id).branches,undefined);
  await f.update({finding:{key:'guess',text:'Maybe',status:'proposed',covers:[]}});
  await assert.rejects(f.update({branch:{key:'bad',title:'bad',status:'running',from:['guess']}}),/supported fact/);
  await f.explore();await f.output();
  await f.update({branch:{key:'back',title:'back',status:'running',from:['result']}});
  const raw=JSON.stringify(f.store.get(f.task.id));
  await assert.rejects(f.update({finding:{key:'source',text:'Circular source',basis:'No',producedBy:'back'}}),/descendants/);
  assert.equal(JSON.stringify(f.store.get(f.task.id)),raw);
 }finally{await f.runtime.close();f.store.close();}
});

test('revised sources invalidate downstream conclusions, retain old source text and require fresh provenance',async()=>{
 const f=fixture();try{
  await f.source();await f.explore();await f.output();await f.update({branch:{key:'test',status:'completed',summary:'Regression checked'}});await f.review();
  assert.ok(f.engine.check(f.task.id).ok);
  await f.update({finding:{key:'source',text:'Cache also distinguishes currency',basis:'New concrete evidence'}});
  let task=f.store.get(f.task.id);assert.ok(needsReview(task,task.claims.find(c=>c.key==='result')!));
  await f.review();assert.ok(!f.engine.check(f.task.id).ok,'acknowledgement cannot repair stale evidence');
  const graph=semanticGraph(task,f.engine.evaluate(task));
  assert.ok(graph.nodes.some(n=>n.kind==='fact'&&n.label==='Cache key omits region'));
  assert.ok(graph.nodes.some(n=>n.kind==='claim'&&n.status==='needs_review'));
  await f.update({branch:{key:'test',status:'running',from:['source']}});await f.output();
  await f.update({branch:{key:'test',status:'completed',summary:'Recomputed regression on revised input'}});await f.review();
  task=f.store.get(f.task.id);assert.ok(f.engine.check(task.id).ok);assert.equal(task.claims.find(c=>c.key==='result')!.derivation!.inputs[0]!.revision,2);
 }finally{await f.runtime.close();f.store.close();}
});

test('global review is snapshot fenced, idempotent and does not swallow later evidence',async()=>{
 const f=fixture();try{
  await f.source();await f.explore();await f.output();const read=f.snapshot();
  await f.update({finding:{key:'later',text:'Later evidence',basis:'Late arrival',covers:[]}});
  await f.update({review:{snapshot:read,summary:'Reviewed original evidence'}});
  assert.equal(f.store.get(f.task.id).review!.pending.length,1);
  const count=f.store.events(f.task.id).length;await f.update({review:{snapshot:read,summary:'Reviewed original evidence'}});assert.equal(f.store.events(f.task.id).length,count);
  await f.update({branch:{key:'test',status:'completed',summary:'Done'}});
  assert.equal((await f.runtime.invoke('cairn_finish',{}) as any).phase,'incomplete');
  await f.review();assert.equal((await f.runtime.invoke('cairn_finish',{}) as any).phase,'completed');
 }finally{await f.runtime.close();f.store.close();}
});

test('human feedback appends without owner binding in active, suspended and completed tasks',async()=>{
 const f=fixture(),human=new ToolRuntime(f.engine,{host:'mcp',sessionId:'',cwd:'/other'});try{
  const feedback=(key:string)=>human.invoke('cairn_update',{feedback:{task_id:f.task.id,key,text:'Check the boundary case',author:'Operator'}}) as Promise<any>;
  const owner=f.store.get(f.task.id).owner;
  await feedback('active');f.engine.suspend(f.task.id,f.session);await feedback('suspended');
  f.engine.resume(f.task.id,f.session);await f.source();await f.review();
  await f.update({finding:{key:'source',covers:['c1'],text:'Complete',basis:'Verified'}});await f.review();await f.runtime.invoke('cairn_finish',{});
  assert.equal(f.store.get(f.task.id).status,'completed');await feedback('completed');
  assert.equal(f.store.get(f.task.id).status,'completed');assert.deepEqual(f.store.get(f.task.id).owner,owner);
  const count=f.store.events(f.task.id).length;assert.equal((await feedback('completed')).changed,false);assert.equal(f.store.events(f.task.id).length,count);
  await assert.rejects(human.invoke('cairn_update',{feedback:{task_id:f.task.id,key:'completed',text:'Mutated history',author:'Operator'}}),/immutable/);
  await assert.rejects(human.invoke('cairn_update',{finding:{key:'intruder',text:'No',basis:'No'}}),/Bind this MCP/);
 }finally{await human.close();await f.runtime.close();f.store.close();}
});

test('explicit reopen preserves completed history and fences old MCP connections even with the same session ID',async()=>{
 const f=fixture();try{
  await f.source();await f.explore();await f.output();await f.update({branch:{key:'test',status:'completed',summary:'Done'}});await f.review();await f.runtime.invoke('cairn_finish',{});
  const completed=f.snapshot(),historical=JSON.stringify(f.store.historical(f.task.id,completed));
  const next=new ToolRuntime(f.engine,f.session);
  try{
   await next.invoke('cairn_resume',{task_id:f.task.id,reopen:{reason:'External reproduction disproves coverage'}});
   assert.equal(f.store.get(f.task.id).owner.epoch,2);
   await assert.rejects(f.update({finding:{key:'late',text:'Late write',basis:'Old connection'}}),/older execution epoch/);
   assert.equal(JSON.stringify(f.store.historical(f.task.id,completed)),historical);
   assert.equal((await next.invoke('cairn_finish',{}) as any).phase,'incomplete');
   handleNative(f.engine,'codex',{type:'SubagentStop',sessionId:'main',cwd:'/fixture',agentId:'old-child'});
   assert.equal(f.store.get(f.task.id).agentRuns,undefined);
  }finally{await next.close();}
 }finally{await f.runtime.close();f.store.close();}
});

test('new owners need explicit takeover to reopen; graph replay shows feedback, review and reopen at their saved times',async()=>{
 const f=fixture();try{
  await f.source();await f.explore();await f.output();await f.update({branch:{key:'test',status:'completed',summary:'Done'}});await f.review();await f.runtime.invoke('cairn_finish',{});
  const done=f.snapshot(),old=projectTask(f.engine,f.store.historical(f.task.id,done).task);
  f.engine.feedback(f.task.id,{text:'New test fails',author:'Tester',key:'case'});
  const other={host:'claude' as const,sessionId:'new',cwd:'/fixture'};
  assert.throws(()=>f.engine.reopen(f.task.id,other,'Repair the new case'),/takeover/);
  f.engine.reopen(f.task.id,other,'Repair the new case',true);
  const task=f.store.get(f.task.id),view=projectTask(f.engine,task),delta=compareCheckpoint(view,old);
  for(const direction of ['vertical','horizontal'] as const){
   const layout=layoutGraph(projectGraph(view),direction);
   for(let i=0;i<layout.nodes.length;i++)for(let j=i+1;j<layout.nodes.length;j++){
    const a=layout.nodes[i]!,b=layout.nodes[j]!;
    assert.ok(a.x+225<=b.x||b.x+225<=a.x||a.y+94<=b.y||b.y+94<=a.y,`Overlapping ${a.id} / ${b.id} in ${direction}`);
   }
  }
  assert.ok(delta.changes.some(change=>change.kind==='goal'&&change.label.includes('重开')));
  assert.ok(delta.changes.some(change=>change.kind==='hint'));assert.ok(delta.changes.some(change=>change.kind==='global-review'));
  const events=f.store.events(task.id).map(projectEvent);assert.ok(events.some(event=>event.title==='任务重开'&&event.summary==='Repair the new case'));
  assert.equal(task.calls&&Object.keys(task.calls).length,0);assert.equal(task.observations.length,0);
 }finally{await f.runtime.close();f.store.close();}
});

test('Pi, Claude, Codex and generic MCP share the source/exploration/result/review contract',async()=>{
 for(const host of ['pi','claude','codex','mcp'] as const){const f=fixture(host);try{
  await f.source();await f.explore();await f.output();await f.update({branch:{key:'test',status:'completed',summary:'Checked'}});await f.review();
  assert.equal((await f.runtime.invoke('cairn_finish',{}) as any).phase,'completed');
 }finally{await f.runtime.close();f.store.close();}}
});

test('multiple source facts and transitive version changes remain explicit across exploration attempts',async()=>{
 const f=fixture();try{
  await f.source();await f.update({finding:{key:'order',text:'Failure flips with order',basis:'Two actual sequences',covers:[]}});
  await f.update({branch:{key:'test',title:'Joint verification',status:'running',from:['source','order']}});await f.output();
  await f.update({branch:{key:'test',status:'completed',summary:'Joint checks passed'}});
  await f.update({branch:{key:'second',title:'Verify repair',status:'running',from:['result']}});
  await f.update({finding:{key:'final',text:'Repair is verified',basis:'Separate regression',producedBy:'second',covers:['c1']}});
  await f.update({finding:{key:'order',text:'A new order reveals another case',basis:'New reproduction'}});
  const task=f.store.get(f.task.id);assert.ok(needsReview(task,task.claims.find(c=>c.key==='final')!));
  await f.update({branch:{key:'test',status:'running',from:['source','order']}});
  const graph=semanticGraph(f.store.get(task.id),f.engine.check(task.id));
  const attempts=graph.nodes.filter(n=>n.kind==='exploration'&&n.branch==='test');assert.equal(attempts.length,2);
  assert.equal(graph.edges.filter(e=>e.to===attempts.find(n=>n.data.current)!.id&&e.relation==='input').length,2);
  assert.ok(graph.nodes.some(n=>n.kind==='fact'&&n.label==='Failure flips with order'));
 }finally{await f.runtime.close();f.store.close();}
});

test('reviews reject another task snapshot and scoped source facts cannot be borrowed',async()=>{
 const f=fixture();try{
  await f.source();await f.explore();await f.output();
  const other=f.engine.create({...f.session,sessionId:'other'},{origin:'other',goal:'other',criteria:['other'],scope:{region:'south'},evidenceMode:'curated'});
  const seq=f.engine.context(other.id).graph.snapshot;
  await assert.rejects(f.update({review:{snapshot:seq,summary:'Wrong task'}}),/does not belong/);
  const runtime=new ToolRuntime(f.engine,{...f.session,sessionId:'other'});
  try{
   await runtime.invoke('cairn_update',{finding:{key:'narrow',text:'North only',basis:'North evidence',scope:{region:'north'},covers:[]}});
   await assert.rejects(runtime.invoke('cairn_update',{branch:{key:'bad',title:'bad',status:'running',from:['narrow']}}),/scope/);
  }finally{await runtime.close();}
 }finally{await f.runtime.close();f.store.close();}
});
