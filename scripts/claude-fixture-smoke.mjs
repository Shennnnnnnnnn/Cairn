// Real Claude Code CLI + deterministic local Messages API fixture. No model credentials.
import {createServer} from 'node:http';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
const root=mkdtempSync(join(tmpdir(),'cairn-claude-fixture-')),entry=resolve('dist/cairn.mjs'),db=join(root,'.cairn/state.db');
const isolatedHome=join(root,'isolated-home'),configDir=join(root,'isolated-claude');
mkdirSync(isolatedHome,{recursive:true});mkdirSync(configDir,{recursive:true});
// Inherit no account, proxy or user configuration. Native session files stay here.
const env={PATH:[dirname(process.execPath),process.env.PATH??'/usr/bin:/bin'].join(':'),HOME:isolatedHome,CLAUDE_CONFIG_DIR:configDir,CAIRN_DB:db,CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:'1',ANTHROPIC_API_KEY:'cairn-local-fixture-not-a-credential',ENABLE_TOOL_SEARCH:'false',NO_COLOR:'1'};
const coreNames=['cairn_start','cairn_resume','cairn_read','cairn_update','cairn_checkpoint','cairn_finish'];

const installed=spawnSync(process.execPath,[entry,'install','--target','claude','--root',root],{env,encoding:'utf8'});if(installed.status!==0)throw new Error(installed.stderr);
const plugin=JSON.parse(installed.stdout).plugin;writeFileSync(join(root,'evidence.txt'),'cairn-smoke-verified\n');
let phase='create',step=0,sessionId=randomUUID(),requestCount=0;
const operations=[];
function task(){if(!existsSync(db))return;const sql=new DatabaseSync(db);try{const row=sql.prepare('SELECT state FROM tasks ORDER BY rowid DESC LIMIT 1').get();return row?JSON.parse(row.state):undefined;}finally{sql.close();}}
const server=createServer(async(req,res)=>{
 try{
  let raw='';for await(const chunk of req)raw+=chunk;
  if(req.url?.includes('count_tokens')){res.setHeader('content-type','application/json');res.end(JSON.stringify({input_tokens:20}));return;}
  if(!req.url?.includes('/messages')){res.writeHead(200,{'content-type':'application/json'});res.end('{}');return;}
  requestCount++;if(requestCount>25)throw new Error('Fixture exceeded request budget');
  const body=JSON.parse(raw),state=task();let operation,args;
  for(const name of coreNames)if(!body.tools?.some(tool=>tool.name===name||tool.name.endsWith('__'+name)))throw new Error('CLI did not expose '+name);
  if(phase==='create'){
   const operations=[['cairn_start',{evidence_mode:'captured',goal:'Verify marker',criteria:['File contains marker'],session_id:sessionId}],['Read',{file_path:join(root,'evidence.txt')}],['cairn_update',{finding:{key:'marker',text:'File contains marker',status:'supported',basis:'Read original marker',evidence:['E1'],covers:['c1']}}],['cairn_checkpoint',{summary:'Verified original marker',questions:['Reviewer acceptance pending']}],['cairn_finish',{outcome:'suspended',summary:'Reviewer pending'}]];
   [operation,args]=operations[step]??[];
  }else{[operation,args]=[['cairn_resume',{task_id:state?.id,session_id:sessionId,takeover:true}],['cairn_read',{view:'context',focus:'marker'}],['cairn_checkpoint',{summary:'Reviewer accepted the saved evidence',questions:[]}],['cairn_finish',{}]][step]??[];}
  const tool=operation?body.tools?.find(t=>t.name===operation||t.name.endsWith(`__${operation}`)):undefined;
  if(operation&&!tool)throw new Error(`CLI did not expose ${operation}; available: ${(body.tools??[]).map(t=>t.name).join(',')}`);
  if(tool)operations.push({phase,tool:operation});
  const block=tool?{type:'tool_use',id:`tool_${phase}_${step}`,name:tool.name,input:args}:{type:'text',text:'FIXTURE_DONE'};step++;
  const message={id:`msg_${requestCount}`,type:'message',role:'assistant',model:body.model,content:[block],stop_reason:tool?'tool_use':'end_turn',stop_sequence:null,usage:{input_tokens:20,output_tokens:30}};
  if(!body.stream){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(message));return;}
  res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache'});
  const event=(type,value)=>res.write(`event: ${type}\ndata: ${JSON.stringify(value)}\n\n`);
  event('message_start',{type:'message_start',message:{...message,content:[],stop_reason:null,usage:{input_tokens:20,output_tokens:0}}});
  event('content_block_start',{type:'content_block_start',index:0,content_block:tool?{...block,input:{}}:{type:'text',text:''}});
  event('content_block_delta',{type:'content_block_delta',index:0,delta:tool?{type:'input_json_delta',partial_json:JSON.stringify(args)}:{type:'text_delta',text:'FIXTURE_DONE'}});
  event('content_block_stop',{type:'content_block_stop',index:0});event('message_delta',{type:'message_delta',delta:{stop_reason:message.stop_reason,stop_sequence:null},usage:{output_tokens:30}});event('message_stop',{type:'message_stop'});res.end();
 }catch(error){console.error(error.message);res.writeHead(400,{'content-type':'application/json'});res.end(JSON.stringify({type:'error',error:{type:'invalid_request_error',message:error.message}}));}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));env.ANTHROPIC_BASE_URL=`http://127.0.0.1:${server.address().port}`;
async function launch(){
 const allowed=['Read',...coreNames.map(name=>'mcp__plugin_cairn_cairn__'+name)];
 const child=spawn(process.env.CAIRN_CLAUDE_BIN??'claude',['--plugin-dir',plugin,'--setting-sources','','--tools','default','--allowedTools',...allowed,'--session-id',sessionId,'--debug-file',join(root,`${phase}.debug.log`),'--output-format','stream-json','--verbose','--include-hook-events','-p',`Local fixture test: execute the provided Cairn actions for phase ${phase}.`],{cwd:root,env,stdio:['ignore','pipe','pipe']});let stdout='',stderr='';child.stdout.on('data',c=>stdout+=c);child.stderr.on('data',c=>stderr+=c);
 const timer=setTimeout(()=>child.kill('SIGTERM'),90000);const code=await new Promise((resolve,reject)=>{child.once('exit',resolve);child.once('error',reject);});clearTimeout(timer);
 writeFileSync(join(root,`${phase}.jsonl`),stdout,{mode:0o600});writeFileSync(join(root,`${phase}.stderr`),stderr,{mode:0o600});
 if(code!==0)throw new Error(`Claude CLI failed (${code}); logs: ${root}`);
}
try{
 console.log(JSON.stringify({root,mode:'real-cli/local-protocol-fixture'}));await launch();
 let t=task();if(t?.status!=='suspended'||!t.report||!t.observations.some(o=>o.source==='hook'&&o.eligible))throw new Error(`Native capture/report assertion failed: ${root}`);
 phase='resume';step=0;sessionId=randomUUID();await launch();t=task();
 if(t?.status!=='completed'||t.owner.epoch!==2)throw new Error(`Recovery/completion assertion failed: ${root}`);
 console.log(JSON.stringify({ok:true,host:'claude',mode:'real-cli/local-protocol-fixture',requests:requestCount,tools:operations,isolatedConfig:true,paidModelCalls:0,taskId:t.id,observations:t.observations.length,epoch:t.owner.epoch,root}));
}finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
