import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {Store} from '../src/core/store.js';
import {Engine} from '../src/core/engine.js';
import {ToolRuntime} from '../src/tools.js';
import {evidenceRelations} from '../src/core/graph.js';
import {projectTask} from '../src/ui/view.js';
import {projectGraph} from '../src/ui/graph.js';
import {handleNative,hookOutput} from '../src/adapters/hooks.js';

const session={host:'codex' as const,sessionId:'graph-main',cwd:'/fixture'};
function fixture(){const store=new Store(':memory:');let now=0;const engine=new Engine(store,()=>new Date(Date.UTC(2026,9,16)+now++));const runtime=new ToolRuntime(engine,session);return {store,engine,runtime};}
async function all(runtime:ToolRuntime,input:Record<string,unknown>,between?:()=>void){
  const first=await runtime.invoke('cairn_read',input) as any;
  if(first.complete)return {page:first,data:first.data};
  let serialized=first.chunk,next=first.nextOffset;between?.();
  while(next!==undefined){const page=await runtime.invoke('cairn_read',{...input,snapshot:first.snapshot,checksum:first.checksum,revision:first.revision,offset:next}) as any;serialized+=page.chunk;next=page.nextOffset;}
  assert.equal(createHash('sha256').update(serialized).digest('hex'),first.checksum);
  return {page:first,data:JSON.parse(serialized)};
}

test('small contexts include the entire semantic graph with sources and closed relationships',async()=>{
  const f=fixture();try{
    const task=f.engine.create(session,{origin:'input',goal:'verify',criteria:['verify'],constraints:['read-only'],evidenceMode:'curated'});
    f.engine.update(task.id,session,{finding:{key:'fact',text:'Checked fact',basis:'Actual explanation',references:['fixture.json']}});
    f.engine.hint(task.id,session,'Human background','operator');
    const context=f.engine.context(task.id);
    assert.equal(context.graph.complete,true);const graph=context.graph.data!;
    assert.equal(graph.goal,'verify');assert.deepEqual(graph.constraints,['read-only']);
    assert.equal(graph.nodes.filter(n=>n.kind==='claim').length,1);
    assert.ok(graph.nodes.some(n=>n.source==='human'&&n.label==='Human background'));
    const claim=f.store.get(task.id).claims[0]!;
    assert.ok(graph.edges.some(e=>e.from===`basis:${claim.id}`&&e.to===`claim:${claim.id}`));
    assert.ok(graph.edges.some(e=>e.from===`claim:${claim.id}`&&e.to==='criterion:c1'));
    const ids=new Set(graph.nodes.map(n=>n.id));assert.ok(graph.edges.every(e=>ids.has(e.from)&&ids.has(e.to)));
    const read=await all(f.runtime,context.graph.read);assert.deepEqual(read.data,graph);assert.equal(read.page.checksum,context.graph.checksum);
  }finally{await f.runtime.close();f.store.close();}
});

