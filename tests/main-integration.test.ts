import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Engine} from '../src/core/engine.js';
import {Store} from '../src/core/store.js';
import {phaseUsage} from '../src/core/usage.js';
import {semanticGraph,relatedGraph} from '../src/core/graph.js';
import {parsePhaseOutput} from '../src/scheduler/protocol.js';
import {Scheduler} from '../src/scheduler.js';

const owner={host:'mcp' as const,sessionId:'integration',cwd:'/fixture'};
function setup(){const store=new Store(':memory:'),engine=new Engine(store);const task=engine.create(owner,{origin:'Original input',goal:'Check a general result',criteria:['Verified result'],evidenceMode:'curated'});return {store,engine,task};}

test('complete graph retains delegated joint prerequisites, strips lease tokens and connects related handoffs',()=>{
 const {store,engine,task}=setup();try{
  engine.checkpoint(task.id,owner,{summary:'Two inputs and an independent direction',findings:[{key:'a',text:'Source A',basis:'Read A'},{key:'b',text:'Source B',basis:'Read B'}],progress:[{key:'compare',title:'Compare sources',status:'pending',delegated:true,from:['a','b']}]});
  engine.branch(task.id,{host:'mcp',sessionId:'worker',cwd:'/fixture'},'compare','claim');
  const state=store.get(task.id),graph=semanticGraph(state,engine.evaluate(state));
  assert.equal(graph.edges.filter(edge=>edge.to==='work:agent:compare'&&edge.relation==='dependency').length,2);
  assert.ok(!JSON.stringify(graph).includes(state.progress![0]!.lease!.token));
  const packet=relatedGraph(graph,'work:agent:compare');
  assert.equal(packet.nodes.filter(node=>node.kind==='claim').length,2);
 }finally{store.close();}
});

test('scheduler phase totals are attributed once without changing proof or inventing missing usage',()=>{
 const {store,engine,task}=setup();try{
  const metrics={host:'pi',usageIsLowerBound:true,assistantTurns:2,toolCalls:3,usage:{input_tokens:120,output_tokens:20,cached_input_tokens:40,cache_write_input_tokens:10}};
  phaseUsage(engine,owner,'one',metrics);phaseUsage(engine,owner,'one',metrics);
  phaseUsage(engine,owner,'missing',{host:'pi',usage:null});
  const saved=store.get(task.id);
  assert.deepEqual(saved.usage?.tokens,{input:120,output:20,cacheRead:40,cacheWrite:10,reasoning:0});
  assert.equal(saved.usage?.partial,true);assert.equal(saved.usage?.toolCalls,3);assert.equal(saved.usage?.modelCalls,2);assert.equal(saved.revision,task.revision);
  assert.deepEqual(saved.usage?.sources,['pi/scheduler']);assert.equal(saved.claims.length,0);
 }finally{store.close();}
});

test('worker phase cannot acknowledge owner review and a stale snapshot leaves later feedback pending',()=>{
 const {store,engine,task}=setup();try{
  assert.throws(()=>parsePhaseOutput('{"decision":"continue","review":{"snapshot":1,"summary":"Accept"}}',true),/Workers cannot acknowledge/);
  engine.addHint(task.id,'First input');const first=store.graphState(task.id).seq;
  engine.addHint(task.id,'Later input');
  engine.update(task.id,owner,{review:{snapshot:first,summary:'Reviewed only first input'}});
  assert.equal(store.get(task.id).review?.pending.length,1);
  assert.match(engine.check(task.id).issues.join(';'),/global review/);
 }finally{store.close();}
});

test('auto startup sees mainline semantic branches and preserves their completion gate',async()=>{
 const {store,engine,task}=setup();try{
  engine.update(task.id,owner,{branch:{key:'inspect',title:'Inspect source',status:'running',executor:'main'}});
  let calls=0;
  const result=await new Scheduler(engine,owner,{async execute(request){
   calls++;assert.equal(request.phase,'reason');
   const board=JSON.parse(request.prompt.split('Saved blackboard:\n')[1]!);
   assert.equal(board.branches[0].key,'inspect');assert.ok(board.acceptance.issues.some((issue:string)=>issue.includes('Branch inspect')));
   return {output:'{"decision":"suspend","reason":"Source inspection remains incomplete"}'};
  }}).run(task.id);
  assert.equal(calls,1);assert.equal(result.status,'suspended');assert.equal(store.get(task.id).scheduler?.start?.basis,'saved-state');
 }finally{store.close();}
});
