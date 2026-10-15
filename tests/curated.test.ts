import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/core/store.js';
import { Engine } from '../src/core/engine.js';
import type { Session, CheckpointInput } from '../src/core/types.js';

const owner:Session={host:'codex',sessionId:'curated-owner',cwd:'/workspace'};
const nextOwner:Session={host:'claude',sessionId:'curated-next',cwd:'/workspace'};
function setup(criteria=['Explain the cause']){
  const store=new Store(':memory:'),engine=new Engine(store);
  const task=engine.create(owner,{origin:'user',goal:'Investigate the price issue',criteria,evidenceMode:'curated'});
  return {store,engine,task};
}

test('curated task completes with agent explanations and file/link references without storing tool activity',()=>{
  const {store,engine,task}=setup(['Cause','Impact']);
  assert.deepEqual(task.budget,{});
  const events=store.events(task.id).length;
  assert.equal(engine.beforeTool(task.id,owner,'read','shell').untracked,true);
  assert.equal(store.events(task.id).length,events);
  assert.throws(()=>engine.observe(task.id,owner,{callId:'read',tool:'shell',input:{command:'secret'},output:'secret',source:'hook',status:'success'}),/do not retain tool/);
  const result=engine.finish(task.id,owner,{outcome:'completed',summary:'Client price mapping applies the scale twice',findings:[
    {key:'cause',text:'Version 1.4 scales prices twice',basis:'The mapping source multiplies the already normalized price by 100.',references:['src/mapping.ts:12'],covers:['c1']},
    {key:'impact',text:'Only the 1.4 cohort is affected',references:['https://example.test/cohort-1.4'],covers:['c2']},
  ]});
  assert.equal(result.phase,'completed');assert.equal(result.validation.ok,true);
  const saved=store.get(task.id);
  assert.deepEqual(saved.calls,{});assert.deepEqual(saved.observations,[]);assert.equal(saved.claims[0]?.provenance,'agent');
  assert.equal(saved.report?.citations.length,0);assert.equal(saved.report?.curatedReferences?.length,2);
  assert.deepEqual(saved.report?.curatedReferences?.[0]?.references,['src/mapping.ts:12']);
  assert.ok(!store.events(task.id).some(event=>event.kind.startsWith('tool.')||event.kind==='observation.captured'));
  store.close();
});

test('unsupported curated claims cannot be promoted without a nonempty basis or reference',()=>{
  const {store,engine,task}=setup();
  for(const status of ['supported','refuted'] as const){
    assert.throws(()=>engine.checkpoint(task.id,owner,{summary:'Attempt',findings:[{text:'A claim without grounds',status,basis:'  ',references:[]}]}),/need an explanation/);
  }
  assert.throws(()=>engine.checkpoint(task.id,owner,{summary:'Attempt',findings:[{text:'Claim',references:[' ']}]}),/nonempty strings/);
  assert.throws(()=>engine.checkpoint(task.id,owner,{summary:'Attempt',findings:[{text:'Claim',evidence:['E1']}]}),/without raw observations/);
  assert.equal(store.get(task.id).claims.length,0);
  const result=engine.checkpoint(task.id,owner,{summary:'Open hypothesis',findings:[{key:'hypothesis',text:'The mapping may be wrong',status:'proposed',covers:['c1']}]});
  assert.equal(result.check.ok,false);assert.deepEqual(store.get(task.id).criteria[0]?.claimIds,[]);
  assert.deepEqual(store.get(task.id).claims[0]?.relatedCriteria,['c1']);store.close();
});

