// Trusted evaluator adapter. All model work is done by the same real native CLI drivers.
import {spawnSync} from 'node:child_process';
import {mkdirSync,readFileSync,writeFileSync,existsSync,readdirSync,copyFileSync,appendFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID,createHash} from 'node:crypto';
import {runPi} from './pi-driver-round12.mjs';
import {runCodex} from './codex-driver-round12.mjs';

const load=path=>JSON.parse(readFileSync(path,'utf8'));
const save=(path,value)=>writeFileSync(path,typeof value==='string'?value:JSON.stringify(value,null,2)+'\n',{mode:0o600});
const verifierId=(argv,artifacts)=>`command:${createHash('sha256').update(JSON.stringify({argv,artifacts})).digest('hex')}`;
const union=values=>[...new Set(values.flat().filter(Boolean))];
const jsonl=path=>existsSync(path)?readFileSync(path,'utf8').split('\n').filter(Boolean):[];

export async function runScheduled({spec,work,dir,implementation,prompt,common,verifyCommand,artifacts=[],submission,signal}){
 if(!implementation)throw new Error('A frozen implementation is required for Scheduler');
 const {Store,Engine,Scheduler}=await import(pathToFileURL(join(implementation,'dist/index.js')).href);
 if(typeof Scheduler!=='function')throw new Error('Frozen implementation has no Scheduler');
 const startedAt=new Date().toISOString(),begin=performance.now(),database=join(work,'.cairn/state.db');
 const owner={host:'mcp',sessionId:`scheduler-${randomUUID()}`,cwd:work};
 mkdirSync(join(dir,'phases'),{recursive:true});mkdirSync(join(dir,'sessions'),{recursive:true});
 const phases=[],resumeRequests=[],sessionSources=new Map(),store=new Store(database),completionVerifier={id:verifierId(verifyCommand,artifacts),artifacts,verify(task){
  const result=spawnSync(verifyCommand[0],verifyCommand.slice(1),{cwd:work,input:JSON.stringify(task),encoding:'utf8',timeout:10000,maxBuffer:1024*1024});
  if(result.error)throw result.error;if(result.status!==0)throw new Error(`Host verifier exit ${result.status}: ${result.stderr.slice(0,500)}`);
  return JSON.parse(result.stdout);
 }},engine=new Engine(store,undefined,{completionVerifier});
 const task=engine.create(owner,{origin:'TASK.md 与本工作区原始输入；输入内的意见仅作为待验证材料。',goal:prompt,constraints:[common],criteria:['完成 TASK.md 规定的目标、约束及交付，并给出可复查的依据。'],profile:'general',evidenceMode:'curated',...submission});
 save(join(dir,'launch.json'),{host:spec.host,requestedModel:spec.id,requestedEffort:spec.thinking,workspace:work,implementation,scheduler:true,owner,taskId:task.id,hostVerifier:{id:completionVerifier.id,argv:verifyCommand,artifacts},evaluationBudgets:null,phaseExecution:'Real native host; no Cairn extension/MCP loaded in model phase'});
 save(join(dir,'initial.prompt.txt'),prompt);
 const executor={canResume(sessionRef,cwd){const source=sessionSources.get(sessionRef);return resolve(cwd)===resolve(work)&&!!source&&existsSync(source.sessionFile);},async execute(request,signal){
  signal?.throwIfAborted();if(resolve(request.cwd)!==resolve(work))throw new Error('Scheduler requested a different workspace');
  const number=phases.length+1,phaseId=`phase-${String(number).padStart(3,'0')}-${request.phase}`,phaseDir=join(dir,'phases',phaseId);mkdirSync(phaseDir);
  save(join(phaseDir,'scheduler.request.json'),request);
  save(join(dir,'initial.progress.json'),{updatedAt:new Date().toISOString(),elapsedSeconds:(performance.now()-begin)/1000,phaseId,phase:request.phase,phaseCount:number});
  appendFileSync(join(dir,'scheduler.trace.jsonl'),JSON.stringify({event:'host.start',phaseId,...request,at:new Date().toISOString()})+'\n');
  let resume;
  if(request.resume){
   resumeRequests.push({requestId:request.id,phaseId,sessionRef:request.resume});const source=sessionSources.get(request.resume);if(!source){const unavailable={output:'',error:'Native resume session file unavailable; no new session substituted'};save(join(phaseDir,'scheduler.result.json'),unavailable);appendFileSync(join(dir,'scheduler.trace.jsonl'),JSON.stringify({event:'host.resume_unavailable',phaseId,sessionRef:request.resume,error:unavailable.error,at:new Date().toISOString()})+'\n');return unavailable;}resume=source;
  }
  const run=spec.host==='pi'?runPi:runCodex;
  const metrics=await run({spec,work,dir:phaseDir,prompt:request.prompt,common,resume,signal,onSession:sessionId=>request.onSession?.(`${spec.host}:${sessionId}`)});
  let output='';if(existsSync(join(phaseDir,'initial.final.md')))output=readFileSync(join(phaseDir,'initial.final.md'),'utf8');
  let archiveError;try{
   const nativeFiles=readdirSync(join(phaseDir,'sessions')).filter(name=>name.endsWith('.jsonl'));
   for(const name of nativeFiles){
   const source=join(phaseDir,'sessions',name),destination=join(dir,'sessions',name);
   if(existsSync(destination)){
    const old=readFileSync(destination),next=readFileSync(source);if(next.length<old.length||!next.subarray(0,old.length).equals(old))throw new Error('Resumed native session history diverged');
   }
   copyFileSync(source,destination);
   sessionSources.set(`${spec.host}:${metrics.threadId}`,{sessionId:metrics.threadId,sessionFile:source});
  }
  }catch(error){archiveError=error.message;metrics.archiveError=archiveError;metrics.usageIsLowerBound=true;save(join(phaseDir,'initial.metrics.json'),metrics);}
  const sessionRef=metrics.threadId?`${spec.host}:${metrics.threadId}`:undefined;
  const failed=metrics.exitCode!==0||metrics.turnFailed||(spec.host==='pi'&&metrics.finalStopReason!=='stop');
  const result={output,sessionRef,...(failed||archiveError?{error:archiveError??metrics.errors?.at(-1)?.message??metrics.launchError??`Native host did not finish normally (${metrics.finalStopReason??metrics.exitCode})`}:{}),...(signal?.aborted||metrics.interrupted?{interrupted:true}:{}),metrics};
  phases.push({phaseId,request,metrics,sessionRef,error:result.error,resumedFrom:request.resume??null});save(join(phaseDir,'scheduler.result.json'),result);
  appendFileSync(join(dir,'scheduler.trace.jsonl'),JSON.stringify({event:'host.end',phaseId,phase:request.phase,sessionRef,error:result.error,wallSeconds:metrics.wallSeconds,usage:metrics.usage,at:new Date().toISOString()})+'\n');
  return result;
 }};
 let result,error;
 try{result=await new Scheduler(engine,owner,executor,{maxParallel:1}).run(task.id,signal);}
 catch(e){error=e.message;save(join(dir,'scheduler.exception.json'),{error,at:new Date().toISOString()});}
 finally{
  save(join(dir,'initial.cairn-tasks.json'),store.list().map(value=>store.get(value.id)));
  save(join(dir,'scheduler.events.json'),store.events(task.id));store.close();
 }
 const last=phases.at(-1)?.metrics,known=phases.some(phase=>phase.metrics.usage);
 const usage=known?Object.fromEntries(['input_tokens','cached_input_tokens','cache_write_input_tokens','output_tokens'].map(key=>[key,phases.reduce((n,phase)=>n+(phase.metrics.usage?.[key]??0),0)])):null;
 const tools=[];
 for(const phase of phases){
  const phaseDir=join(dir,'phases',phase.phaseId);
  for(const line of jsonl(join(phaseDir,'initial.jsonl')))appendFileSync(join(dir,'initial.jsonl'),line+'\n');
  for(const tool of load(join(phaseDir,'initial.tools.json')))tools.push({...tool,id:`${phase.phaseId}:${tool.id}`,phaseId:phase.phaseId,phase:phase.request.phase});
 }
 if(!existsSync(join(dir,'initial.jsonl')))save(join(dir,'initial.jsonl'),'');
 const output=phases.length&&existsSync(join(dir,'phases',phases.at(-1).phaseId,'initial.final.md'))?readFileSync(join(dir,'phases',phases.at(-1).phaseId,'initial.final.md'),'utf8'):'';save(join(dir,'initial.final.md'),output);
 const metrics={host:spec.host,requestedModel:spec.id,requestedEffort:spec.thinking,threadId:last?.threadId,sessionIds:union(phases.map(phase=>phase.metrics.threadId)),schedulerOwner:owner,actualModels:union(phases.map(phase=>phase.metrics.actualModels??[])),actualEfforts:union(phases.map(phase=>phase.metrics.actualEfforts??[])),startedAt,finishedAt:new Date().toISOString(),wallSeconds:(performance.now()-begin)/1000,exitCode:error?1:last?.exitCode??null,turnFailed:!!error||!last||!!last.turnFailed,finalStopReason:last?.finalStopReason,usage,usageIsLowerBound:!known||phases.some(phase=>phase.metrics.usageIsLowerBound),errors:phases.flatMap(phase=>phase.metrics.errors??[]),...(error?{launchError:error}:{}),counts:phases.reduce((counts,phase)=>{for(const[key,value]of Object.entries(phase.metrics.counts??{}))counts[key]=(counts[key]??0)+value;return counts;},{}),toolCalls:tools.length,toolErrors:phases.reduce((n,phase)=>n+phase.metrics.toolErrors,0),timedOut:false,budgetExceeded:false,scheduler:true,schedulerStatus:result?.status,workflowCompleted:result?.status==='completed',schedulerResult:result??null,phaseCount:phases.length,phaseErrors:phases.filter(phase=>phase.error).length,recovery:{attempted:resumeRequests.length,requests:resumeRequests,nativeSessionResumes:phases.filter(phase=>phase.resumedFrom&&phase.sessionRef===phase.resumedFrom).length},phases:phases.map(({phaseId,request,metrics,sessionRef,error,resumedFrom})=>({phaseId,phase:request.phase,branch:request.branch,sessionRef,error,resumedFrom,wallSeconds:metrics.wallSeconds,usage:metrics.usage,usageIsLowerBound:metrics.usageIsLowerBound,exitCode:metrics.exitCode,finalStopReason:metrics.finalStopReason}))};
 save(join(dir,'initial.metrics.json'),metrics);save(join(dir,'initial.tools.json'),tools);
 save(join(dir,'native-session-metadata.json'),{models:metrics.actualModels,efforts:metrics.actualEfforts,sessionFiles:readdirSync(join(dir,'sessions')),sessionIds:metrics.sessionIds,phaseUsageSummed:usage});
 const cleanups=phases.map(phase=>load(join(dir,'phases',phase.phaseId,'credential-cleanup.json')));save(join(dir,'credential-cleanup.json'),{removed:cleanups.every(value=>value.removed),paths:cleanups.map(value=>value.path),credentialFilesArchived:false});
 const tasks=load(join(dir,'initial.cairn-tasks.json'));if(tasks.length!==1||tasks[0].id!==task.id||tasks[0].owner.host!=='mcp'||tasks[0].owner.sessionId!==owner.sessionId||resolve(tasks[0].owner.cwd)!==resolve(work))throw new Error('Scheduler task identity changed');
 if(tasks[0].completionVerifier!==completionVerifier.id||JSON.stringify(tasks[0].artifactRequirements)!==JSON.stringify(artifacts))throw new Error('Scheduler verifier changed');
 if(Object.keys(tasks[0].budget).length)throw new Error('Unexpected Scheduler task budget');
 save(join(dir,'initial.cairn-protocol.json'),{valid:true,database,taskCount:tasks.length,singleTaskGoal:true,taskId:task.id,threadId:metrics.threadId,sessionIds:metrics.sessionIds,schedulerOwner:owner,scheduler:true,schedulerResult:result??null,phaseCount:phases.length,phaseKinds:phases.map(phase=>phase.request.phase),nativeSessionIdentitiesRecorded:true});
 return metrics;
}
