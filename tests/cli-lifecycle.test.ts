import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {Store} from '../src/core/store.js';
import {gatewaySchema} from '../src/gateway.js';
import {LATEST_PROTOCOL_VERSION} from '@modelcontextprotocol/sdk/types.js';

test('MCP EOF releases a live gateway upstream without waiting for host termination', {timeout:15000}, async()=>{
 const root=mkdtempSync(join(tmpdir(),'cairn-eof-')),db=join(root,'state.db'),store=new Store(db);
 store.setConfig('gateway',gatewaySchema.parse({servers:{fixture:{command:process.execPath,args:[resolve('tests/fixtures/upstream.mjs')]}},tools:[{name:'read',server:'fixture',upstream:'read',resultRefPath:'result_ref'}]}));store.close();
 const child=spawn(process.execPath,[resolve('dist/cairn.mjs'),'mcp','--db',db,'--root',root,'--host','mcp','--session-id','eof-test'],{stdio:['pipe','pipe','pipe']});
 let stderr='',sequence=0;child.stderr.on('data',chunk=>{stderr=(stderr+chunk).slice(-4000);});
 const pending=new Map<number,{resolve:(value:any)=>void;reject:(error:Error)=>void}>();
 const lines=createInterface({input:child.stdout});lines.on('line',line=>{const value=JSON.parse(line),wait=pending.get(value.id);if(wait){pending.delete(value.id);value.error?wait.reject(new Error(JSON.stringify(value.error))):wait.resolve(value.result);}});
 const exited=new Promise<number|null>((resolveExit,reject)=>{child.once('error',reject);child.once('close',code=>{for(const wait of pending.values())wait.reject(new Error(`MCP exited ${code}: ${stderr}`));pending.clear();resolveExit(code);});});
 const request=(method:string,params:unknown)=>new Promise<any>((resolveRequest,reject)=>{const id=++sequence,timeout=setTimeout(()=>{pending.delete(id);reject(new Error(`Timed out waiting for ${method}: ${stderr}`));},4000);pending.set(id,{resolve:value=>{clearTimeout(timeout);resolveRequest(value);},reject:error=>{clearTimeout(timeout);reject(error);}});child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');});
 let timer:ReturnType<typeof setTimeout>|undefined;
 try{
  await request('initialize',{protocolVersion:LATEST_PROTOCOL_VERSION,capabilities:{},clientInfo:{name:'eof-test',version:'1'}});
  child.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n');
  assert.ok(!(await request('tools/call',{name:'cairn_start',arguments:{goal:'Read fixture'}})).isError);
  assert.ok(!(await request('tools/call',{name:'cairn_tool_read',arguments:{}})).isError);
  child.stdin.end();
  const code=await Promise.race([exited,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('MCP remained alive with its upstream after stdin EOF')),3500);})]);
  assert.equal(code,0,stderr);
 }finally{clearTimeout(timer);if(child.exitCode===null){child.kill('SIGTERM');await exited;}lines.close();rmSync(root,{recursive:true,force:true});}
});