test('curated report validates local supported claims and preserves the distinction from automatic capture',()=>{
  const {store,engine,task}=setup();
  engine.checkpoint(task.id,owner,{summary:'Evidence reviewed',findings:[{key:'cause',text:'Mapping error',basis:'Reviewed source and fixture',references:['mapping.ts:7']}]});
  const report=store.get(task.id).report!;
  assert.equal(engine.validateReport(task.id,report).ok,true);
  const otherTask=engine.create(nextOwner,{origin:'other',goal:'Other task',criteria:['Other'],evidenceMode:'curated'});
  engine.checkpoint(otherTask.id,nextOwner,{summary:'Other',findings:[{text:'Foreign finding',basis:'Other evidence'}]});
  const foreignClaim=store.get(otherTask.id).claims[0]!;
  const forged={...report,curatedReferences:[{claimId:foreignClaim.id,statement:'Foreign',basis:'Other evidence',references:[]}]};
  assert.equal(engine.validateReport(task.id,forged).ok,false);
  assert.equal(engine.validateReport(task.id,{...report,curatedReferences:[{...report.curatedReferences![0]!,references:['unrecorded://reference']}]}).ok,false);
  assert.equal(engine.validateReport(task.id,{...report,curatedReferences:[{...report.curatedReferences![0]!,basis:'Changed explanation'}]}).ok,false);
  assert.equal(engine.validateReport(task.id,{...report,citations:[{observationId:'invented',statement:'Not captured'}]}).ok,false);
  assert.match(engine.context(task.id).readMore,/not automatically verified/);store.close();
});

test('refuted exploratory findings do not block an independent supported conclusion and downgrades remove coverage',()=>{
  const {store,engine,task}=setup();
  engine.checkpoint(task.id,owner,{summary:'Server hypothesis rejected',findings:[{key:'server',text:'Server unavailable',status:'refuted',basis:'Server status is healthy',covers:['c1']}]});
  engine.checkpoint(task.id,owner,{summary:'Client cause found',findings:[{key:'client',text:'Client scales the value twice',basis:'Compared mapping source',covers:['c1']}]});
  let saved=store.get(task.id),client=saved.claims.find(claim=>claim.key==='client')!;
  assert.deepEqual(saved.criteria[0]?.claimIds,[client.id]);assert.equal(engine.check(task.id).ok,true);
  assert.deepEqual(saved.claims.find(claim=>claim.key==='server')?.relatedCriteria,['c1']);
  engine.checkpoint(task.id,owner,{summary:'Client interpretation needs review',findings:[{key:'client',text:'Mapping cause uncertain',status:'inconclusive'}]});
  assert.deepEqual(store.get(task.id).criteria[0]?.claimIds,[]);assert.equal(engine.check(task.id).ok,false);
  engine.checkpoint(task.id,owner,{summary:'Review complete',findings:[{key:'client',text:'Client scales the value twice',status:'supported'}]});
  saved=store.get(task.id);assert.deepEqual(saved.criteria[0]?.claimIds,[client.id]);assert.equal(engine.check(task.id).ok,true);
  store.close();
});

test('progress reflects explicit states, plan replacement and pause/recovery without completing unexecuted steps',()=>{
  const {store,engine,task}=setup();
  engine.recordProgress(task.id,owner,[{key:'read',title:'Review the source',status:'completed'},{key:'compare',title:'Compare versions',status:'running'},{key:'optional',title:'Check metrics',status:'pending'}],'host',true);
  const before=store.events(task.id).length;
  engine.recordProgress(task.id,owner,[{key:'read',title:'Review the source',status:'completed'},{key:'compare',title:'Compare versions',status:'running'},{key:'optional',title:'Check metrics',status:'pending'}],'host',true);
  assert.equal(store.events(task.id).length,before,'unchanged progress does not create audit noise');
  engine.recordProgress(task.id,owner,[{key:'compare',title:'Compare versions',status:'running'}],'host',true);
  let progress=store.get(task.id).progress!;
  assert.equal(progress.find(item=>item.key==='read')?.status,'completed');
  assert.equal(progress.find(item=>item.key==='optional')?.status,'cancelled');
  engine.checkpoint(task.id,owner,{summary:'Still comparing',progress:[{key:'write',title:'Draft conclusions',status:'pending'}]});
  engine.finish(task.id,owner,{outcome:'suspended'});
  progress=store.get(task.id).progress!;assert.equal(progress.find(item=>item.key==='compare')?.status,'blocked');
  assert.match(progress.find(item=>item.key==='compare')?.detail??'',/Paused/);
  assert.equal(progress.find(item=>item.key==='write')?.status,'pending');
  engine.resume(task.id,nextOwner,true);
  assert.throws(()=>engine.recordProgress(task.id,owner,[{key:'late',title:'Late update',status:'completed'}]),/no longer owns/);
  engine.recordProgress(task.id,nextOwner,[{key:'compare',title:'Compare versions',status:'completed'}],'host');
  const result=engine.finish(task.id,nextOwner,{outcome:'completed',findings:[{text:'Mapping confirmed',basis:'Reviewed the version comparison'}]});
  assert.equal(result.phase,'completed');progress=store.get(task.id).progress!;
  assert.equal(progress.find(item=>item.key==='compare')?.status,'completed');
  assert.equal(progress.find(item=>item.key==='write')?.status,'pending','completion does not invent work');store.close();
});

