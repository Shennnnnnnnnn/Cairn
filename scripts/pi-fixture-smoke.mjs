// Real Pi CLI + a deterministic loopback Messages API fixture. No real model credentials.
// This verifies native extension integration and recovery, not diagnostic reasoning quality.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';

const root=mkdtempSync(join(tmpdir(),'cairn-pi-fixture-')),entry=resolve('dist/cairn.mjs'),db=join(root,'.cairn/state.db');
const agentDir=join(root,'isolated-agent'),providerExtension=join(root,'local-provider.mjs');
mkdirSync(agentDir,{recursive:true});
writeFileSync(join(agentDir,'auth.json'),'{}\n',{mode:0o600});
// Deliberately inherit no model keys, auth tokens, proxy settings or user configuration paths.
const env={PATH:`${dirname(process.execPath)}:/opt/homebrew/bin:/usr/bin:/bin`,PI_CODING_AGENT_DIR:agentDir,CAIRN_DB:db,NO_COLOR:'1'};
const installed=spawnSync(process.execPath,[entry,'install','--target','pi','--root',root],{env,encoding:'utf8',timeout:15000});
if(installed.status!==0)throw new Error(`Pi fixture install failed: ${installed.stderr||installed.error?.message}`);
const plugin=JSON.parse(installed.stdout).plugin;
writeFileSync(join(root,'evidence.txt'),'cairn-smoke-verified\n');

let phase='create',step=0,sessionId=randomUUID(),requestCount=0,activeChild;
const failures=[],operations=[];
const coreNames=['cairn_start','cairn_resume','cairn_read','cairn_checkpoint','cairn_finish'];
function savedTask(){
 if(!existsSync(db))return;
 const sql=new DatabaseSync(db);
 try{const row=sql.prepare('SELECT state FROM tasks ORDER BY rowid DESC LIMIT 1').get();return row?JSON.parse(row.state):undefined;}
 finally{sql.close();}
}
function toolResults(body){
 return (body.messages??[]).flatMap(message=>Array.isArray(message.content)?message.content.filter(block=>block.type==='tool_result'):[]);
}
function verifyPrevious(body){
 if(!step)return;
 const previous=toolResults(body).find(result=>result.tool_use_id===`tool_${phase}_${step-1}`);
 assert.ok(previous,`Pi did not return the previous tool result for ${phase}/${step-1}`);
 assert.ok(!previous.is_error,`Pi tool failed at ${phase}/${step-1}: ${JSON.stringify(previous.content)}`);
 if(phase==='create'&&step===2){
  const text=JSON.stringify(previous.content);assert.match(text,/cairn-smoke-verified/);assert.match(text,/Cairn E1/);
 }
}
const server=createServer(async(req,res)=>{
 try{
  if(req.method!=='POST'||!req.url?.includes('/messages'))throw new Error(`Unexpected local API request ${req.method} ${req.url}`);
  let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>2_000_000)throw new Error('Local request exceeded fixture size limit');}
  requestCount++;assert.ok(requestCount<=16,'Fixture exceeded its bounded request budget');
  const body=JSON.parse(raw),state=savedTask();
  const exposed=new Set((body.tools??[]).map(tool=>tool.name));
  for(const name of coreNames)assert.ok(exposed.has(name),`Pi did not expose ${name}`);
  assert.deepEqual([...exposed].filter(name=>name.startsWith('cairn_')).sort(),[...coreNames].sort());
  for(const tool of body.tools??[])if(coreNames.includes(tool.name))assert.equal(tool.input_schema?.properties?.session_id,undefined,'Pi must bind native identity without a model-facing session_id');
  verifyPrevious(body);
  const planned=phase==='create'?[
   ['cairn_start',{goal:'Verify marker',criteria:['File contains marker']}],
   ['read',{path:join(root,'evidence.txt')}],
   ['cairn_finish',{outcome:'suspended',summary:'Verified marker; reviewer pending',findings:[{key:'marker',text:'File contains marker',evidence:['E1'],covers:['c1']}],questions:['Reviewer acceptance pending']}],
  ]:[
   ['cairn_resume',{task_id:state?.id,takeover:true}],
   ['cairn_finish',{summary:'Reviewer accepted the saved evidence',questions:[]}],
  ];
  const [operation,args]=planned[step]??[];
  if(operation){assert.ok(exposed.has(operation),`Pi did not expose ${operation}`);operations.push({phase,tool:operation});}
  const block=operation?{type:'tool_use',id:`tool_${phase}_${step}`,name:operation,input:args}:{type:'text',text:'FIXTURE_DONE'};
  step++;
  const message={id:`msg_${requestCount}`,type:'message',role:'assistant',model:body.model,content:[block],stop_reason:operation?'tool_use':'end_turn',stop_sequence:null,usage:{input_tokens:20,output_tokens:30}};
  if(!body.stream){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(message));return;}
  res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache'});
  const event=(type,value)=>res.write(`event: ${type}\ndata: ${JSON.stringify(value)}\n\n`);
  event('message_start',{type:'message_start',message:{...message,content:[],stop_reason:null,usage:{input_tokens:20,output_tokens:0}}});
  event('content_block_start',{type:'content_block_start',index:0,content_block:operation?{...block,input:{}}:{type:'text',text:''}});
  event('content_block_delta',{type:'content_block_delta',index:0,delta:operation?{type:'input_json_delta',partial_json:JSON.stringify(args)}:{type:'text_delta',text:'FIXTURE_DONE'}});
  event('content_block_stop',{type:'content_block_stop',index:0});
  event('message_delta',{type:'message_delta',delta:{stop_reason:message.stop_reason,stop_sequence:null},usage:{output_tokens:30}});
  event('message_stop',{type:'message_stop'});res.end();
 }catch(error){
  failures.push(error.message);
  if(!res.headersSent)res.writeHead(400,{'content-type':'application/json'});
  res.end(JSON.stringify({type:'error',error:{type:'invalid_request_error',message:error.message}}));
 }
});
async function launch(){
 const args=['--offline','--no-context-files','--no-extensions','--extension',providerExtension,'--extension',join(plugin,'runtime/pi-extension.mjs'),'--no-skills','--no-prompt-templates','--tools','read,cairn_*','--provider','cairn-fixture','--model','cairn-fixture','--thinking','off','--session-id',sessionId,'--session-dir',join(root,'sessions'),'--mode','json','-p',`Bounded local Cairn protocol fixture: execute the supplied tool actions for phase ${phase}.`];
 const child=spawn('pi',args,{cwd:root,env,stdio:['ignore','pipe','pipe']});activeChild=child;
 let stdout='',stderr='',timedOut=false,killTimer;
 child.stdout.on('data',chunk=>stdout+=chunk);child.stderr.on('data',chunk=>stderr+=chunk);
 const timer=setTimeout(()=>{timedOut=true;child.kill('SIGTERM');killTimer=setTimeout(()=>child.kill('SIGKILL'),3000);},45000);
 let code;
 try{code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});}
 finally{clearTimeout(timer);clearTimeout(killTimer);activeChild=undefined;writeFileSync(join(root,`${phase}.jsonl`),stdout,{mode:0o600});writeFileSync(join(root,`${phase}.stderr`),stderr,{mode:0o600});}
 if(timedOut||code!==0)throw new Error(`Pi CLI ${timedOut?'timed out':`failed (${code})`}; fixture logs: ${root}`);
 if(failures.length)throw new Error(`Local protocol fixture rejected Pi requests: ${failures.join('; ')}; logs: ${root}`);
 assert.ok(stdout.includes('FIXTURE_DONE'),`Pi did not finish the ${phase} fixture; logs: ${root}`);
}

