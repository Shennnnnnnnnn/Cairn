import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/core/store.js';
import { Engine } from '../src/core/engine.js';
import { ToolRuntime } from '../src/tools.js';
import { markdown, html } from '../src/export.js';
import type { Session } from '../src/core/types.js';

type Context=ReturnType<Engine['context']>;
type Finished=ReturnType<Engine['finish']>;
const firstSession:Session={host:'codex',sessionId:'curated-workflow-first',cwd:'/workspace'};
const secondSession:Session={host:'claude',sessionId:'curated-workflow-second',cwd:'/workspace'};

test('five public tools support a free-tool curated investigation, pause, explicit cross-host recovery and safe report export',async(t)=>{
  const store=new Store(':memory:'),engine=new Engine(store);
  const first=new ToolRuntime(engine,firstSession),second=new ToolRuntime(engine,secondSession);
  t.after(async()=>{await first.close();await second.close();store.close();});
  const catalog=await first.list();
  assert.deepEqual(catalog.map(tool=>tool.name).sort(),['cairn_checkpoint','cairn_finish','cairn_read','cairn_resume','cairn_start']);
  assert.equal(store.config('gateway'),undefined,'ordinary work requires no configured tool whitelist or proxy');
  const guidance='Choose shell, file reading, browser or other available host tools yourself. Preserve only useful findings and source references.';
  const started=await first.invoke('cairn_start',{
    goal:'Explain the price mapping defect and identify affected clients',criteria:['Explain the cause','Identify affected clients'],constraints:[guidance],
    progress:[{key:'cause',title:'Review price mapping',status:'running'},{key:'impact',title:'Review affected clients',status:'pending'}],
  }) as Context;
  assert.equal(started.evidenceMode,'curated');assert.equal(started.budgetPolicy,'advisory');
  assert.deepEqual(started.budget,{});assert.deepEqual(started.constraints,[guidance]);

  // Host tools run independently: the public workflow needs no pre-tool reservation, raw result or gateway call.
  await first.invoke('cairn_checkpoint',{
    summary:'Source comparison identifies the client mapping; affected cohort remains to be checked.',
    findings:[
      {key:'server-outage',text:'The price API is unavailable',status:'refuted',basis:'The service status summary reports normal responses during the incident.',references:['https://example.test/status'],covers:['c1']},
      {key:'mapping',text:'The 1.4 mapping applies a price scale twice',basis:'The source multiplies an already normalized price by 100; the 1.5 version removes that multiplication.',references:['src/price-mapping.ts:42','https://example.test/runbook?version=1.4&kind=price',"javascript:alert('untrusted-reference')"],covers:['c1']},
    ],
    questions:['How many users are on the 1.4 mapping?'],next:'Compare the cohort summary against all active users.',
    progress:[{key:'cause',title:'Review price mapping',status:'completed'},{key:'impact',title:'Review affected clients',status:'running'}],
  });
  const evidence=await first.invoke('cairn_read',{view:'evidence'}) as {mode:string;verification:string;items:{key:string;source:string;basis:string;references:string[]}[]};
  assert.equal(evidence.mode,'curated');assert.match(evidence.verification,/AI-curated.*not automatically verified/);
  assert.equal(evidence.items.find(item=>item.key==='mapping')?.source,'agent');
  assert.ok(evidence.items.find(item=>item.key==='mapping')?.references.includes('src/price-mapping.ts:42'));
  const detail=await first.invoke('cairn_read',{view:'evidence',ref:'mapping'}) as {mode:string;item:{source:string;basis:string}};
  assert.equal(detail.item.source,'agent');assert.match(detail.item.basis,/already normalized/);
  await assert.rejects(first.invoke('cairn_read',{view:'evidence',ref:'E1'}),/no original tool records/);

  const paused=await first.invoke('cairn_finish',{outcome:'suspended',summary:'Cause established; pause before cohort analysis.'}) as Finished;
  assert.equal(paused.phase,'suspended');
  assert.equal(store.get(started.taskId).progress?.find(item=>item.key==='impact')?.status,'blocked');
  await assert.rejects(second.invoke('cairn_resume',{task_id:started.taskId}),/explicit takeover/);
  const restored=await second.invoke('cairn_resume',{task_id:started.taskId,takeover:true}) as Context;
  assert.equal(restored.owner.host,'claude');assert.equal(restored.owner.epoch,2);assert.equal(restored.evidenceMode,'curated');
  assert.deepEqual(restored.checkpoint?.questions,['How many users are on the 1.4 mapping?']);
  assert.ok(restored.claims.some(claim=>claim.key==='mapping'&&claim.references?.includes('src/price-mapping.ts:42')));
  await assert.rejects(first.invoke('cairn_checkpoint',{summary:'Late old session update'}),/no longer owns/);
  const completed=await second.invoke('cairn_finish',{
    summary:'Version 1.4 applies the price scale twice and affects 300 of 1,000 active users.',
    findings:[{key:'impact',text:'The affected 1.4 cohort contains 300 of 1,000 active users',basis:'The cohort summary lists 300 users for 1.4; the active-user total is 1,000.',references:['reports/cohort-summary.csv:2'],covers:['c2']}],
    questions:[],progress:[{key:'impact',title:'Review affected clients',status:'completed'}],
  }) as Finished;
  assert.equal(completed.phase,'completed');assert.equal(completed.validation.ok,true);assert.deepEqual(completed.check.unmet,[]);
  const saved=store.get(started.taskId);
  assert.deepEqual(saved.calls,{});assert.deepEqual(saved.observations,[]);assert.equal(saved.report?.citations.length,0);
  assert.equal(saved.report?.curatedReferences?.length,2,'refuted hypotheses remain context and do not block supported coverage');
  assert.ok(saved.progress?.every(item=>item.status==='completed'));
  assert.ok(!store.events(saved.id).some(event=>event.kind==='observation.captured'||event.kind.startsWith('tool.')));

  const md=markdown(saved),page=html(saved);
  for(const output of [md,page]){
    assert.match(output,/already normalized/);assert.match(output,/src\/price-mapping\.ts:42/);assert.match(output,/cohort-summary\.csv:2/);
    assert.match(output,/AI 整理/);assert.match(output,/未自动核验/);
    assert.ok(!output.includes('原始观测（自动取证）'));
  }
  assert.ok(md.includes("`javascript:alert('untrusted-reference')`"),'Markdown treats untrusted URL schemes as code');
  const linkedUrls=[...page.matchAll(/href="([^"]*)"/g)].map(match=>match[1]!);
  assert.ok(linkedUrls.includes('https://example.test/runbook?version=1.4&amp;kind=price'));
  assert.ok(linkedUrls.every(url=>/^https?:\/\//i.test(url)),'only HTTP and HTTPS references become clickable');
  assert.ok(page.includes('javascript:alert(&#39;untrusted-reference&#39;)'));
});

test('public default mode rejects unobservable quotas while allowing advisory deadlines and goal completion',async(t)=>{
  const store=new Store(':memory:'),engine=new Engine(store),runtime=new ToolRuntime(engine,{host:'pi',sessionId:'curated-budget',cwd:'/workspace'});
  t.after(async()=>{await runtime.close();store.close();});
  for(const budget of [{maxCalls:5},{maxParallel:2}]){
    await assert.rejects(runtime.invoke('cairn_start',{goal:'Review the source',budget}),/do not record tool calls.*cannot be enforced/);
    assert.equal(store.list().length,0,'rejected configurations do not create partial tasks');
  }
  const started=await runtime.invoke('cairn_start',{goal:'Verify the source fix',budget:{deadline:'2000-01-01T00:00:00Z'}}) as Context;
  assert.equal(started.evidenceMode,'curated');assert.equal(started.budgetPolicy,'advisory');
  assert.equal(started.budget.maxCalls,undefined);assert.equal(started.budget.maxParallel,undefined);
  const finished=await runtime.invoke('cairn_finish',{summary:'The source fix satisfies the requested change.',findings:[{text:'The mapping now normalizes the price once',basis:'Compared the updated mapping and the contract example.',references:['src/price-mapping.ts:42']}]}) as Finished;
  assert.equal(finished.phase,'completed');assert.equal(finished.validation.ok,true);
  assert.deepEqual(store.get(started.taskId).calls,{});assert.deepEqual(store.get(started.taskId).observations,[]);
});