test('checkpoint progress, findings and goal coverage roll back atomically on invalid input',()=>{
  const {store,engine,task}=setup();
  const before=store.get(task.id),events=store.events(task.id).length;
  assert.throws(()=>engine.checkpoint(task.id,owner,{summary:'Atomic',findings:[{text:'Supported',basis:'Review'}],progress:[
    {key:'duplicate',title:'First',status:'completed'},{key:'duplicate',title:'Second',status:'running'},
  ]}),/repeated/);
  assert.deepEqual(store.get(task.id),before);assert.equal(store.events(task.id).length,events);store.close();
});

test('curated deadlines are advisory while explicit captured budgets remain enforced',()=>{
  const {store,engine,task}=setup();engine.suspend(task.id,owner);
  assert.throws(()=>engine.create(owner,{origin:'user',goal:'Invalid budget',criteria:['Goal'],evidenceMode:'curated',budget:{maxCalls:4}}),/cannot be enforced/);
  assert.throws(()=>engine.create(owner,{origin:'user',goal:'Invalid budget',criteria:['Goal'],evidenceMode:'curated',budget:{maxParallel:2}}),/cannot be enforced/);
  const expired=engine.create(owner,{origin:'user',goal:'Finish the goal',criteria:['Goal'],evidenceMode:'curated',budget:{deadline:'2000-01-01T00:00:00Z'}});
  assert.equal(engine.beforeTool(expired.id,owner,'read','native_tool').untracked,true);
  assert.equal(engine.context(expired.id).budgetPolicy,'advisory');
  assert.equal(engine.finish(expired.id,owner,{outcome:'completed',summary:'Completed despite an advisory deadline',findings:[{text:'Goal met',basis:'Reviewed the output'}]}).phase,'completed');
  const captured=engine.create(owner,{origin:'legacy',goal:'Captured',criteria:['Goal'],budget:{maxCalls:1}});
  assert.equal(captured.evidenceMode,'captured');assert.equal(captured.budget.maxParallel,3);
  engine.beforeTool(captured.id,owner,'one','query');
  assert.throws(()=>engine.beforeTool(captured.id,owner,'two','query'),/budget exhausted/);
  assert.throws(()=>engine.checkpoint(captured.id,owner,{summary:'No raw evidence',findings:[{text:'Cannot substitute rationale',status:'supported',basis:'A model says so',references:['https://example.test']}]}),/supporting observations/);
  engine.suspend(captured.id,owner);
  store.close();
});

