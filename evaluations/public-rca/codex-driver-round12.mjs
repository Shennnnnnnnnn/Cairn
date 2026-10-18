// Local Codex CLI driver. Credentials stay in a private temporary child config.
import {spawn,spawnSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,cpSync,readFileSync,writeFileSync,appendFileSync,existsSync,chmodSync,rmSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {publishEvaluationUsage} from './session-usage.mjs';
export const codexCli='/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex';
export const model='gpt-6.1-sol',effort='xhigh';
export const cairnEnvironment=['CAIRN_DB','CAIRN_WORKSPACE','CAIRN_VERIFY_COMMAND','CAIRN_VERIFY_ARTIFACTS','CAIRN_VERIFY_TIMEOUT_MS','CAIRN_DEADLINE','CAIRN_SUBMIT_RESERVE_MS'];
const toml=value=>typeof value==='string'?JSON.stringify(value):Array.isArray(value)?`[${value.map(toml).join(',')}]`:value&&typeof value==='object'?`{${Object.entries(value).map(([k,v])=>`${JSON.stringify(k)}=${toml(v)}`).join(',')}}`:String(value);
export function save(path,value){writeFileSync(path,typeof value==='string'?value:JSON.stringify(value,null,2)+'\n',{mode:0o600});}
export const verifierId=(argv,artifacts)=>`command:${createHash('sha256').update(JSON.stringify({argv,artifacts})).digest('hex')}`;
export function successfulTaskStarts(tools=[]){
 const ids=[];
 for(const tool of tools){
  if(tool.type!=='mcp_tool_call'||tool.tool!=='cairn_start'||tool.status!=='completed'||tool.error||tool.result?.isError)continue;
  const candidates=[tool.result?.structuredContent,tool.result?.structured_content,tool.result];
  for(const content of tool.result?.content??[])if(content.type==='text')try{candidates.push(JSON.parse(content.text));}catch{}
  for(const value of candidates)if(typeof value?.taskId==='string')ids.push(value.taskId);
 }
 return [...new Set(ids)];
}
/** Successful start receipts must resolve to the configured private host. Model non-use/multiple goals remain behavior failures. */
export function assertCairnProtocol({work,metrics,verifyCommand,artifacts,launch,tools=[],strict=true}){
 const database=join(work,'.cairn/state.db');
 const starts=successfulTaskStarts(tools);let tasks=[];
 if(existsSync(database)){const db=new DatabaseSync(database,{readOnly:true});try{tasks=db.prepare('SELECT state FROM tasks ORDER BY rowid').all().map(row=>JSON.parse(row.state));}finally{db.close();}}
 if(strict&&tasks.length!==1)throw new Error(`Probe failure: expected exactly one private Cairn task, found ${tasks.length}`);
 const checked=strict?tasks:starts.map(id=>{const task=tasks.find(task=>task.id===id);if(!task)throw new Error(`Protocol failure: successful cairn_start receipt ${id} is missing from the private database`);return task;});
 const required=artifacts.map(path=>resolve(work,path)).sort();
 for(const task of checked){
  if(!metrics.threadId||task.owner.host!=='codex'||task.owner.sessionId!==metrics.threadId||resolve(task.owner.cwd)!==resolve(work))throw new Error('Protocol failure: task owner differs from the native Codex thread/workspace');
  if(!verifyCommand?.length||task.completionVerifier!==verifierId(verifyCommand,artifacts))throw new Error('Protocol failure: host completion verifier was not configured identically');
  if(JSON.stringify((task.artifactRequirements??[]).map(path=>resolve(work,path)).sort())!==JSON.stringify(required))throw new Error('Protocol failure: host artifact requirements are missing or different');
  if(strict&&(task.budget?.deadline||task.budget?.submitReserveMs!==undefined||task.budget?.maxCalls!==undefined))throw new Error('Probe failure: unexpected task budget');
 }
 if(launch){
  const mcp=launch.options?.['mcp_servers.cairn'],index=mcp?.args?.indexOf('--db');
  if(!mcp||index===undefined||index<0||mcp.args[index+1]!==database)throw new Error('Protocol failure: MCP private database argument is absent');
  if(!cairnEnvironment.every(name=>mcp?.env_vars?.includes(name)))throw new Error('Protocol failure: MCP environment forwarding whitelist is incomplete');
  if(launch.hostEnvironment?.CAIRN_DB!==database||launch.hostEnvironment?.CAIRN_VERIFY_COMMAND!==JSON.stringify(verifyCommand)||launch.hostEnvironment?.CAIRN_VERIFY_ARTIFACTS!==JSON.stringify(artifacts))throw new Error('Protocol failure: recorded host environment differs');
  if(launch.hostEnvironment?.CAIRN_DEADLINE!==undefined||launch.hostEnvironment?.CAIRN_SUBMIT_RESERVE_MS!==undefined)throw new Error('Protocol failure: inherited evaluation deadline/reserve');
 }
 const task=tasks[0];
 return {database,tasks,taskCount:tasks.length,successfulStartTaskIds:starts,singleTaskGoal:tasks.length===1&&starts.length===1,behavior:tasks.length>1?'multiple_tasks':starts.length===0?'no_successful_start':'single_task',taskId:task?.id,threadId:metrics.threadId,completionVerifier:task?.completionVerifier,artifactRequirements:task?.artifactRequirements,valid:true};
}
export async function runCodex({work,dir,implementation,prompt,common,verifyCommand,artifacts=[],resume,onSession,signal}){
 const privateCodexHome=mkdtempSync(join(tmpdir(),'cairn-codex-private-'));chmodSync(privateCodexHome,0o700);
 let child,sessionNotificationError;const notifySession=id=>{try{onSession?.(id);}catch(error){sessionNotificationError=error.message;}};
 try{
  for(const name of ['auth.json','models_cache.json'])if(existsSync(join('/Users/shen/.codex',name))){cpSync(join('/Users/shen/.codex',name),join(privateCodexHome,name));chmodSync(join(privateCodexHome,name),0o600);}
  const env={};for(const k of ['HOME','USER','LOGNAME','SHELL','LANG','LC_ALL','HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','NO_PROXY','http_proxy','https_proxy','all_proxy','no_proxy','SSL_CERT_FILE','SSL_CERT_DIR'])if(process.env[k])env[k]=process.env[k];
  Object.assign(env,{PATH:`${dirname(process.execPath)}:/opt/homebrew/bin:/usr/bin:/bin`,CODEX_HOME:privateCodexHome,TMPDIR:join(work,'.tmp'),TMP:join(work,'.tmp'),TEMP:join(work,'.tmp'),NO_COLOR:'1',CAIRN_DB:join(work,'.cairn/state.db'),CAIRN_WORKSPACE:work});
  if(verifyCommand){env.CAIRN_VERIFY_COMMAND=JSON.stringify(verifyCommand);env.CAIRN_VERIFY_TIMEOUT_MS='10000';if(artifacts.length)env.CAIRN_VERIFY_ARTIFACTS=JSON.stringify(artifacts);}
  mkdirSync(join(work,'.tmp'),{recursive:true});
  let plugin,hooks;
  if(implementation){
   const installed=spawnSync(process.execPath,[join(implementation,'dist/cairn.mjs'),'install','--target','codex','--root',work],{env,encoding:'utf8'});
   if(installed.status!==0)throw new Error('Frozen Codex installation failed: '+installed.stderr);
   plugin=JSON.parse(installed.stdout).plugin;hooks=JSON.parse(readFileSync(join(work,'.codex/hooks.json'),'utf8')).hooks;
  }
  const options={model_reasoning_effort:effort,cli_auth_credentials_store:'file',approval_policy:'never',web_search:'disabled',project_doc_max_bytes:0,developer_instructions:common,'features.apps':false,'features.plugins':false,'features.memories':false,'features.multi_agent':false,'features.multi_agent_v2':false,'features.goals':false,'features.skip_host_skill_discovery':true,'features.hooks':!!implementation,'features.computer_use':false,'features.browser_use':false,'features.image_generation':false};
  if(implementation){options['mcp_servers.cairn']={command:process.execPath,args:[join(plugin,'runtime/cairn.mjs'),'mcp','--host','codex','--root',work,'--db',env.CAIRN_DB],env_vars:cairnEnvironment,required:true,default_tools_approval_mode:'approve'};options.hooks=hooks;}
  let baselineUsage;
  if(resume){
   if(!resume.sessionFile||!existsSync(resume.sessionFile))throw new Error('Native resume session file missing');
   let header;for(const line of readFileSync(resume.sessionFile,'utf8').split('\n')){let event;try{event=JSON.parse(line);}catch{continue;}if(event.type==='session_meta')header=event.payload;if(event.type==='event_msg'&&event.payload?.type==='token_count')baselineUsage=event.payload.info?.total_token_usage??baselineUsage;}
   if(header?.id!==resume.sessionId)throw new Error('Native resume session ID mismatch');
   const stamp=new Date(header.timestamp).toISOString().slice(0,10).split('-'),target=join(privateCodexHome,'sessions',...stamp);mkdirSync(target,{recursive:true});cpSync(resume.sessionFile,join(target,resume.sessionFile.split('/').at(-1)));
  }
  const args=resume?['exec','--sandbox','workspace-write','resume','--ignore-user-config','--skip-git-repo-check','--ignore-rules','--json','--model',model]:['exec','--ignore-user-config','--skip-git-repo-check','--ignore-rules','--json','--color','never','--model',model,'--sandbox','workspace-write','--cd',work];
  if(implementation)args.push('--dangerously-bypass-hook-trust'); // only the just-installed, archived local hooks
  for(const [key,value] of Object.entries(options))args.push('-c',`${key}=${toml(value)}`);
  args.push('--output-last-message',join(dir,'initial.final.md'));if(resume)args.push(resume.sessionId);args.push(prompt);
  save(join(dir,'launch.json'),{host:'codex',requestedModel:model,requestedEffort:effort,workspace:work,implementation:implementation??null,plugin:plugin??null,options,hostEnvironment:Object.fromEntries(cairnEnvironment.filter(name=>env[name]!==undefined).map(name=>[name,env[name]])),credentialFilesArchived:false,evaluationBudgets:null,nativeResume:resume?{sessionId:resume.sessionId,source:resume.sessionFile,baselineUsage}:null});
  save(join(dir,'initial.prompt.txt'),prompt);
  const startedAt=new Date().toISOString(),begin=performance.now();let buffer='',stderr='',threadId,usage,turnFailed=false;
  const counts={},tools=[],errors=[],clientNotices=[];
  child=spawn(codexCli,args,{cwd:work,env,stdio:['ignore','pipe','pipe'],detached:true});
  const consume=line=>{
   let event;try{event=JSON.parse(line);}catch{return;}
   if(event.type==='thread.started'){threadId=event.thread_id;notifySession(threadId);}
   if(event.type==='turn.completed'){usage=event.usage;turnFailed=false;}
   if(event.type==='turn.failed'){turnFailed=true;errors.push(event.error??{message:'turn.failed'});}
   if(event.type==='error')errors.push({message:event.message??event.error?.message??'error'});
   const item=event.item;
   if(event.type==='item.completed'&&item){
    counts[item.type]=(counts[item.type]??0)+1;
    if(item.type==='error')clientNotices.push({message:item.message});
    // Never read, print, summarize or forward reasoning item contents.
    if(item.type==='command_execution')tools.push({type:item.type,id:item.id,command:item.command,exitCode:item.exit_code,status:item.status});
    if(item.type==='mcp_tool_call')tools.push({type:item.type,id:item.id,server:item.server,tool:item.tool,arguments:item.arguments,status:item.status,error:item.error,result:item.result});
   }
   save(join(dir,'initial.progress.json'),{pid:child.pid,threadId,updatedAt:new Date().toISOString(),elapsedSeconds:(performance.now()-begin)/1000,counts,toolCalls:tools.length,lastTool:tools.at(-1)?.tool??tools.at(-1)?.type,turnFailed});
  };
  child.stdout.on('data',data=>{const text=data.toString();appendFileSync(join(dir,'initial.jsonl'),text);buffer+=text;let i;while((i=buffer.indexOf('\n'))>=0){consume(buffer.slice(0,i));buffer=buffer.slice(i+1);}});
  child.stderr.on('data',data=>{stderr+=data;save(join(dir,'initial.stderr'),stderr);});
  const cancelled=()=>{try{process.kill(-child.pid,'SIGTERM');}catch{}};
  process.once('SIGTERM',cancelled);process.once('SIGINT',cancelled);signal?.addEventListener('abort',cancelled,{once:true});if(signal?.aborted)cancelled();
  const result=await new Promise(resolve=>{child.on('error',error=>resolve({exitCode:null,signal:null,launchError:error.message}));child.on('close',(exitCode,signal)=>resolve({exitCode,signal}));});
  process.removeListener('SIGTERM',cancelled);process.removeListener('SIGINT',cancelled);signal?.removeEventListener('abort',cancelled);if(buffer)consume(buffer);if(threadId)notifySession(threadId);
  const nativeMetadata={models:[],efforts:[],sessionFiles:[],tokenUsage:null};
  const walk=path=>existsSync(path)?readdirSync(path,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(join(path,e.name)):[join(path,e.name)]):[];
  mkdirSync(join(dir,'sessions'),{recursive:true});
  for(const path of walk(join(privateCodexHome,'sessions')).filter(p=>threadId&&p.includes(threadId)&&p.endsWith('.jsonl'))){
   const name=path.split('/').at(-1);cpSync(path,join(dir,'sessions',name));nativeMetadata.sessionFiles.push(name);
   for(const line of readFileSync(path,'utf8').split('\n')){
    let e;try{e=JSON.parse(line);}catch{continue;}
    if(e.type==='turn_context'){
     if(e.payload?.model&&!nativeMetadata.models.includes(e.payload.model))nativeMetadata.models.push(e.payload.model);
     const level=e.payload?.effort??e.payload?.reasoning_effort;if(level&&!nativeMetadata.efforts.includes(level))nativeMetadata.efforts.push(level);
    }
    if(e.type==='event_msg'&&e.payload?.type==='token_count')nativeMetadata.tokenUsage=e.payload.info?.total_token_usage??nativeMetadata.tokenUsage;
   }
  }
  if(resume&&nativeMetadata.tokenUsage){const cumulative=nativeMetadata.tokenUsage;usage=Object.fromEntries(Object.entries(cumulative).map(([key,value])=>[key,value-(baselineUsage?.[key]??0)]));if(Object.values(usage).some(value=>value<0))throw new Error('Native resumed usage moved backwards');}
  save(join(dir,'native-session-metadata.json'),nativeMetadata);
  const metrics={host:'codex',requestedModel:model,requestedEffort:effort,threadId,actualModels:nativeMetadata.models,actualEfforts:nativeMetadata.efforts,startedAt,finishedAt:new Date().toISOString(),wallSeconds:(performance.now()-begin)/1000,...result,usage:usage??null,usageIsLowerBound:errors.length>0||!usage||turnFailed||result.exitCode!==0,turnFailed,sessionNotificationError,interrupted:!!signal?.aborted||!!result.signal,errors,clientNotices,counts,toolCalls:tools.length,toolErrors:tools.filter(t=>t.type==='command_execution'?t.exitCode!==0:t.status==='failed'||t.error||t.result?.isError).length,timedOut:false,budgetExceeded:false,recovery:null};
  save(join(dir,'initial.metrics.json'),metrics);save(join(dir,'initial.tools.json'),tools);return metrics;
 }finally{await publishEvaluationUsage(join(dir,'sessions'),{nativeRoot:join(privateCodexHome,'sessions')});rmSync(privateCodexHome,{recursive:true,force:true});save(join(dir,'credential-cleanup.json'),{path:privateCodexHome,removed:!existsSync(privateCodexHome),credentialFilesArchived:false});}
}