test('large graphs retain old evidence and long text, with pinned pages across writes and takeover',async()=>{
  const f=fixture();try{
    const task=f.engine.create(session,{origin:'input',goal:'global reasoning',criteria:['verify'],evidenceMode:'curated'});
    f.engine.checkpoint(task.id,session,{summary:'many findings',findings:Array.from({length:80},(_,i)=>({key:`f${i}`,text:(i===0?'OLD_CRITICAL_FACT ':'Recent finding ')+String(i)+' 内容'.repeat(180),basis:'Complete support '.repeat(30)+`END_${i}`,references:[`fixture/${i}.json`]}))});
    const context=f.engine.context(task.id);assert.equal(context.graph.complete,false);assert.ok(!JSON.stringify(context.claims).includes('OLD_CRITICAL_FACT'));
    assert.ok(Buffer.byteLength(JSON.stringify(context))<=16000);
    const beforeCount=f.store.events(task.id).length;
    const result=await all(f.runtime,{view:'graph',task_id:task.id,limit:1300},()=>{
      f.engine.hint(task.id,session,'arrived after first page','human');
      f.engine.suspend(task.id,session);f.engine.resume(task.id,{...session,host:'claude',sessionId:'replacement'},true);
    });
    assert.equal(result.data.nodes.filter((n:any)=>n.kind==='claim').length,80);
    assert.ok(JSON.stringify(result.data).includes('OLD_CRITICAL_FACT'));assert.ok(JSON.stringify(result.data).includes('END_79'));
    assert.ok(!JSON.stringify(result.data).includes('arrived after first page'));assert.equal(result.data.owner.epoch,1);
    assert.equal(f.store.events(task.id).length,beforeCount+3,'graph reads added no state');
    const fresh=await all(f.runtime,{view:'graph',task_id:task.id});assert.equal(fresh.data.owner.epoch,2);
    await assert.rejects(f.runtime.invoke('cairn_read',{view:'graph',task_id:task.id,offset:1}),/snapshot/);
    await assert.rejects(f.runtime.invoke('cairn_read',{view:'graph',task_id:task.id,snapshot:result.page.snapshot,checksum:'wrong',offset:1}),/projection changed/);
  }finally{await f.runtime.close();f.store.close();}
});

test('handoffs preserve relevant evidence, competing hypotheses and ancestry without acquiring ownership',async()=>{
  const f=fixture();const viewer=new ToolRuntime(f.engine,{...session,sessionId:''});try{
    const task=f.engine.create(session,{origin:'input',goal:'root goal',constraints:['read-only'],criteria:['cause','separate check'],evidenceMode:'curated',branches:[
      {key:'root',title:'parent',status:'running'},
      {key:'logs',title:'logs',parent:'root',executor:'subagent',status:'pending',question:'Which evidence explains the issue?'},
      {key:'counter',title:'counter-check',status:'running'},
      {key:'unrelated',title:'unrelated',status:'running'},
    ]});
    f.engine.checkpoint(task.id,session,{summary:'evidence',findings:[
      {key:'cause',text:'Target explanation',basis:'LOG_SUPPORT',references:['logs.json'],covers:['c1'],branch:'logs'},
      {key:'counter',text:'Rejected alternative',status:'refuted',basis:'COUNTER_BASIS',references:['counter.json'],covers:['c1'],branch:'counter'},
      {key:'other',text:'UNRELATED_CONTENT',basis:'other basis',covers:['c2'],branch:'unrelated'},
    ]});
    const before=JSON.stringify(f.store.get(task.id)),events=f.store.events(task.id).length;
    const {data}=await all(viewer,{view:'handoff',task_id:task.id,ref:'branch:logs',limit:700});
    assert.equal(data.goal.text,'root goal');assert.equal(data.goal.criteria.length,2);assert.equal(data.goal.criteria[0].id,'c1');
    assert.equal(data.assignment.question,'Which evidence explains the issue?');
    assert.ok(JSON.stringify(data).includes('COUNTER_BASIS'));assert.ok(!JSON.stringify(data).includes('UNRELATED_CONTENT'));
    assert.ok(data.graph.nodes.some((n:any)=>n.id==='branch:root'));assert.ok(data.graph.selection.omittedNodes>0);
    const ids=new Set(data.graph.nodes.map((n:any)=>n.id));assert.ok(data.graph.edges.every((e:any)=>ids.has(e.from)&&ids.has(e.to)));
    assert.equal(JSON.stringify(f.store.get(task.id)),before);assert.equal(f.store.events(task.id).length,events);
    await assert.rejects(viewer.invoke('cairn_update',{branch:{key:'logs',status:'running'}}),/Bind this MCP connection/);
    await assert.rejects(viewer.invoke('cairn_read',{view:'handoff',task_id:task.id,ref:'foreign'}),/does not belong/);
  }finally{await viewer.close();await f.runtime.close();f.store.close();}
});