test('checkpoint summary is progress text, finish summary becomes final and explicit report summary takes precedence',()=>{
  const {store,engine,task}=setup(['Cause','Impact']);
  const first:CheckpointInput={summary:'Initial milestone',findings:[{key:'cause',text:'Mapping defect',basis:'Source review',covers:['c1']}],report:{summary:'Saved report summary'}};
  engine.checkpoint(task.id,owner,first);
  engine.checkpoint(task.id,owner,{summary:'More progress',findings:[{key:'impact',text:'Only old clients',basis:'Cohort review',covers:['c2']}]});
  assert.equal(store.get(task.id).report?.summary,'Saved report summary');
  assert.equal(store.get(task.id).checkpoint?.summary,'More progress');
  // An incomplete finish still saves the intended final summary for a later correction.
  engine.checkpoint(task.id,owner,{summary:'Review cause',findings:[{key:'cause',text:'Cause uncertain',status:'inconclusive'}]});
  assert.equal(engine.finish(task.id,owner,{outcome:'completed',summary:'Final intended report'}).phase,'incomplete');
  engine.checkpoint(task.id,owner,{summary:'Corrected criterion association',findings:[{key:'cause',text:'Mapping defect',status:'supported'}]});
  assert.equal(store.get(task.id).report?.summary,'Final intended report');
  assert.equal(engine.finish(task.id,owner,{outcome:'completed',summary:'Last progress text',report:{summary:'Explicit final report'}}).phase,'completed');
  assert.equal(store.get(task.id).report?.summary,'Explicit final report');store.close();
});

test('curated context bounds long rationale, references and progress while persisting full content',()=>{
  const {store,engine,task}=setup();
  engine.checkpoint(task.id,owner,{summary:'摘要'.repeat(10_000),findings:[{key:'cause',text:'结论'.repeat(5_000),basis:'依据'.repeat(10_000),references:Array.from({length:30},(_,i)=>`${i}/`+'引用'.repeat(1000))}],progress:Array.from({length:50},(_,i)=>({key:`p${i}`,title:'步骤'.repeat(1000),detail:'详情'.repeat(1000),status:'pending' as const}))});
  const context=engine.context(task.id);
  assert.equal(context.evidenceMode,'curated');assert.ok(Buffer.byteLength(JSON.stringify(context),'utf8')<=16*1024);
  assert.ok(context.truncated.text);assert.ok(context.truncated.progress>0);
  assert.equal(store.get(task.id).claims[0]?.basis?.length,20_000);assert.equal(store.get(task.id).progress?.length,50);store.close();
});

test('content-free failed completion checks are visible once per state without changing report summaries or progress',()=>{
  const {store,engine,task}=setup();
  const before=store.get(task.id),initialEvents=store.events(task.id).length;
  assert.equal(engine.finish(task.id,owner,{outcome:'completed'}).phase,'incomplete');
  let checks=store.events(task.id).filter(event=>event.kind==='task.checked');
  assert.equal(checks.length,1);assert.equal(store.events(task.id).length,initialEvents+1);
  let saved=store.get(task.id);
  assert.equal(saved.revision,before.revision);assert.equal(saved.status,'active');
  assert.equal(saved.report,undefined);assert.equal(saved.progress,undefined);
  const payload=checks[0]!.payload as {phase:string;validation:{ok:boolean;issues:string[]};revision:number};
  assert.equal(payload.phase,'incomplete');assert.equal(payload.validation.ok,false);assert.ok(payload.validation.issues.length>0);assert.equal(payload.revision,before.revision);
  engine.finish(task.id,owner,{outcome:'completed'});
  assert.equal(store.events(task.id).filter(event=>event.kind==='task.checked').length,1,'repeating the same check does not flood the timeline');
  engine.checkpoint(task.id,owner,{summary:'A progress checkpoint',report:{summary:'Intended final report'},progress:[{key:'review',title:'Review evidence',status:'running'}]});
  const afterCheckpoint=store.get(task.id);
  engine.finish(task.id,owner,{outcome:'completed'});
  checks=store.events(task.id).filter(event=>event.kind==='task.checked');assert.equal(checks.length,2,'a changed state gets its own visible completion check');
  saved=store.get(task.id);assert.equal(saved.report?.summary,'Intended final report');assert.deepEqual(saved.progress,afterCheckpoint.progress);
  assert.equal(saved.revision,afterCheckpoint.revision);assert.equal(saved.status,'active');
  engine.finish(task.id,owner,{outcome:'completed',findings:[{text:'Goal now supported',basis:'Completed source review'}]});
  const completedEvents=store.events(task.id).length;
  assert.equal(engine.finish(task.id,owner,{outcome:'completed'}).phase,'completed');
  assert.equal(store.events(task.id).length,completedEvents,'completed no-content finish remains idempotent');store.close();
});