try{
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 const baseUrl=`http://127.0.0.1:${server.address().port}`;
 // Pi's documented registerProvider supports the built-in anthropic-messages API
 // and literal dummy keys. Model traffic can only reach this loopback fixture.
 writeFileSync(providerExtension,`export default function(pi){pi.registerProvider('cairn-fixture',{baseUrl:${JSON.stringify(baseUrl)},apiKey:'cairn-local-fixture-not-a-credential',api:'anthropic-messages',models:[{id:'cairn-fixture',name:'Cairn local protocol fixture',reasoning:false,input:['text'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:200000,maxTokens:4096}]});}\n`,{mode:0o600});
 console.log(JSON.stringify({root,mode:'real-cli/local-protocol-fixture',isolatedAgentDir:agentDir}));
 await launch();
 let task=savedTask();
 assert.equal(task?.status,'suspended');assert.equal(task.owner.sessionId,sessionId);assert.equal(task.owner.host,'pi');assert.equal(task.owner.epoch,1);
 assert.equal(task.observations.length,1);const observation=task.observations[0];
 assert.equal(observation.source,'hook');assert.equal(observation.tool,'read');assert.equal(observation.eligible,true);assert.equal(observation.actor.sessionId,sessionId);assert.match(JSON.stringify(observation.output),/cairn-smoke-verified/);
 assert.equal(task.report.citations[0].observationId,observation.id);assert.equal(task.claims[0].supports[0],observation.id);
 const originalObservationId=observation.id,originalTaskId=task.id;
 phase='resume';step=0;sessionId=randomUUID();await launch();task=savedTask();
 assert.equal(task.id,originalTaskId);assert.equal(task.status,'completed');assert.equal(task.owner.host,'pi');assert.equal(task.owner.sessionId,sessionId);assert.equal(task.owner.epoch,2);
 assert.equal(task.observations.length,1);assert.equal(task.report.citations[0].observationId,originalObservationId);
 assert.deepEqual(operations.map(item=>item.tool),['cairn_start','read','cairn_finish','cairn_resume','cairn_finish']);
 assert.equal(readFileSync(join(agentDir,'auth.json'),'utf8').trim(),'{}','The isolated blank auth store must remain empty');
 console.log(JSON.stringify({ok:true,host:'pi',mode:'real-cli/local-protocol-fixture',requests:requestCount,tools:operations,taskId:task.id,observations:task.observations.length,epoch:task.owner.epoch,root}));
}finally{
 if(activeChild&&activeChild.exitCode===null){activeChild.kill('SIGKILL');await new Promise(resolve=>activeChild.once('close',resolve));}
 server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
}
