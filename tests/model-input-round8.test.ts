import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHarness,type Session} from '../src/index.js';
import {coreCatalog} from '../src/tools.js';
import {AjvJsonSchemaValidator} from '@modelcontextprotocol/sdk/validation/ajv';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';

const session:Session={host:'pi',sessionId:'normalization-owner',cwd:'/workspace'};
const fact={key:'observation',text:'Original input produces the observed result',status:'supported',basis:'Ran the original input',covers:[]};

test('model checkpoint normalizes only serialized finding objects and blank optional next without mutating the request',async()=>{
 const h=createHarness({database:':memory:',session});try{
  const task=await h.tools.invokeModel('cairn_start',{goal:'Explain the result'}) as any;
  const input={findings:[JSON.stringify(fact)],next:'  '},wire=JSON.stringify(input);
  const receipt=await h.tools.invokeModel('cairn_checkpoint',JSON.parse(wire)) as any;
  assert.equal(JSON.stringify(input),wire);
  assert.deepEqual(receipt.delta.addedFindings,['observation']);
  const saved=h.engine.store.get(task.taskId);
  assert.deepEqual(saved.claims.map(c=>({key:c.key,text:c.text,status:c.status,basis:c.basis})),[{key:fact.key,text:fact.text,status:fact.status,basis:fact.basis}]);
  assert.deepEqual(saved.criteria[0]!.claimIds,[]);assert.equal(saved.checkpoint?.next,undefined);
  const retry=await h.tools.invokeModel('cairn_checkpoint',{findings:[fact]}) as any;
  assert.equal(retry.delta.stateChanged,false);assert.equal(h.engine.store.get(task.taskId).claims.length,1);
 }finally{await h.close();}
});

test('checkpoint compatibility does not invent findings, grounds, keys, statuses or coverage',async()=>{
 const h=createHarness({database:':memory:',session});try{
  const task=await h.tools.invokeModel('cairn_start',{goal:'Explain the result'}) as any;
  for(const value of ['plain observation','[{}]','null','"double encoded"','{broken',JSON.stringify({...fact,status:'correct'}),JSON.stringify({...fact,covers:undefined}),JSON.stringify({...fact,key:undefined}),JSON.stringify({...fact,referenceArtifacts:[]})]){
   await assert.rejects(h.tools.invokeModel('cairn_checkpoint',{findings:[value],next:''}));
  }
  await assert.rejects(h.tools.invokeModel('cairn_checkpoint',{next:''}),/not an increment/);
  await assert.rejects(h.tools.invokeModel('cairn_finish',{next:''}),/accepts only/);
  assert.equal(h.engine.store.get(task.taskId).claims.length,0);
 }finally{await h.close();}
});

test('published model contract still requests finding objects and an outcome-only finish',()=>{
 const catalog=coreCatalog(),checkpoint=catalog.find(t=>t.name==='cairn_checkpoint')!.inputSchema;
 const validate=new AjvJsonSchemaValidator().getValidator(checkpoint);
 assert.equal(validate({findings:[fact]}).valid,true);
 assert.equal(validate({findings:[JSON.stringify(fact)]}).valid,false);
 assert.deepEqual(Object.keys(catalog.find(t=>t.name==='cairn_finish')!.inputSchema.properties as object),['outcome','summary']);
});

test('model acknowledgement is a compact delta while SDK and explicit recovery retain facts and alternatives',async()=>{
 const h=createHarness({database:':memory:',session});try{
  const task=await h.tools.invokeModel('cairn_start',{goal:'Explain original behavior',criteria:['Justified explanation']}) as any;
  const findings=Array.from({length:6},(_,i)=>({...fact,key:`fact-${i}`,text:`Observation ${i}: `+'observed behavior '.repeat(25)}));
  await h.tools.invokeModel('cairn_checkpoint',{findings,questions:['Which alternative explains the original behavior?'],next:'Test the distinguishing prediction'});
  const revised={...findings[0]!,text:'Original input failed under unchanged conditions',status:'refuted'};
  const sdk=await h.tools.invoke('cairn_checkpoint',{summary:'Condition tested',findings:[revised]}) as any;
  const model=await h.tools.invokeModel('cairn_checkpoint',{findings:[revised]}) as any;
  assert.deepEqual(model.findings,[]);assert.equal(model.findingsOmitted,6);
  assert.ok(Buffer.byteLength(JSON.stringify(model))<Buffer.byteLength(JSON.stringify(sdk))*.75);
  assert.ok(!JSON.stringify(model).includes(findings[1]!.text));assert.equal(model.exploration.changed,undefined);
  const restored=await h.tools.invokeModel('cairn_read',{}) as any;
  assert.equal(restored.claims.length,6);assert.equal(restored.claims.find((c:any)=>c.key==='fact-0').status,'refuted');
  assert.deepEqual(restored.checkpoint.questions,['Which alternative explains the original behavior?']);
  assert.match(restored.exploration.guidance,/requested scope/);assert.match(restored.exploration.guidance,/Shared effects|shared effects/);
  assert.equal(sdk.findings.length,6,'SDK receipt stays compatible');
 }finally{await h.close();}
});

test('compact model receipts retain stale file warnings and never refresh a finding implicitly',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'cairn-delta-stale-'));writeFileSync(join(dir,'source.txt'),'version one');
 const h=createHarness({database:':memory:',session:{...session,cwd:dir}});try{
  const task=await h.tools.invokeModel('cairn_start',{goal:'Return the verified source'}) as any;
  await h.tools.invokeModel('cairn_checkpoint',{findings:[{...fact,references:['source.txt'],covers:['c1']}],artifacts:[{path:'source.txt'}]});
  writeFileSync(join(dir,'source.txt'),'version two');
  const receipt=await h.tools.invokeModel('cairn_checkpoint',{questions:['Revalidate changed input']}) as any;
  assert.equal(receipt.findings[0].referenceState.status,'stale');assert.equal(receipt.coverage.covered,0);
  assert.equal((await h.tools.invokeModel('cairn_finish',{}) as any).phase,'incomplete');
  assert.equal(h.engine.store.get(task.taskId).claims[0]!.revision,1);
 }finally{await h.close();rmSync(dir,{recursive:true,force:true});}
});