test('curated completion and report validation reject foreign or incomplete scopes while preserving separate exploration',()=>{
  const store=new Store(':memory:'),engine=new Engine(store);
  const scope={workspaceId:'team-A',environment:'round-1'};
  const task=engine.create(owner,{origin:'user',goal:'Explain this project and environment',criteria:['Explain the cause'],scope,evidenceMode:'curated'});
  const initial=store.get(task.id),initialEvents=store.events(task.id).length;
  for(const findingScope of [{workspaceId:'team-B',environment:'round-2'},{workspaceId:'team-A',environment:'round-2'},{workspaceId:'team-A'}] as Record<string,string>[]){
    assert.throws(()=>engine.finish(task.id,owner,{outcome:'completed',summary:'Wrong scope',findings:[{
      key:'wrong',text:'Another scope has a mapping error',basis:'Source review for another cohort',scope:findingScope,covers:['c1'],
    }]}),/must cover this task scope/);
    assert.deepEqual(store.get(task.id),initial);assert.equal(store.events(task.id).length,initialEvents,'scope rejection is atomic');
  }
  engine.checkpoint(task.id,owner,{summary:'Compared another environment for context',findings:[{
    key:'comparison',text:'Another environment had a mapping problem',basis:'Reviewed the other round report',scope:{workspaceId:'team-B',environment:'round-2'},covers:[],
  }]});
  const foreign=store.get(task.id).claims[0]!;
  assert.deepEqual(store.get(task.id).criteria[0]?.claimIds,[]);
  assert.deepEqual(store.get(task.id).report?.curatedReferences,[],'separate exploration is not included in this task report');
  assert.throws(()=>engine.satisfy(task.id,owner,'c1',[foreign.id]),/must cover this task scope/);
  engine.checkpoint(task.id,owner,{summary:'This environment verified',findings:[{
    key:'current',text:'This task has a mapping defect',basis:'Reviewed the current environment source',scope:{...scope,issueId:'current-issue'},covers:['c1'],
  }]});
  const saved=store.get(task.id),current=saved.claims.find(claim=>claim.key==='current')!,validReport=saved.report!;
  assert.equal(engine.evaluate(saved).ok,true);assert.equal(engine.evaluateReport(saved,validReport).ok,true);
  const forgedProjection=structuredClone(saved);forgedProjection.criteria[0]!.claimIds=[foreign.id];
  assert.equal(engine.evaluate(forgedProjection).ok,false,'persisted invalid links cannot bypass scope validation');
  assert.ok(engine.evaluate(forgedProjection).issues.some(issue=>issue.includes('does not cover this task scope')));
  const foreignReport={...validReport,curatedReferences:[{claimId:foreign.id,statement:foreign.text,basis:foreign.basis,references:foreign.references??[]}]};
  assert.equal(engine.evaluateReport(forgedProjection,foreignReport).ok,false);
  assert.ok(engine.evaluateReport(saved,foreignReport).issues.some(issue=>issue.includes('does not cover this task scope')));
  assert.throws(()=>engine.claim(task.id,owner,{...current,scope:{workspaceId:'team-B',environment:'round-2'}}),/must cover this task scope/);
  assert.equal(engine.report(task.id,owner,foreignReport).ok,false);
  assert.equal(engine.finish(task.id,owner,{outcome:'completed'}).phase,'incomplete','a report with foreign-scope references cannot complete an otherwise covered task');
  engine.report(task.id,owner,validReport);
  assert.equal(engine.finish(task.id,owner,{outcome:'completed'}).phase,'completed');store.close();
});
