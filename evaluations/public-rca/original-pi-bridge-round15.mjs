// Native transport for the original Python runtime. Never changes model output.
import {readFileSync,writeFileSync,existsSync,mkdirSync,appendFileSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {runPi,save} from './pi-driver-round15.mjs';
const request=JSON.parse(readFileSync(process.argv[2],'utf8')),dir=request.phaseDir;
let metrics;
if(request.fixture){
 if(!request.dir.includes('integration-fixtures'))throw new Error('Synthetic inference prohibited outside fixtures');
 const ledgerPath=join(request.dir,'fixture-state.json'),state=existsSync(ledgerPath)?JSON.parse(readFileSync(ledgerPath,'utf8')):{reasons:0};
 let data;
 if(request.scenario==='direct')data={accepted:true,data:{fact:{description:'Source marker is alpha'},complete:{description:'The documented marker was read'}}};
 else if(request.phase==='bootstrap')data='invalid bootstrap payload';
 else if(request.phase==='conclude')data={accepted:true,data:{fact:{description:'Source marker exists'}}};
 else if(request.phase==='reason')data=++state.reasons===1?{accepted:true,data:{intents:[{from:['f001'],description:'Read the marker to resolve its content'}]}}:{accepted:true,data:{complete:{from:['f002'],description:'The marker has been checked'}}};
 else if(request.phase==='explore')data={accepted:true,data:{description:'Source marker is alpha'}};
 else throw new Error('Unexpected original fixture phase');
 save(ledgerPath,state);
 const sessionId=request.resumeId??randomUUID(),stamp=new Date().toISOString(),output=typeof data==='string'?data:JSON.stringify(data);
 const message={role:'assistant',provider:request.spec.provider,model:request.spec.id,stopReason:'stop',usage:{input:30,cacheRead:90,cacheWrite:0,output:10,totalTokens:130},content:[{type:'text',text:output}]};
 const events=[{type:'session',id:sessionId},{type:'message_end',message},{type:'agent_end',messages:[message]}];
 mkdirSync(join(dir,'sessions'),{recursive:true});save(join(dir,'sessions',sessionId+'.jsonl'),[{type:'session',id:sessionId,cwd:request.work},{type:'thinking_level_change',thinkingLevel:request.spec.thinking},{type:'message',message}].map(x=>JSON.stringify(x)).join('\n')+'\n');
 save(join(dir,'initial.jsonl'),events.map(x=>JSON.stringify(x)).join('\n')+'\n');save(join(dir,'initial.final.md'),output);save(join(dir,'initial.tools.json'),[]);save(join(dir,'credential-cleanup.json'),{removed:true,credentialFilesArchived:false,synthetic:true});
 metrics={host:'pi',threadId:sessionId,requestedModel:request.spec.id,requestedEffort:request.spec.thinking,actualModels:[request.spec.id],actualProviders:[request.spec.provider],actualEfforts:[request.spec.thinking],exitCode:0,turnFailed:false,finalStopReason:'stop',wallSeconds:0,usage:{input_tokens:120,cached_input_tokens:90,cache_write_input_tokens:0,output_tokens:10},usageIsLowerBound:false,toolCalls:0,toolErrors:0,errors:[],synthetic:true};
 save(join(dir,'initial.metrics.json'),metrics);save(join(dir,'launch.json'),{evaluationBudgets:null,synthetic:true,workspace:request.work,requestedModel:request.spec.id,requestedEffort:request.spec.thinking,implementation:null});
}else{
 const previous=existsSync(join(request.dir,'original.sessions.json'))?JSON.parse(readFileSync(join(request.dir,'original.sessions.json'),'utf8')):{};
 const resume=request.resumeId?previous[request.resumeId]:undefined;
 if(request.resumeId&&!resume)throw new Error('Original native session unavailable; never substitute a fresh session');
 metrics=await runPi({spec:request.spec,work:request.work,dir,prompt:request.prompt,common:request.common,resume});
}
const {readdirSync,copyFileSync}=await import('node:fs');
const registryPath=join(request.dir,'original.sessions.json'),registry=existsSync(registryPath)?JSON.parse(readFileSync(registryPath,'utf8')):{};
mkdirSync(join(request.dir,'sessions'),{recursive:true});
for(const name of readdirSync(join(dir,'sessions')).filter(x=>x.endsWith('.jsonl'))){
 const source=join(dir,'sessions',name),destination=join(request.dir,'sessions',name);
 if(existsSync(destination)&&!request.fixture){const old=readFileSync(destination),next=readFileSync(source);if(next.length<old.length||!next.subarray(0,old.length).equals(old))throw new Error('Original resumed history diverged');}
 copyFileSync(source,destination);registry[metrics.threadId]={sessionId:metrics.threadId,sessionFile:source};
}
save(registryPath,registry);
appendFileSync(join(request.dir,'original.phase-receipts.jsonl'),JSON.stringify({phase:request.phase,phaseDir:dir,number:request.number,sessionId:metrics.threadId,resumeId:request.resumeId??null,wallSeconds:metrics.wallSeconds,usage:metrics.usage})+'\n');
// The header is a locator from the actual native receipt, needed by the original
// driver's session parser. Assistant responses remain the native event bytes.
process.stdout.write(JSON.stringify({type:'session',id:metrics.threadId})+'\n');
process.stdout.write(readFileSync(join(dir,'initial.jsonl')));
process.exitCode=metrics.exitCode??1;
