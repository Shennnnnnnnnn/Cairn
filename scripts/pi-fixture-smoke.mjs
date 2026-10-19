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

const dsh=process.argv.includes('--dsh');
const curated=dsh||process.argv.includes('--curated');
const exploration=process.argv.includes('--exploration-loop');
const feedback=process.argv.includes('--completion-feedback')||exploration;
const root=mkdtempSync(join(tmpdir(),dsh?'cairn-dsh-fixture-':'cairn-pi-fixture-')),entry=resolve('dist/cairn.mjs'),db=join(root,'.cairn/state.db');
const agentDir=join(root,'isolated-agent'),providerExtension=join(root,'local-provider.mjs');
mkdirSync(agentDir,{recursive:true});
writeFileSync(join(agentDir,'auth.json'),'{}\n',{mode:0o600});
// Deliberately inherit no model keys, auth tokens, proxy settings or user configuration paths.
const env={PATH:`${dirname(process.execPath)}:/opt/homebrew/bin:/usr/bin:/bin`,PI_CODING_AGENT_DIR:agentDir,CAIRN_DB:db,NO_COLOR:'1'};
const installed=spawnSync(process.execPath,[entry,'install','--target',dsh?'dsh':'pi','--root',root],{env,encoding:'utf8',timeout:15000});
if(installed.status!==0)throw new Error(`Pi fixture install failed: ${installed.stderr||installed.error?.message}`);
const plugin=JSON.parse(installed.stdout).plugin;
writeFileSync(join(root,'evidence.txt'),'cairn-smoke-verified\n');

