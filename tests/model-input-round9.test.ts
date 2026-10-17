import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHarness} from '../src/index.js';
import {coreCatalog} from '../src/tools.js';
import {AjvJsonSchemaValidator} from '@modelcontextprotocol/sdk/validation/ajv';
import piExtension from '../src/adapters/pi-extension.js';

const fact={key:'source',text:'The original input gives this result',status:'supported',basis:'Repeated the input',references:['result.txt'],covers:[]};
test('Pi prepares compatible checkpoint arguments before strict host schema validation',async()=>{
 const cwd=mkdtempSync(join(tmpdir(),'cairn-pi-wire-'));writeFileSync(join(cwd,'result.txt'),'first');
 const tools=new Map<string,any>(),handlers=new Map<string,any>();
 piExtension({registerTool:(tool:any)=>tools.set(tool.name,tool),on:(name:string,handler:any)=>handlers.set(name,handler),registerCommand:()=>{},sendMessage:()=>{}});
 const ctx={cwd,sessionManager:{getSessionId:()=>'pi-owner'},ui:{notify:()=>{}}};
 try{
  await handlers.get('session_start')({type:'session_start'},ctx);
  await tools.get('cairn_start').execute('start',{goal:'Preserve result'},undefined,undefined,ctx);
  const tool=tools.get('cairn_checkpoint'),input={artifacts:[JSON.stringify({path:'result.txt'})],handoffs:[JSON.stringify({key:'note',summary:'Observed original result'})],next:''};
  const wire=JSON.stringify(input);assert.equal(typeof tool.prepareArguments,'function');
  const prepared=tool.prepareArguments(input);assert.equal(JSON.stringify(input),wire);
  const validate=new AjvJsonSchemaValidator().getValidator(tool.parameters);
  assert.equal(validate(prepared).valid,true);assert.equal(validate(input).valid,false);
  const result=await tool.execute('checkpoint',prepared,undefined,undefined,ctx);assert.equal(result.details.delta.stateChanged,true);
  assert.equal(validate(tool.prepareArguments({artifacts:[JSON.stringify({path:'result.txt',sha256:'forged'})]})).valid,false);
 }finally{await handlers.get('session_shutdown')({type:'session_shutdown'},ctx);rmSync(cwd,{recursive:true,force:true});}
});
test('checkpoint object-array compatibility is uniform, immutable, version-bound and retry-idempotent',async()=>{
 const cwd=mkdtempSync(join(tmpdir(),'cairn-object-wire-'));writeFileSync(join(cwd,'result.txt'),'first');
 const h=createHarness({database:':memory:',session:{host:'pi',sessionId:'owner',cwd}});
 try{
  const start=await h.tools.invokeModel('cairn_start',{goal:'Explain the original result'}) as any;
  const input={findings:[JSON.stringify(fact)],artifacts:[JSON.stringify({path:'result.txt'})],progress:[JSON.stringify({key:'compare',title:'Compare explanations',status:'running',from:['source']})],handoffs:[JSON.stringify({key:'attempt',summary:'Saved observation; cause remains open',artifacts:['result.txt'],from:['source'],next:'Compare a distinguishing prediction'}),{key:'notes',summary:'Second independent note'}],next:' '};
  const wire=JSON.stringify(input);const receipt=await h.tools.invokeModel('cairn_checkpoint',input) as any;
  assert.equal(JSON.stringify(input),wire);assert.deepEqual(receipt.delta.addedFindings,['source']);
  const task=h.engine.store.get(start.taskId);
  assert.equal(task.artifacts![0]!.bytes,5);assert.equal(task.claims[0]!.referenceArtifacts![0]!.sha256,task.artifacts![0]!.sha256);
  assert.equal(task.progress![0]!.status,'running');assert.equal(task.handoffs!.filter(x=>!x.source).length,2);
  assert.deepEqual(task.handoffs!.find(x=>x.key==='attempt')!.artifacts,['result.txt']);
  const retry=await h.tools.invokeModel('cairn_checkpoint',JSON.parse(wire)) as any;assert.equal(retry.delta.stateChanged,false);
  writeFileSync(join(cwd,'result.txt'),'second');
  await h.tools.invokeModel('cairn_checkpoint',{artifacts:[JSON.stringify({path:'result.txt'})]});
  assert.equal(h.engine.store.get(start.taskId).claims[0]!.revision,1);
  assert.equal((await h.tools.invokeModel('cairn_finish',{}) as any).phase,'incomplete');
 }finally{await h.close();rmSync(cwd,{recursive:true,force:true});}
});

