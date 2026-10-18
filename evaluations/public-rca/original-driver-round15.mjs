import {spawn} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync,readdirSync,existsSync,appendFileSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const here=dirname(fileURLToPath(import.meta.url));
const save=(path,value)=>writeFileSync(path,typeof value==='string'?value:JSON.stringify(value,null,2)+'\n',{mode:0o600});
const load=p=>JSON.parse(readFileSync(p,'utf8'));
export async function runOriginal({root,spec,work,dir,prompt,common,signal,fixture=false,scenario}){
 mkdirSync(join(dir,'phases'),{recursive:true});mkdirSync(join(dir,'sessions'),{recursive:true});
 const config={originalSource:join(root,'original/cairn/src'),node:process.execPath,bridge:join(root,'original-pi-bridge-round15.mjs'),work,dir,spec,prompt,common,fixture,scenario};
 const configPath=join(dir,'original.launch.json');save(configPath,config);
 save(join(dir,'launch.json'),{host:'pi',requestedModel:spec.id,requestedEffort:spec.thinking,workspace:work,implementation:config.originalSource,originalPython:true,evaluationBudgets:null,fixture});save(join(dir,'initial.prompt.txt'),prompt);
 const startedAt=new Date().toISOString(),begin=performance.now();
 const child=spawn('/private/tmp/cairn-round15-python/bin/python',[join(root,'original-driver-round15.py'),configPath],{cwd:work,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'},stdio:['ignore','pipe','pipe']});
 child.stdout.on('data',d=>appendFileSync(join(dir,'original.stdout'),d));child.stderr.on('data',d=>appendFileSync(join(dir,'original.stderr'),d));
 const cancel=()=>{try{child.kill('SIGTERM');}catch{}};signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted)cancel();
 const terminal=await new Promise(resolve=>{child.on('error',error=>resolve({exitCode:null,launchError:error.message}));child.on('close',(exitCode,signal)=>resolve({exitCode,signal}));});signal?.removeEventListener('abort',cancel);
 const phases=[],tools=[];
 for(const name of readdirSync(join(dir,'phases')).sort()){
  const phaseDir=join(dir,'phases',name);if(!existsSync(join(phaseDir,'initial.metrics.json')))continue;
  const metrics=load(join(phaseDir,'initial.metrics.json')),request=load(join(phaseDir,'original.request.json'));
  phases.push({phaseId:name,phase:request.phase,sessionRef:'pi:'+metrics.threadId,resumedFrom:request.resumeId?'pi:'+request.resumeId:null,contextMode:request.phase==='reason'?'full':null,continuationKind:request.phase==='conclude'?'fault_conclude':'fresh_phase',promptBytes:Buffer.byteLength(request.prompt),commonBytes:Buffer.byteLength(common),wallSeconds:metrics.wallSeconds,usage:metrics.usage,usageIsLowerBound:metrics.usageIsLowerBound,exitCode:metrics.exitCode,finalStopReason:metrics.finalStopReason,metrics});
  for(const tool of load(join(phaseDir,'initial.tools.json')))tools.push({...tool,id:name+':'+tool.id,phaseId:name,phase:request.phase});
  if(existsSync(join(phaseDir,'initial.jsonl')))appendFileSync(join(dir,'initial.jsonl'),readFileSync(join(phaseDir,'initial.jsonl')));
 }
 const last=phases.at(-1)?.metrics,known=phases.some(p=>p.usage),usage=known?Object.fromEntries(['input_tokens','cached_input_tokens','cache_write_input_tokens','output_tokens'].map(key=>[key,phases.reduce((n,p)=>n+(p.usage?.[key]??0),0)])):null;
 const original=existsSync(join(dir,'original.terminal.json'))?load(join(dir,'original.terminal.json')):{status:'unknown',error:terminal.launchError??'Original runtime ended without a terminal receipt'};
 const union=values=>[...new Set(values.flat().filter(Boolean))];
 const metrics={host:'pi',requestedModel:spec.id,requestedEffort:spec.thinking,startedAt,finishedAt:new Date().toISOString(),wallSeconds:(performance.now()-begin)/1000,...terminal,threadId:last?.threadId,sessionIds:union(phases.map(p=>p.metrics.threadId)),actualModels:union(phases.map(p=>p.metrics.actualModels??[])),actualProviders:union(phases.map(p=>p.metrics.actualProviders??[])),actualEfforts:union(phases.map(p=>p.metrics.actualEfforts??[])),usage,usageIsLowerBound:!known||phases.some(p=>p.usageIsLowerBound),turnFailed:terminal.exitCode!==0||!!original.error||!!last?.turnFailed,finalStopReason:last?.finalStopReason,errors:phases.flatMap(p=>p.metrics.errors??[]),toolCalls:tools.length,toolErrors:phases.reduce((n,p)=>n+p.metrics.toolErrors,0),timedOut:false,budgetExceeded:false,originalPython:true,originalStatus:original.status,workflowCompleted:original.status==='completed',phaseCount:phases.length,phases:phases.map(({metrics,...p})=>p),recovery:{attempted:phases.filter(p=>p.phase==='conclude').length},counts:{assistant:phases.reduce((n,p)=>n+(p.metrics.counts?.assistant??0),0)}};
 save(join(dir,'initial.metrics.json'),metrics);save(join(dir,'initial.tools.json'),tools);if(!existsSync(join(dir,'initial.jsonl')))save(join(dir,'initial.jsonl'),'');
 save(join(dir,'initial.final.md'),phases.length?readFileSync(join(dir,'phases',phases.at(-1).phaseId,'initial.final.md'),'utf8'):'');
 const cleanups=phases.map(p=>load(join(dir,'phases',p.phaseId,'credential-cleanup.json')));save(join(dir,'credential-cleanup.json'),{removed:cleanups.every(v=>v.removed),paths:cleanups.flatMap(v=>v.path?[v.path]:[]),credentialFilesArchived:false});
 return metrics;
}
