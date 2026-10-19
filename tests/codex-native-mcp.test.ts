import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';

test('Codex comparison transport binds native request metadata and preserves the six-tool runtime',async()=>{
 const root=mkdtempSync(join(tmpdir(),'cairn-codex-native-'));
 const client=new Client({name:'identity-fixture',version:'1'},{capabilities:{}});
 try{
  mkdirSync(join(root,'.multica'));
  writeFileSync(join(root,'.multica/daemon_task_context.json'),JSON.stringify({issue_id:'fixture-issue'}));
  const settings=join(root,'settings.json'),database=join(root,'state.db');
  writeFileSync(settings,JSON.stringify({platform:{artifactRoot:join(root,'deliveries')}}));
  const env={...process.env,CAIRN_DB:database,CAIRN_REPLAY_SETTINGS:settings,CAIRN_FROZEN_CLI:resolve('dist/cairn.mjs'),CAIRN_VERIFY_COMMAND:JSON.stringify([process.execPath,'-e','process.stdout.write(JSON.stringify({ok:true}))'])} as Record<string,string>;
  for(const key of ['CAIRN_VERIFY_ARTIFACTS','CAIRN_DEADLINE','CAIRN_SUBMIT_RESERVE_MS','MULTICA_ISSUE_ID'])delete env[key];
  await client.connect(new StdioClientTransport({command:process.execPath,args:['--import',import.meta.resolve('tsx'),resolve('evaluations/public-rca/codex-native-mcp.mjs'),'cairn'],cwd:root,env,stderr:'pipe'}));
  assert.equal((await client.listTools()).tools.length,6);
  const call=(name:string,args:Record<string,unknown>,id?:string)=>client.callTool({name,arguments:args,...(id?{_meta:{threadId:id}}:{})});
  assert.equal((await call('cairn_start',{goal:'Synthetic task'})).isError,true);
  assert.equal((await call('cairn_start',{goal:'Synthetic task',session_id:'spoofed'},'native-owner')).isError,true);
  const start=await call('cairn_start',{goal:'Synthetic task'},'native-owner');assert.notEqual(start.isError,true);
  assert.equal((await call('cairn_read',{},'other-thread')).isError,true);
  const db=new DatabaseSync(database,{readOnly:true});
  try{
   const row=db.prepare('SELECT state FROM tasks').get() as {state:string};
   const task=JSON.parse(row.state);assert.equal(task.owner.host,'codex');assert.equal(task.owner.sessionId,'native-owner');assert.deepEqual(task.budget,{});
   assert.deepEqual(task.artifactRequirements.map((p:string)=>p.split('/').at(-1)).sort(),['REPORT.md','answer.json','receipt.json']);
  }finally{db.close();}
  const binding=JSON.parse(readFileSync(join(root,'deliveries/fixture-issue/native-owner/cairn-binding.json'),'utf8'));assert.equal(binding.issueId,'fixture-issue');
 }finally{await client.close();rmSync(root,{recursive:true,force:true});}
});
