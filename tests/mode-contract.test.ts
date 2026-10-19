import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {AjvJsonSchemaValidator} from '@modelcontextprotocol/sdk/validation/ajv';
import {createHarness} from '../src/index.js';
import {mcpToolSchema} from '../src/mcp.js';
import {coreCatalog} from '../src/tools.js';
import piExtension from '../src/adapters/pi-extension.js';

const fact={key:'measurement',text:'Measured source result',status:'supported',basis:'Read the original source',references:['https://example.test/result'],covers:[]};
test('curated model catalog requests grounds and references without captured observation fields',()=>{
 const schema=coreCatalog().find(t=>t.name==='cairn_update')!.inputSchema;
 const validate=new AjvJsonSchemaValidator().getValidator(schema);
 assert.equal(validate({finding:fact}).valid,true);
 assert.equal(validate({finding:{...fact,evidence:['external-result:one']}}).valid,false);
 assert.equal(validate({finding:{...fact,against:['E1']}}).valid,false);
});

test('runtime catalog follows the actual task mode while captured SDK evidence remains supported',async()=>{
 const h=createHarness({database:':memory:',session:{host:'pi',sessionId:'owner',cwd:'/workspace'}});
 try{
  const start=await h.tools.invokeModel('cairn_start',{goal:'Retain captured observations',evidence_mode:'captured'}) as any;
  const schema=(await h.tools.list()).find(t=>t.name==='cairn_update')!.inputSchema;
  const validate=new AjvJsonSchemaValidator().getValidator(schema);
  assert.equal(validate({finding:{...fact,evidence:['E1']}}).valid,true);
  h.engine.suspend(start.taskId,{host:'pi',sessionId:'owner',cwd:'/workspace'});
  await h.tools.invokeModel('cairn_start',{goal:'Use curated facts'});
  const next=(await h.tools.list()).find(t=>t.name==='cairn_update')!.inputSchema;
  assert.equal(new AjvJsonSchemaValidator().getValidator(next)({finding:{...fact,evidence:['E1']}}).valid,false);
 }finally{await h.close();}
});

test('single update wire objects are decoded once before strict validation and remain immutable',async()=>{
 const h=createHarness({database:':memory:',session:{host:'pi',sessionId:'wire',cwd:'/workspace'}});
 try{
  const start=await h.tools.invokeModel('cairn_start',{goal:'Keep independent facts'}) as any;
  const input={finding:JSON.stringify(fact)},before=JSON.stringify(input);
  await h.tools.invokeModel('cairn_update',input);
  assert.equal(JSON.stringify(input),before);
  assert.equal(h.engine.store.get(start.taskId).claims.length,1);
  await assert.rejects(h.tools.invokeModel('cairn_update',{finding:JSON.stringify({...fact,unknown:'reject'})}));
  await assert.rejects(h.tools.invokeModel('cairn_update',{finding:JSON.stringify(JSON.stringify(fact))}));
  assert.equal(h.engine.store.get(start.taskId).claims.length,1);
 }finally{await h.close();}
});

test('mode mismatch names the offending fields and leaves the entire checkpoint unchanged',async()=>{
 const h=createHarness({database:':memory:',session:{host:'pi',sessionId:'repair',cwd:'/workspace'}});
 try{
  const start=await h.tools.invokeModel('cairn_start',{goal:'Preserve actual grounds'}) as any;
  const before=JSON.stringify(h.engine.store.get(start.taskId));
  await assert.rejects(h.tools.invokeModel('cairn_checkpoint',{findings:[{...fact,evidence:['external-result:one']}]}),/evidence.*against.*basis.*references/i);
  assert.equal(JSON.stringify(h.engine.store.get(start.taskId)),before);
 }finally{await h.close();}
});

test('Pi refreshes its published mode after start and decodes single-update wire arguments',async()=>{
 const cwd=mkdtempSync(join(tmpdir(),'cairn-mode-pi-')),tools=new Map<string,any>(),handlers=new Map<string,any>();
 const ctx={cwd,sessionManager:{getSessionId:()=> 'mode-session'},ui:{notify:()=>{}}};
 piExtension({on:(n:string,h:any)=>handlers.set(n,h),registerTool:(t:any)=>tools.set(t.name,t),registerCommand:()=>{},sendMessage:()=>{}});
 try{
  await handlers.get('session_start')({type:'session_start'},ctx);
  await tools.get('cairn_start').execute('start',{goal:'Captured task',evidence_mode:'captured'},undefined,undefined,ctx);
  assert.equal(new AjvJsonSchemaValidator().getValidator(tools.get('cairn_update').parameters)({finding:{...fact,evidence:['E1']}}).valid,true);
  const update=tools.get('cairn_update'),wire={finding:JSON.stringify({...fact,status:'proposed'})};
  assert.equal(new AjvJsonSchemaValidator().getValidator(update.parameters)(update.prepareArguments(wire)).valid,true);
 }finally{await handlers.get('session_shutdown')({type:'session_shutdown'},ctx);rmSync(cwd,{recursive:true,force:true});}
});

test('Claude keeps every core tool visible while runtime validation still rejects invalid deltas',async()=>{
 const validator=new AjvJsonSchemaValidator();
 for(const tool of coreCatalog()){
  const schema=mcpToolSchema(tool.inputSchema,'claude');
  assert.equal(schema.oneOf,undefined);assert.equal(schema.anyOf,undefined);
 }
 const schema=mcpToolSchema(coreCatalog().find(t=>t.name==='cairn_update')!.inputSchema,'claude','cairn_update');
 const validate=validator.getValidator(schema);
 assert.equal(validate({}).valid,false);
 assert.equal(validate({finding:fact,review:{snapshot:1,summary:'duplicate operation'}}).valid,false);
 const h=createHarness({database:':memory:',session:{host:'claude',sessionId:'fixture',cwd:'/workspace'}});
 try{
  await h.tools.invokeModel('cairn_start',{goal:'Keep strict runtime validation'});
  await assert.rejects(h.tools.invokeModel('cairn_checkpoint',{summary:'No new state'}),/not an increment/);
 }finally{await h.close();}
});

test('Claude schema compatibility does not impose the single-update shape on forwarded tools',()=>{
 const schema={type:'object',properties:{path:{type:'string'},offset:{type:'integer'}},oneOf:[{required:['path','offset']}]};
 const published=mcpToolSchema(schema,'claude','cairn_tool_source_read');
 assert.equal(published.maxProperties,undefined);
 assert.equal(new AjvJsonSchemaValidator().getValidator(published)({path:'source',offset:2}).valid,true);
 assert.ok(schema.oneOf,'Original schema remains intact for upstream validation');
});