let phase='create',step=0,sessionId=randomUUID(),requestCount=0,activeChild;
const failures=[],operations=[];
const coreNames=['cairn_start','cairn_resume','cairn_read','cairn_update','cairn_checkpoint','cairn_finish'];
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
 assert.ok(previous,`Host did not return the previous tool result for ${phase}/${step-1}`);
 assert.ok(!previous.is_error,`Pi tool failed at ${phase}/${step-1}: ${JSON.stringify(previous.content)}`);
 if(phase==='create'&&step===2&&!feedback){
  const text=JSON.stringify(previous.content);assert.match(text,/cairn-smoke-verified/);if(!curated)assert.match(text,/Cairn E1/);
 }
 if(feedback&&!exploration&&phase==='create'&&[4,5].includes(step)){
  const text=typeof previous.content==='string'?previous.content:previous.content.map(block=>block.text??'').join('\n'),result=JSON.parse(text);
  assert.equal(result.phase,'incomplete');assert.equal(result.repair.attempts,step-3);
  assert.deepEqual(result.repair.missingCriteria,[{id:'c2',text:'Reviewer accepts the saved marker'}]);
  assert.equal(savedTask().claims.length,1,'Repeated incomplete finish must retain one finding');
 }
}
const server=createServer(async(req,res)=>{
 try{
  if(req.method!=='POST'||!req.url?.includes('/messages'))throw new Error(`Unexpected local API request ${req.method} ${req.url}`);
  let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>2_000_000)throw new Error('Local request exceeded fixture size limit');}
  requestCount++;assert.ok(requestCount<=16,'Fixture exceeded its bounded request budget');
  const body=JSON.parse(raw),state=savedTask();
  const exposed=new Set((body.tools??[]).map(tool=>tool.name));
  for(const name of coreNames)assert.ok(exposed.has(name),`Host did not expose ${name}: ${[...exposed].join(",")}`);
  assert.deepEqual([...exposed].filter(name=>name.startsWith('cairn_')).sort(),[...coreNames].sort());
  for(const tool of body.tools??[])if(coreNames.includes(tool.name))assert.equal(tool.input_schema?.properties?.session_id,undefined,'Pi must bind native identity without a model-facing session_id');
  verifyPrevious(body);
  if(exploration&&phase==='create'&&step===3){
   const previous=toolResults(body).find(result=>result.tool_use_id===`tool_${phase}_2`);
   const text=typeof previous.content==='string'?previous.content:previous.content.map(block=>block.text??'').join('');
   const receipt=JSON.parse(text);assert.equal(receipt.exploration.next,'Review the saved fact');assert.deepEqual(receipt.exploration.unmet,['c2']);
  }
 const planned=exploration?(phase==='create'?[
   ['cairn_start',{goal:'Verify marker through the blackboard',criteria:['Observe the supplied marker','Conclude from saved facts']}],
   ['read',{path:join(root,'evidence.txt')}],
   ['cairn_checkpoint',{summary:'Marker observed; review next',findings:[{key:'marker',text:'The file contains cairn-smoke-verified',status:'supported',basis:'Read the original supplied file',references:[join(root,'evidence.txt')],covers:['c1']}],progress:[{key:'inspect',title:'Inspect original marker',status:'completed'}],questions:['Can the saved fact support the requested conclusion?'],next:'Review the saved fact'}],
   ['cairn_finish',{outcome:'suspended',summary:'Fact preserved; resume for conclusion'}],
  ]:[
   ['cairn_resume',{task_id:state?.id,takeover:true}],
   ['cairn_read',{view:'context',focus:'marker'}],
   ['cairn_checkpoint',{findings:[{key:'conclusion',text:'The saved original marker establishes the requested conclusion',status:'supported',basis:'Compared the saved original marker',from:['marker'],covers:['c2']}],questions:[]}],
   ['cairn_finish',{}],
  ]):feedback?(phase==='create'?[
   ['cairn_start',{goal:'Verify marker and review',criteria:['File contains marker','Reviewer accepts the saved marker']}],
   ['read',{path:join(root,'evidence.txt')}],
   ['cairn_checkpoint',{findings:[{key:'marker',text:'File contains marker',status:'supported',basis:'Read marker file',references:[join(root,'evidence.txt')],covers:['c1']}]}],
   ['cairn_finish',{}],
   ['cairn_finish',{}],
   ['cairn_finish',{outcome:'suspended',summary:'Marker saved; await reviewer'}],
  ]:[
   ['cairn_resume',{task_id:state?.id,takeover:true}],
   ['cairn_checkpoint',{summary:'Marker and reviewer accepted',questions:[],findings:[{key:'review',text:'Reviewer accepts the saved marker',status:'supported',basis:'Deterministic fixture reviewer compared the original marker',covers:['c2']}]}],
   ['cairn_finish',{}],
  ]):phase==='create'?[
   ['cairn_start',{evidence_mode:curated?'curated':'captured',goal:'Verify marker',criteria:['File contains marker']}],
   ['read',{path:join(root,'evidence.txt')}],
   ['cairn_checkpoint',{summary:'Verified marker; reviewer pending',findings:[{key:'marker',text:'File contains marker',status:'supported',...(curated?{basis:'Read the original supplied file',references:[join(root,'evidence.txt')]}:{evidence:['E1']}),covers:['c1']}],questions:['Reviewer acceptance pending']}],
   ['cairn_finish',{outcome:'suspended'}],
  ]:[
   ['cairn_resume',{task_id:state?.id,takeover:true}],
   ['cairn_checkpoint',{questions:[]}],
   ['cairn_finish',{summary:'Reviewer accepted the saved evidence'}],
  ];
  const [operation,args]=planned[step]??[];
  if(operation){assert.ok(exposed.has(operation),`Host did not expose ${operation}`);operations.push({phase,tool:operation});}
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
 const dshBin=process.env.CAIRN_DSH_BIN;
 if(dsh&&!dshBin)throw new Error('Set CAIRN_DSH_BIN to the official DSH CLI');
 const child=spawn(dsh?process.execPath:'pi',dsh?[dshBin,'--profile','headless','--patch',join(root,'dsh-patch.json'),'--json',`Protocol fixture ${phase}`]:args,{cwd:root,env:{...env,...(dsh?{DSH_HOME:join(root,'dsh-home'),CAIRN_FIXTURE_KEY:'dummy',DSH_TELEMETRY_MODE:'OFF'}:{})},stdio:['ignore','pipe','pipe']});activeChild=child;
 let stdout='',stderr='',timedOut=false,killTimer;
 child.stdout.on('data',chunk=>stdout+=chunk);child.stderr.on('data',chunk=>stderr+=chunk);
 const timer=setTimeout(()=>{timedOut=true;child.kill('SIGTERM');killTimer=setTimeout(()=>child.kill('SIGKILL'),3000);},45000);
 let code;
 try{code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});}
 finally{clearTimeout(timer);clearTimeout(killTimer);activeChild=undefined;writeFileSync(join(root,`${phase}.jsonl`),stdout,{mode:0o600});writeFileSync(join(root,`${phase}.stderr`),stderr,{mode:0o600});}
 if(timedOut||code!==0)throw new Error(`Host CLI ${timedOut?'timed out':`failed (${code})`}; fixture logs: ${root}`);
 if(failures.length)throw new Error(`Local protocol fixture rejected Pi requests: ${failures.join('; ')}; logs: ${root}`);
 assert.ok(stdout.includes('FIXTURE_DONE'),`Host did not finish the ${phase} fixture; logs: ${root}`);
}