test('model and UI share evidence relations, including intended coverage distinct from accepted coverage',async()=>{
  const f=fixture();try{
    const task=f.engine.create(session,{origin:'input',goal:'verify',criteria:['verify'],evidenceMode:'curated'});
    f.engine.update(task.id,session,{finding:{key:'guess',text:'A hypothesis',status:'proposed',basis:'A clue',covers:['c1']}});
    const saved=f.store.get(task.id),model=await all(f.runtime,{view:'graph'}),ui=projectGraph(projectTask(f.engine,saved));
    assert.ok(model.data.edges.some((e:any)=>e.relation==='addresses'));assert.ok(!model.data.edges.some((e:any)=>e.relation==='criterion'));
    for(const edge of evidenceRelations(saved)){
      assert.ok(ui.edges.some(e=>e.from===edge.from&&e.to===edge.to&&e.relation===edge.relation));
      assert.ok(model.data.edges.some((e:any)=>e.from===edge.from&&e.to===edge.to&&e.relation===edge.relation));
    }
    assert.equal(ui.edges.find(e=>e.relation==='addresses')!.state,'pending');
  }finally{await f.runtime.close();f.store.close();}
});

test('deltas reconstruct changed graph state and support a branch created after the base snapshot',async()=>{
  const f=fixture();try{
    const task=f.engine.create(session,{origin:'input',goal:'verify',criteria:['verify'],evidenceMode:'curated'});
    f.engine.update(task.id,session,{finding:{key:'fact',text:'An unconfirmed explanation',status:'proposed',covers:['c1']}});
    const old=await all(f.runtime,{view:'graph'});
    f.engine.update(task.id,session,{branch:{key:'new',title:'new branch',status:'running'}});
    f.engine.update(task.id,session,{finding:{key:'fact',text:'A fact',status:'supported',basis:'Its support',branch:'new'}});
    const delta=await all(f.runtime,{view:'graph',since:old.page.snapshot,limit:500});
    const current=await all(f.runtime,{view:'graph',snapshot:delta.page.snapshot});
    const nodes=new Map(old.data.nodes.map((n:any)=>[n.id,n]));for(const id of delta.data.removed)nodes.delete(id);for(const n of [...delta.data.added,...delta.data.updated])nodes.set(n.id,n);
    assert.deepEqual([...nodes.values()].sort((a:any,b:any)=>a.id.localeCompare(b.id)),current.data.nodes.slice().sort((a:any,b:any)=>a.id.localeCompare(b.id)));
    assert.equal(delta.data.current.revision,current.data.revision);
    const edgeKey=(e:any)=>JSON.stringify([e.from,e.to,e.relation]);const edges=new Map(old.data.edges.map((e:any)=>[edgeKey(e),e]));
    for(const edge of delta.data.removedEdges)edges.delete(edgeKey(edge));for(const edge of delta.data.addedEdges)edges.set(edgeKey(edge),edge);
    assert.deepEqual([...edges.keys()].sort(),current.data.edges.map(edgeKey).sort());assert.ok(delta.data.removedEdges.some((e:any)=>e.relation==='addresses'));
    const focused=await all(f.runtime,{view:'graph',since:old.page.snapshot,ref:'new'});assert.ok(focused.data.added.some((n:any)=>n.id==='branch:new'));
    const empty=await all(f.runtime,{view:'graph',since:current.page.snapshot});assert.deepEqual(empty.data.added,[]);assert.deepEqual(empty.data.updated,[]);
  }finally{await f.runtime.close();f.store.close();}
});

