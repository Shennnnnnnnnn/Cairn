// Real Pi CLI only. Private credentials never enter the archive or public output.
import {spawn} from 'node:child_process';
import {mkdtempSync,mkdirSync,cpSync,readFileSync,writeFileSync,appendFileSync,existsSync,chmodSync,rmSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname,resolve} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {publishEvaluationUsage} from './session-usage.mjs';
export const piCli='/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js';
export const provider='sub2api-copy',model='global:deepseek-v4.1-flash',effort='high';
const configSource='/Users/shen/.pi/agent';
const catalogPath='/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai/dist/providers/data/zai.json';
function findModel(value,id){if(Array.isArray(value)){for(const entry of value){const found=findModel(entry,id);if(found)return found;}}else if(value&&typeof value==='object'){if(value.id===id)return value;for(const entry of Object.values(value)){const found=findModel(entry,id);if(found)return found;}}}
export function registration(id){
 const config=JSON.parse(readFileSync(join(configSource,'models.json'),'utf8'));
 const existing=config.providers?.[provider]?.models?.find(m=>m.id===id);
 if(existing)return {entry:existing,source:'existing user registration unchanged'};
 if(id!=='cn:glm-5.3')throw new Error('Requested model missing: '+id);
 const native=findModel(JSON.parse(readFileSync(catalogPath,'utf8')),'glm-5.3');
 if(!native)throw new Error('Pi bundled GLM registration missing');
 return {entry:{id,name:native.name,input:native.input,reasoning:native.reasoning,contextWindow:native.contextWindow,maxTokens:native.maxTokens,cost:{input:0,output:0,cacheRead:0,cacheWrite:0}},source:'Temporary gateway alias using Pi bundled zai glm-5.3 limits/reasoning metadata; gateway capabilities not independently attested',catalogSha256:createHash('sha256').update(readFileSync(catalogPath)).digest('hex')};
}
export const specs=['global:deepseek-v4.1-flash','cn:step-5-preview','cn:kimi-k3-1','cn:glm-5.3'].map((id,index)=>{const r=registration(id);return {slug:['deepseek','step','kimi','glm'][index],host:'pi',provider,id,thinking:r.entry.reasoning?'high':'off',limits:{maxTokens:r.entry.maxTokens,contextWindow:r.entry.contextWindow,reasoning:r.entry.reasoning},registrationSource:r.source,...(r.catalogSha256?{catalogSha256:r.catalogSha256}:{})};});
export function save(path,value){writeFileSync(path,typeof value==='string'?value:JSON.stringify(value,null,2)+'\n',{mode:0o600});}
export const verifierId=(argv,artifacts)=>`command:${createHash('sha256').update(JSON.stringify({argv,artifacts})).digest('hex')}`;
export function registeredLimits(id=model){const m=registration(id).entry;return {maxTokens:m.maxTokens,contextWindow:m.contextWindow,reasoning:m.reasoning};}
export function successfulTaskStarts(tools=[]){return [...new Set(tools.filter(t=>t.name==='cairn_start'&&!t.isError).map(t=>t.details?.taskId??t.result?.structuredContent?.taskId).filter(Boolean))];}
export function assertCairnProtocol({work,metrics,verifyCommand,artifacts,launch,tools=[],strict=true}){
 const database=join(work,'.cairn/state.db'),starts=successfulTaskStarts(tools);let tasks=[];
 if(existsSync(database)){const db=new DatabaseSync(database,{readOnly:true});try{tasks=db.prepare('SELECT state FROM tasks ORDER BY rowid').all().map(r=>JSON.parse(r.state));}finally{db.close();}}
 if(strict&&tasks.length!==1)throw new Error('Probe must have exactly one private task');
 const checked=strict?tasks:starts.map(id=>{const task=tasks.find(t=>t.id===id);if(!task)throw new Error('Successful start missing in private DB');return task;});
 for(const task of checked){
  if(task.owner.host!=='pi'||task.owner.sessionId!==metrics.threadId||resolve(task.owner.cwd)!==resolve(work))throw new Error('Pi native owner/workspace mismatch');
  if(task.completionVerifier!==verifierId(verifyCommand,artifacts))throw new Error('Host verifier identity mismatch');
  if(JSON.stringify((task.artifactRequirements??[]).map(p=>resolve(work,p)).sort())!==JSON.stringify(artifacts.map(p=>resolve(work,p)).sort()))throw new Error('Artifact requirements differ');
  if(['deadline','submitReserveMs','maxCalls','maxParallel'].some(k=>task.budget?.[k]!==undefined))throw new Error('Unexpected task budget');
 }
 if(launch){
  const e=launch.hostEnvironment;
  if(e.CAIRN_DB!==database||e.CAIRN_WORKSPACE!==work||e.CAIRN_VERIFY_COMMAND!==JSON.stringify(verifyCommand)||e.CAIRN_VERIFY_ARTIFACTS!==JSON.stringify(artifacts))throw new Error('Private host environment mismatch');
  if(e.CAIRN_DEADLINE!==undefined||e.CAIRN_SUBMIT_RESERVE_MS!==undefined||launch.evaluationBudgets!==null)throw new Error('Inherited evaluator budget');
 }
 return {database,tasks,taskCount:tasks.length,successfulStartTaskIds:starts,singleTaskGoal:tasks.length===1&&starts.length===1,threadId:metrics.threadId,valid:true};
}
export async function runPi({work,dir,implementation,prompt,common,verifyCommand,artifacts=[],spec=specs[0]}){
 const {id:model,thinking:effort,provider}=spec;
 const privateHome=mkdtempSync(join(tmpdir(),'cairn-pi-round11-private-'));chmodSync(privateHome,0o700);
 const sessionId=randomUUID();
 try{
  for(const name of ['auth.json','models.json'])if(existsSync(join(configSource,name))){cpSync(join(configSource,name),join(privateHome,name));chmodSync(join(privateHome,name),0o600);}
  const selected=registration(model),privateModels=JSON.parse(readFileSync(join(privateHome,'models.json'),'utf8'));
  if(!privateModels.providers[provider].models.some(m=>m.id===model)){privateModels.providers[provider].models.push(selected.entry);save(join(privateHome,'models.json'),privateModels);}
  const settings=JSON.parse(readFileSync(join(configSource,'settings.json'),'utf8'));
  save(join(privateHome,'settings.json'),{defaultProvider:provider,defaultModel:model,...(settings.compaction?{compaction:settings.compaction}:{})});
  const env={};for(const k of ['HOME','USER','LOGNAME','SHELL','LANG','LC_ALL','HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','NO_PROXY','http_proxy','https_proxy','all_proxy','no_proxy','SSL_CERT_FILE','SSL_CERT_DIR'])if(process.env[k])env[k]=process.env[k];
  // Preserve explicitly referenced environment credentials without archiving values.
  const credentials=JSON.parse(readFileSync(join(privateHome,'models.json'),'utf8')).providers?.[provider];
  for(const v of [credentials?.apiKey,...Object.values(credentials?.headers??{})])if(typeof v==='string'&&/^[A-Z_][A-Z_0-9]*$/.test(v)&&process.env[v])env[v]=process.env[v];
  Object.assign(env,{PATH:`${dirname(process.execPath)}:/opt/homebrew/bin:/usr/bin:/bin`,PI_CODING_AGENT_DIR:privateHome,PI_TELEMETRY:'0',NO_COLOR:'1',TMPDIR:join(work,'.tmp'),TMP:join(work,'.tmp'),TEMP:join(work,'.tmp')});
  if(implementation)Object.assign(env,{CAIRN_DB:join(work,'.cairn/state.db'),CAIRN_WORKSPACE:work,CAIRN_VERIFY_COMMAND:JSON.stringify(verifyCommand),CAIRN_VERIFY_ARTIFACTS:JSON.stringify(artifacts),CAIRN_VERIFY_TIMEOUT_MS:'10000'});
  mkdirSync(join(work,'.tmp'),{recursive:true});mkdirSync(join(dir,'sessions'),{recursive:true});
  const args=[piCli,'--offline','--no-extensions','--no-skills','--no-mcp','--no-context-files','--no-prompt-templates','--no-themes','--provider',provider,'--model',model,'--thinking',effort,'--session-id',sessionId,'--session-dir',join(dir,'sessions'),'--mode','json','--append-system-prompt',common];
  if(implementation)args.push('--extension',join(implementation,'dist/pi-extension.mjs'),'--skill',join(implementation,'skills/cairn/SKILL.md'));
  args.push('--tools',implementation?'read,bash,edit,write,cairn_*':'read,bash,edit,write','-p',prompt);
  save(join(dir,'launch.json'),{host:'pi',cli:piCli,requestedProvider:provider,requestedModel:model,requestedEffort:effort,sessionId,workspace:work,implementation:implementation??null,hostEnvironment:Object.fromEntries(Object.entries(env).filter(([k])=>k.startsWith('CAIRN_'))),privateCredentialDirectory:privateHome,credentialFilesArchived:false,evaluationBudgets:null,registeredModelLimits:registeredLimits(model),isolation:'Separate workspaces/configs/DBs and instructions; Pi native execution has no OS sandbox'});
  save(join(dir,'initial.prompt.txt'),prompt);
  const startedAt=new Date().toISOString(),begin=performance.now(),messages=[],tools=[],byId=new Map();let buffer='',lastAssistant,launchError;
  const consume=line=>{
   let event;try{event=JSON.parse(line);}catch{return;}
   if(event.type==='message_end'&&event.message?.role==='assistant'){
    const m=event.message;lastAssistant=m;
    // Usage/route metadata only. Never retain or inspect private thinking content.
    messages.push({provider:m.provider,model:m.model,thinkingLevel:m.thinkingLevel,usage:m.usage,stopReason:m.stopReason,errorMessage:m.errorMessage});
    for(const c of m.content??[])if(c.type==='toolCall'){
     const t={id:c.id,name:c.name,arguments:c.arguments,type:c.name.startsWith('cairn_')?'mcp_tool_call':'native_tool_call',tool:c.name,status:'pending'};tools.push(t);byId.set(c.id,t);
    }
    if(m.stopReason==='stop')save(join(dir,'initial.final.md'),(m.content??[]).filter(c=>c.type==='text').map(c=>c.text).join('\n'));
   }
   if(event.type==='tool_execution_end'){
    const t=byId.get(event.toolCallId);if(t){t.result=event.result;t.details=event.result?.details;t.isError=!!event.isError;t.status=event.isError?'failed':'completed';}
   }
   if(event.type==='message_end'||event.type==='tool_execution_end')save(join(dir,'initial.progress.json'),{pid:child.pid,threadId:sessionId,updatedAt:new Date().toISOString(),elapsedSeconds:(performance.now()-begin)/1000,assistantTurns:messages.length,toolCalls:tools.length,toolErrors:tools.filter(t=>t.isError).length,lastTool:tools.at(-1)?.name,outputTokens:messages.reduce((n,m)=>n+(m.usage?.output??0),0)});
  };
  const child=spawn(process.execPath,args,{cwd:work,env,stdio:['ignore','pipe','pipe'],detached:true});
  child.stdout.on('data',d=>{const s=d.toString();appendFileSync(join(dir,'initial.jsonl'),s);buffer+=s;let i;while((i=buffer.indexOf('\n'))>=0){consume(buffer.slice(0,i));buffer=buffer.slice(i+1);}});
  child.stderr.on('data',d=>appendFileSync(join(dir,'initial.stderr'),d));
  const cancel=()=>{try{process.kill(-child.pid,'SIGTERM');}catch{}};process.once('SIGTERM',cancel);process.once('SIGINT',cancel);
  const ended=await new Promise(resolve=>{child.on('error',e=>{launchError=e.message;resolve({exitCode:null,signal:null});});child.on('close',(exitCode,signal)=>resolve({exitCode,signal}));});
  process.removeListener('SIGTERM',cancel);process.removeListener('SIGINT',cancel);if(buffer)consume(buffer);
  const native={input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0};for(const m of messages)for(const key of Object.keys(native))native[key]+=m.usage?.[key]??0;
  const efforts=[];const sessionFiles=readdirSync(join(dir,'sessions')).filter(p=>p.endsWith('.jsonl'));
  for(const name of sessionFiles)for(const line of readFileSync(join(dir,'sessions',name),'utf8').split('\n')){let e;try{e=JSON.parse(line);}catch{continue;}if(e.type==='thinking_level_change'&&e.thinkingLevel&&!efforts.includes(e.thinkingLevel))efforts.push(e.thinkingLevel);}
  const nativeMetadata={models:[...new Set(messages.map(m=>m.model).filter(Boolean))],providers:[...new Set(messages.map(m=>m.provider).filter(Boolean))],efforts,sessionFiles,tokenUsage:native};save(join(dir,'native-session-metadata.json'),nativeMetadata);
  const turnFailed=!!launchError||messages.some(m=>m.stopReason==='error')||lastAssistant?.stopReason!=='stop';
  const usage=messages.some(m=>m.usage)?{input_tokens:native.input+native.cacheRead+native.cacheWrite,cached_input_tokens:native.cacheRead,cache_write_input_tokens:native.cacheWrite,output_tokens:native.output}:null;
  const metrics={host:'pi',requestedModel:model,requestedEffort:effort,threadId:sessionId,actualModels:nativeMetadata.models,actualProviders:nativeMetadata.providers,actualEfforts:efforts,startedAt,finishedAt:new Date().toISOString(),wallSeconds:(performance.now()-begin)/1000,...ended,launchError,turnFailed,finalStopReason:lastAssistant?.stopReason,usage,nativeUsage:native,usageIsLowerBound:turnFailed||ended.exitCode!==0||messages.some(m=>!m.usage),configuredCost:messages.reduce((n,m)=>n+(m.usage?.cost?.total??0),0),monetaryCostKnown:messages.some(m=>m.usage?.cost?.total>0),errors:messages.filter(m=>m.errorMessage).map(m=>({message:m.errorMessage})),counts:{assistant:messages.length},toolCalls:tools.length,toolErrors:tools.filter(t=>t.isError).length,timedOut:false,budgetExceeded:false,recovery:null};
  save(join(dir,'initial.metrics.json'),metrics);save(join(dir,'initial.tools.json'),tools);return metrics;
 }finally{await publishEvaluationUsage(join(dir,'sessions'));rmSync(privateHome,{recursive:true,force:true});save(join(dir,'credential-cleanup.json'),{path:privateHome,removed:!existsSync(privateHome),credentialFilesArchived:false});}
}