try{
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 const baseUrl=`http://127.0.0.1:${server.address().port}`;
 // Pi's documented registerProvider supports the built-in anthropic-messages API
 // and literal dummy keys. Model traffic can only reach this loopback fixture.
 writeFileSync(providerExtension,`export default function(pi){pi.registerProvider('cairn-fixture',{baseUrl:${JSON.stringify(baseUrl)},apiKey:'cairn-local-fixture-not-a-credential',api:'anthropic-messages',models:[{id:'cairn-fixture',name:'Cairn local protocol fixture',reasoning:false,input:['text'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:200000,maxTokens:4096}]});}\n`,{mode:0o600});
 if(dsh){
  const readPlugin=join(root,'fixture-read.mjs');
  writeFileSync(readPlugin,`import fs from 'node:fs';export default {name:'fixture-read',inject:['agents','tools'],apply(ctx){ctx.on('agent/created',({agent})=>{agent.ctx.tools.register({name:'read',description:'Read the original fixture marker',parameters:{type:'object',properties:{path:{type:'string'}},required:['path']},output:{schema:{},render:(_a,v)=>[{type:'text',text:v}]},execute:async(args)=>fs.readFileSync(args.path,'utf8')});});}};`);
  writeFileSync(join(root,'dsh-patch.json'),JSON.stringify([
   {id:'agent-default-model',config:{provider:'cairn-fixture',model:'cairn-fixture'}},
   {id:'llm-pi-ai',config:{providers:{'cairn-fixture':{api:'anthropic-messages',apiKeyEnv:'CAIRN_FIXTURE_KEY',baseURL:baseUrl,models:[{id:'cairn-fixture',name:'Fixture',input:['text'],contextWindow:200000}],reasoning:'off'}}}},
   ...['session-title-llm','session-telemetry-otel','tool-bash','tool-pwsh','tool-subagent','tool-subagent-fork','tool-workflow','tool-web'].map(id=>({id,disabled:true})),
   {insert:[{id:'fixture-read',name:readPlugin},{id:'cairn',name:join(plugin,'runtime/dsh-extension.mjs'),config:{includeSkill:false}}]},
   {id:'headless-runner',inject:['headlessStartup','cairnReady']}
  ]));
 }
 console.log(JSON.stringify({root,mode:exploration?'real-cli/exploration-loop-fixture':feedback?'real-cli/completion-feedback-fixture':'real-cli/local-protocol-fixture',isolatedAgentDir:agentDir}));
 await launch();
 let task=savedTask();if(dsh)sessionId=task.owner.sessionId;
 assert.equal(task?.status,'suspended');assert.equal(task.owner.sessionId,sessionId);assert.equal(task.owner.host,dsh?'dsh':'pi');assert.equal(task.owner.epoch,1);
 const observation=task.observations[0];
 if(feedback){assert.equal(task.observations.length,0);assert.equal(task.claims.length,1);if(exploration){assert.equal(task.checkpoint.next,'Review the saved fact');assert.equal(task.progress[0].status,'completed');}else assert.equal(task.finishAttempt.attempts,2);assert.equal(task.criteria[1].claimIds.length,0);}
 else {
  assert.equal(task.observations.length,curated?0:1);if(!curated){assert.equal(observation.source,'hook');assert.equal(observation.tool,'read');assert.equal(observation.eligible,true);assert.equal(observation.actor.sessionId,sessionId);assert.match(JSON.stringify(observation.output),/cairn-smoke-verified/);
  assert.equal(task.report.citations[0].observationId,observation.id);assert.equal(task.claims[0].supports[0],observation.id); }
 }
 const originalObservationId=observation?.id,originalTaskId=task.id;
 phase='resume';step=0;sessionId=randomUUID();await launch();task=savedTask();if(dsh)sessionId=task.owner.sessionId;
 assert.equal(task.id,originalTaskId);assert.equal(task.status,'completed');assert.equal(task.owner.host,dsh?'dsh':'pi');assert.equal(task.owner.sessionId,sessionId);assert.equal(task.owner.epoch,2);
 if(feedback){assert.equal(task.observations.length,0);assert.equal(task.claims.length,2);assert.ok(task.criteria.every(criterion=>criterion.claimIds.length===1));}
 else {assert.equal(task.observations.length,curated?0:1);if(!curated)assert.equal(task.report.citations[0].observationId,originalObservationId);}
 assert.deepEqual(operations.map(item=>item.tool),exploration?['cairn_start','read','cairn_checkpoint','cairn_finish','cairn_resume','cairn_read','cairn_checkpoint','cairn_finish']:feedback?['cairn_start','read','cairn_checkpoint','cairn_finish','cairn_finish','cairn_finish','cairn_resume','cairn_checkpoint','cairn_finish']:['cairn_start','read','cairn_checkpoint','cairn_finish','cairn_resume','cairn_checkpoint','cairn_finish']);
 assert.equal(readFileSync(join(agentDir,'auth.json'),'utf8').trim(),'{}','The isolated blank auth store must remain empty');
 console.log(JSON.stringify({ok:true,host:dsh?'dsh':'pi',mode:exploration?'real-cli/exploration-loop-fixture':feedback?'real-cli/completion-feedback-fixture':'real-cli/local-protocol-fixture',requests:requestCount,tools:operations,taskId:task.id,observations:task.observations.length,epoch:task.owner.epoch,root}));
}finally{
 if(activeChild&&activeChild.exitCode===null){activeChild.kill('SIGKILL');await new Promise(resolve=>activeChild.once('close',resolve));}
 server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
}