test('native startup and compaction supply read-only graph access, without leaking a new goal to an old child',async()=>{
  for(const host of ['claude','codex'] as const){
    const store=new Store(':memory:'),engine=new Engine(store),owner={...session,host},viewer=new ToolRuntime(engine,{...owner,sessionId:''});
    try{
      const task=engine.create(owner,{origin:'input',goal:'original goal',criteria:['proof'],evidenceMode:'curated'});
      engine.update(task.id,owner,{finding:{key:'old',text:'An earlier finding',basis:'Actual source'}});
      const event={type:'SubagentStart',sessionId:owner.sessionId,cwd:owner.cwd,agentId:'known-child'};
      const result=handleNative(engine,host,event),output=hookOutput(event,result);
      const message=(output as any).hookSpecificOutput.additionalContext;
      const access=JSON.parse(message.slice(message.lastIndexOf('\n')+1));
      assert.equal(access.role,'helper');assert.equal(access.parentTaskId,task.id);assert.equal(access.graph.complete,false);
      const graph=await all(viewer,access.graph.read);assert.equal(graph.data.goal,'original goal');assert.ok(graph.data.nodes.some((n:any)=>n.label==='An earlier finding'));
      const restore=handleNative(engine,host,{type:'PostCompact',sessionId:owner.sessionId,cwd:owner.cwd});
      assert.equal(JSON.parse(restore.context!).graph.snapshot,access.graph.snapshot);
      engine.suspend(task.id,owner);const other=engine.create(owner,{origin:'input',goal:'do not leak this goal',criteria:['proof'],evidenceMode:'curated'});
      const late=handleNative(engine,host,event);assert.equal(late.context,undefined);assert.equal(store.get(other.id).agentRuns,undefined);
    }finally{await viewer.close();store.close();}
  }
});

test('graph snapshots are task scoped and omit raw IO; a curated privacy change fences old pages',async()=>{
  const f=fixture();try{
    const t=f.engine.create(session,{origin:'input',goal:'capture',criteria:['proof'],evidenceMode:'captured'});
    const obs=f.engine.observe(t.id,session,{callId:'private-call',tool:'PRIVATE_TOOL',input:'PRIVATE_INPUT',output:'PRIVATE_OUTPUT',source:'hook',status:'success'});
    f.engine.checkpoint(t.id,session,{summary:'proof',findings:[{key:'fact',text:'A verified observation',evidence:[obs.id]}]});
    const old=await all(f.runtime,{view:'graph',limit:400});
    assert.ok(JSON.stringify(old.data).includes('PRIVATE_TOOL'));assert.ok(!JSON.stringify(old.data).includes('PRIVATE_INPUT'));assert.ok(!JSON.stringify(old.data).includes('PRIVATE_OUTPUT'));
    const other=f.engine.create({...session,sessionId:'other'},{origin:'other',goal:'other',criteria:['done'],evidenceMode:'curated'});
    await assert.rejects(f.runtime.invoke('cairn_read',{view:'graph',task_id:other.id,snapshot:old.page.snapshot}),/does not belong/);
    const converted=f.store.get(t.id);converted.evidenceMode='curated';f.store.save(converted,'mode.changed',{},f.engine.at());
    await assert.rejects(f.runtime.invoke('cairn_read',{view:'graph',task_id:t.id,snapshot:old.page.snapshot,checksum:old.page.checksum,offset:400}),/projection changed/);
    const sanitized=await all(f.runtime,{view:'graph',task_id:t.id,snapshot:old.page.snapshot});
    assert.ok(!JSON.stringify(sanitized.data).includes('PRIVATE_TOOL'));assert.ok(sanitized.data.nodes.some((n:any)=>n.kind==='unavailable'));
  }finally{await f.runtime.close();f.store.close();}
});

test('indexes keep every node and edge while missing references remain explicit and never query foreign tasks',async()=>{
  const f=fixture();try{
    const t=f.engine.create(session,{origin:'input',goal:'legacy',criteria:['proof'],evidenceMode:'curated'});
    const broken=f.store.get(t.id);broken.criteria[0]!.claimIds=['missing-claim'];f.store.save(broken,'imported',{},f.engine.at());
    const full=await all(f.runtime,{view:'graph'}),index=await all(f.runtime,{view:'graph',format:'index'});
    assert.ok(full.data.nodes.some((n:any)=>n.id==='claim:missing-claim'&&n.status==='unavailable'));
    assert.deepEqual(index.data.edges,full.data.edges);assert.equal(index.data.nodes.length,full.data.nodes.length);
    const ids=new Set(full.data.nodes.map((n:any)=>n.id));assert.ok(full.data.edges.every((e:any)=>ids.has(e.from)&&ids.has(e.to)));
  }finally{await f.runtime.close();f.store.close();}
});
