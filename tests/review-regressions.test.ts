import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,rmSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {Engine,Store,type Session} from '../src/index.js';
import {markdown,html} from '../src/export.js';

const session:Session={host:'pi',sessionId:'review-owner',cwd:process.cwd()};
const goal={origin:'review fixture',goal:'Verify the result',criteria:['Result matches source'],evidenceMode:'curated' as const};
const checkpoint={summary:'Verified result',findings:[{key:'result',text:'Result matches source',basis:'Compared the source',covers:['c1']}]};

test('legacy SDK completion requires a current passing host receipt',async()=>{
 const store=new Store(':memory:');let accepts=false;
 const engine=new Engine(store,undefined,{completionVerifier:{id:'review-verifier',verify:()=>({ok:accepts})}});
 try{
  const task=engine.create(session,goal);engine.checkpoint(task.id,session,checkpoint);
  assert.throws(()=>engine.complete(task.id,session),/verification/i);
  await engine.verify(task.id,session);
  assert.throws(()=>engine.complete(task.id,session),/verification/i);
  accepts=true;await engine.verify(task.id,session);
  engine.checkpoint(task.id,session,{summary:'Updated report',report:{summary:'A revised candidate'}});
  assert.throws(()=>engine.complete(task.id,session),/verification/i);
  assert.equal(store.get(task.id).status,'active');
  await engine.verify(task.id,session);engine.complete(task.id,session);
  assert.equal(store.get(task.id).status,'completed');
 }finally{store.close();}
});

test('Markdown and HTML exports distinguish stale receipts from current acceptance',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'cairn-review-export-')),store=new Store(':memory:');
 const owner={...session,cwd:directory},path=join(directory,'result.txt');writeFileSync(path,'original');
 const engine=new Engine(store,undefined,{completionVerifier:{id:'review-export',artifacts:['result.txt'],verify:()=>({ok:true})}});
 try{
  const task=engine.create(owner,goal);engine.checkpoint(task.id,owner,{...checkpoint,artifacts:[{path}],findings:[{...checkpoint.findings[0]!,references:[path]}]});
  await engine.verify(task.id,owner);
  assert.match(markdown(store.get(task.id)),/完成验证：passed/);
  const assertStale=()=>{
   const current=store.get(task.id);
   assert.match(markdown(current),/完成验证：stale/);
   assert.match(html(current),/完成验证：stale/);
   assert.equal(current.verification?.status,'passed','Keep the historical receipt intact');
  };
  engine.checkpoint(task.id,owner,{summary:'New candidate',report:{summary:'Changed candidate'}});assertStale();
  await engine.verify(task.id,owner);assert.match(markdown(store.get(task.id)),/完成验证：passed/);
  engine.suspend(task.id,owner);engine.resume(task.id,owner);assertStale();
  await engine.verify(task.id,owner);writeFileSync(path,'changed');assertStale();
 }finally{store.close();rmSync(directory,{recursive:true,force:true});}
});

test('artifact contract rejects falsey JSON answers and accepts a complete object',()=>{
 const cwd=mkdtempSync(join(tmpdir(),'cairn-review-contract-'));
 const check=()=>{
  const result=spawnSync(process.execPath,[resolve('evaluations/public-rca/verify-artifacts.mjs')],{input:JSON.stringify({owner:{cwd}}),encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);return JSON.parse(result.stdout);
 };
 try{
  writeFileSync(join(cwd,'REPORT.md'),'The pod example has the reported measurements.');
  for(const answer of [null,false,0,'']){
   writeFileSync(join(cwd,'answer.json'),JSON.stringify(answer));
   assert.equal(check().ok,false,`Invalid answer ${JSON.stringify(answer)} must fail acceptance`);
  }
  mkdirSync(join(cwd,'evidence/container'),{recursive:true});writeFileSync(join(cwd,'evidence/container/sample.csv'),'timestamp,value\n0,1\n');
  writeFileSync(join(cwd,'answer.json'),JSON.stringify({candidates:[{location:'example',level:'pod',fault_family:'unknown',confidence:0.5,reason:'Observed source'}],evidence:Array.from({length:2},()=>({file:'evidence/container/sample.csv',metric:'value',entity:'example',before:'1',after:'1'})),alternatives:['Unresolved alternative'],limitations:['No causal proof'],mitigation:['Investigate'],verification:['Repeat measurement']}));
  assert.equal(check().ok,true);
 }finally{rmSync(cwd,{recursive:true,force:true});}
});