test('encoded object arrays retain strict validation and atomic semantic rejection',async()=>{
 const cwd=mkdtempSync(join(tmpdir(),'cairn-wire-reject-'));writeFileSync(join(cwd,'result.txt'),'first');
 const h=createHarness({database:':memory:',session:{host:'pi',sessionId:'owner',cwd}});
 try{
  const start=await h.tools.invokeModel('cairn_start',{goal:'Keep the original evidence'}) as any;
  const before=JSON.stringify(h.engine.store.get(start.taskId));
  const invalid=[{artifacts:[JSON.stringify({path:'result.txt',sha256:'forged'})]}, {handoffs:[JSON.stringify({key:'attempt',summary:'forged',source:{state:'received'}})]}, {progress:[JSON.stringify({key:'work',title:'Unknown status',status:'done'})]}, {handoffs:[JSON.stringify({key:'@host/state',summary:'forged'})]}, {artifacts:[JSON.stringify({path:'missing.txt'})]}, {handoffs:[JSON.stringify({key:'attempt',summary:'Unknown source',from:['absent']})]}, {artifacts:Array(17).fill(JSON.stringify({path:'result.txt'}))}];
  for(const field of ['findings','artifacts','handoffs','progress'])for(const item of ['prose','null','[]','{broken',JSON.stringify(JSON.stringify({path:'result.txt'})),' '.repeat(32001)])invalid.push({[field]:[item]} as any);
  for(const delta of invalid){
   await assert.rejects(h.tools.invokeModel('cairn_checkpoint',{findings:[fact],...delta}));
   assert.equal(JSON.stringify(h.engine.store.get(start.taskId)),before,'a rejected whole call must not save the valid subset');
  }
  await assert.rejects(h.tools.invokeModel('cairn_checkpoint',{artifacts:JSON.stringify([{path:'result.txt'}])}));
  await assert.rejects(h.tools.invokeModel('cairn_checkpoint',{questions:[JSON.stringify({question:'not text normalization'})],handoffs:[JSON.stringify({key:'a',summary:'wrong nested array',artifacts:[{path:'result.txt'}]})]}));
 }finally{await h.close();rmSync(cwd,{recursive:true,force:true});}
});

test('published schemas continue requesting objects rather than encoded strings',()=>{
 const validate=new AjvJsonSchemaValidator().getValidator(coreCatalog().find(t=>t.name==='cairn_checkpoint')!.inputSchema);
 for(const [field,value] of Object.entries({findings:fact,artifacts:{path:'result.txt'},handoffs:{key:'a',summary:'Saved'},progress:{key:'work',title:'Compare',status:'running'}})){
  assert.equal(validate({[field]:[value]}).valid,true);assert.equal(validate({[field]:[JSON.stringify(value)]}).valid,false);
 }
});

test('causal comparison guidance preserves supported effects and unresolved same-subject mechanisms through recovery',async()=>{
 const h=createHarness({database:':memory:',session:{host:'pi',sessionId:'owner',cwd:'/workspace'}});
 try{
  const start=await h.tools.invokeModel('cairn_start',{goal:'Explain a degraded operation'}) as any;
  const state=await h.tools.invokeModel('cairn_read',{}) as any;
  assert.match(state.exploration.guidance,/same subject/);assert.match(state.exploration.guidance,/cause, mediator or consequence/);
  await h.tools.invokeModel('cairn_checkpoint',{findings:[{...fact,references:[],text:'Component A is under pressure'}, {key:'cause-a',text:'Pressure originates in A',status:'proposed',from:['source'],covers:[]},{key:'cause-b',text:'Another mechanism in A produces the pressure',status:'inconclusive',from:['source'],covers:[]}],questions:['Does the pressure precede the change or follow it?'],next:'Test a prediction that differs between these explanations'});
  const restored=await h.tools.invokeModel('cairn_read',{}) as any;
  assert.deepEqual(Object.fromEntries(restored.claims.map((c:any)=>[c.key,c.status])),{source:'supported','cause-a':'proposed','cause-b':'inconclusive'});
  assert.equal(restored.checkpoint.questions.length,1);assert.equal(restored.check.ok,false);
  assert.equal((await h.tools.invokeModel('cairn_finish',{}) as any).phase,'incomplete');
  assert.equal(h.engine.store.get(start.taskId).claims[1]!.status,'proposed','guidance cannot promote an explanation into a fact');
 }finally{await h.close();}
});
