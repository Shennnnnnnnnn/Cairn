// Three model lanes, 54 independent attempts. No actor watchdog or selective retry.
import {spawnSync} from 'node:child_process';
import {mkdirSync,cpSync,readFileSync,writeFileSync,existsSync,readdirSync,statSync,appendFileSync,mkdtempSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {specs as piSpecs,save} from './pi-driver-round12.mjs';

const repo=resolve(process.cwd()),here=join(repo,'evaluations/public-rca');
const root=join(here,'runs/2026-10-18-scheduler-three-model-round12-final');
const previous=join(here,'runs/2026-10-18-five-model-round11');
const probeOrigin=join(here,'runs/2026-10-18-scheduler-three-model-round12');
const mode=process.argv[2],load=path=>JSON.parse(readFileSync(path,'utf8')),sha=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
const hashes=path=>Object.fromEntries(readdirSync(path).sort().flatMap(name=>statSync(join(path,name)).isDirectory()?Object.entries(hashes(join(path,name))).map(([key,value])=>[name+'/'+key,value]):[[name,sha(join(path,name))]]));
const controller=new AbortController();
if(['--probe','--run'].includes(mode))for(const event of ['SIGINT','SIGTERM'])process.on(event,()=>controller.abort(new Error('User cancelled runner with '+event)));
const models=[...piSpecs,{slug:'sol',host:'codex',id:'gpt-6.1-sol',thinking:'xhigh'}];
const readOnlyConfigs=['/Users/shen/.pi/agent/models.json','/Users/shen/.pi/agent/settings.json','/Users/shen/.codex/config.toml'];
function assertFrozen(manifest){
 for(const [name,hash]of Object.entries(manifest.frozenFiles))if(sha(join(root,name))!==hash)throw new Error('Frozen evaluation file changed: '+name);
 for(const [name,hash]of Object.entries(manifest.implementation))if(sha(join(root,'implementation',name))!==hash)throw new Error('Frozen implementation changed: '+name);
 for(const [name,hash]of Object.entries(manifest.cases))if(sha(join(root,'cases',name))!==hash)throw new Error('Frozen input changed: '+name);
}
const nativeDriver=async spec=>import(pathToFileURL(join(root,spec.host==='pi'?'pi-driver-round12.mjs':'codex-driver-round12.mjs')).href);

if(mode==='--prepare'){
 if(existsSync(root))throw new Error('Never overwrite an experiment');
 if(!existsSync(join(repo,'src/scheduler.ts')))throw new Error('Scheduler implementation is not ready');
 mkdirSync(root,{recursive:true});
 for(const name of ['new-01','new-02','new-03'])cpSync(join(previous,'cases',name),join(root,'cases',name),{recursive:true});
 for(const name of ['src','dist','skills'])cpSync(join(repo,name),join(root,'implementation',name),{recursive:true});
 const copies=['pi-driver-round12.mjs','codex-driver-round12.mjs','scheduler-driver-round12.mjs','run-round12.mjs','session-usage.mjs','probe-verifier.mjs','protocol-round12.zh-CN.md','analyze-round12.py','assess-round12.mjs','read-reports-round12.py','check-components-round12.mjs','diagnostics-round12.py','scope-round12.py','progress-round12.py','write-report-round12.py'];
 for(const name of copies)cpSync(join(here,name),join(root,name));
 const inherited=['prompt.frozen.txt','reproduction-contract.frozen.md','case-manifest.json','grade.py','verify-artifacts.mjs','verify-reproduction.py','verify-submission.mjs'];
 for(const name of inherited)cpSync(join(previous,name),join(root,name));
 const schedule=[];
 for(const [mi,spec]of models.entries())for(let repeat=1;repeat<=3;repeat++)for(let ci=0;ci<3;ci++){
  const name=['new-01','new-02','new-03'][(ci+repeat+mi-1)%3];
  for(const arm of (ci+repeat+mi)%2?['native','cairn']:['cairn','native'])schedule.push({id:`${spec.slug}-${name}-r${repeat}-${arm}`,model:spec.slug,case:name,repeat,arm,kind:'rca'});
 }
 const old=load(join(previous,'manifest.json'));
 const probeManifest=load(join(probeOrigin,'manifest.json')),implementationHashes=hashes(join(root,'implementation'));
 if(JSON.stringify(implementationHashes)!==JSON.stringify(probeManifest.implementation))throw new Error('Formal implementation must be byte-identical to original probe src/dist/skills');
 const origin={originalRunRoot:probeOrigin,manifestSHA256:sha(join(probeOrigin,'manifest.json')),probesSHA256:sha(join(probeOrigin,'probes.json')),probeRoots:load(join(probeOrigin,'probes.json')).map(value=>value.root),implementationByteIdentical:true,implementationHashes,cancellationBoundary:'Only trusted evaluation runner SIGINT/SIGTERM propagation/stop-next-actor control added after probes; core, phase prompts, model configs, cases and checkers unchanged. All original probe failures and costs retained; no paid probe rerun.'};
 save(join(root,'probe-origin.json'),origin);cpSync(join(probeOrigin,'probes.json'),join(root,'probes.json'));
 copies.push('probe-origin.json','probes.json');
 const manifest={createdAt:new Date().toISOString(),runId:root.split('/').at(-1),models,schedule,repeats:3,concurrency:3,perModelConcurrency:1,rcaActors:54,genericActors:0,evaluationBudgets:null,common:old.common,cairnGuidance:null,scheduler:{enabled:true,maxParallel:1,phaseModel:'same model and effort as paired native arm',owner:'trusted mcp scheduler owner; real native session refs recorded separately',nativeToolsOnly:true},implementation:implementationHashes,probeOrigin:origin,cases:hashes(join(root,'cases')),frozenFiles:Object.fromEntries([...copies,...inherited].map(name=>[name,sha(join(root,name))])),globalConfigHashes:Object.fromEntries(readOnlyConfigs.filter(existsSync).map(path=>[path,sha(path)])),node:process.version,piVersion:load('/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/package.json').version,codexVersion:spawnSync('/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex',['--version'],{encoding:'utf8'}).stdout.trim(),gradingPolicy:'All 54 actors end and every public report is reviewed before hidden-label grading. No selective rerun.',completionPolicy:old.completionPolicy,labelPolicy:old.labelPolicy,costPolicy:'All native phase token usage summed; resumed native session cumulative ledger deduplicated; unknown failure usage stays lower bound. No real invoice.',stabilityPolicy:old.stabilityPolicy,previousRun:previous};
 save(join(root,'manifest.json'),manifest);console.log(JSON.stringify({event:'prepared',root,actors:schedule.length,models}));
}else if(mode==='--probe'){
 const manifest=load(join(root,'manifest.json'));assertFrozen(manifest);if(existsSync(join(root,'probes.json')))throw new Error('Do not replace probes');
 const {runScheduled}=await import(pathToFileURL(join(root,'scheduler-driver-round12.mjs')).href);
 save(join(root,'probe-started.json'),{startedAt:new Date().toISOString(),pid:process.pid,manifestSHA256:sha(join(root,'manifest.json'))});
 const results=await Promise.all(manifest.models.map(async spec=>{
  const dir=mkdtempSync(join(here,'runs/probe-round12-'+spec.slug+'-')),work=join(dir,'workspace');mkdirSync(work);save(join(work,'marker.txt'),'alpha\n');
  const verifyCommand=[process.execPath,join(root,'probe-verifier.mjs')],artifacts=['marker.txt'];
  const metrics=await runScheduled({spec,work,dir,implementation:join(root,'implementation'),verifyCommand,artifacts,signal:controller.signal,common:'独立合成接入探针。只读取当前工作区，不修改marker、不联网或调用其他模型。',prompt:'验证marker.txt完整内容是alpha后跟换行，并保留原文件。criteria c1是marker保持给定内容。实际读取后可直接完成；使用阶段JSON协议，checkpoint findings至少一条，key=marker，status=supported，basis为实际读取依据，references=["marker.txt"]，covers=["c1"]。'});
  const tasks=load(join(dir,'initial.cairn-tasks.json')),valid=tasks.length===1&&tasks[0].owner.host==='mcp'&&metrics.scheduler===true&&metrics.phaseCount>0;
  const success=valid&&tasks[0].status==='completed'&&metrics.exitCode===0;
  const result={model:spec.slug,success,integrationValid:valid,root:dir,metrics,taskStatus:tasks[0]?.status};save(join(dir,'probe.metrics.json'),result);console.log(JSON.stringify({event:'probe_complete',model:spec.slug,success,integrationValid:valid,taskStatus:result.taskStatus,root:dir}));return result;
 }));
 save(join(root,'probes.json'),results);console.log(JSON.stringify({event:'probes_sealed',success:results.every(value=>value.success),integrationValid:results.every(value=>value.integrationValid),count:results.length,cancelled:controller.signal.aborted}));if(controller.signal.aborted)process.exitCode=130;
}else if(mode==='--run'){
 const manifest=load(join(root,'manifest.json'));assertFrozen(manifest);const probes=load(join(root,'probes.json'));
 if(!probes.every(value=>value.integrationValid))throw new Error('Resolve invalid integration before formal actors; failed service/model probes remain retained');
 if(existsSync(join(root,'execution-started.json'))||manifest.schedule.some(row=>existsSync(join(root,row.id))))throw new Error('Never overwrite or restart formal actors');
 const {runScheduled}=await import(pathToFileURL(join(root,'scheduler-driver-round12.mjs')).href);
 save(join(root,'execution-started.json'),{startedAt:new Date().toISOString(),pid:process.pid,manifestSha256:sha(join(root,'manifest.json')),probeSha256:sha(join(root,'probes.json')),actors:manifest.schedule.length,evaluationBudgets:null});
 let active=0,maxConcurrent=0;const outcomes=[];
 await Promise.all(manifest.models.map(async spec=>{
  const driver=await nativeDriver(spec);
  for(const row of manifest.schedule.filter(value=>value.model===spec.slug)){
   if(controller.signal.aborted)break;
   const dir=join(root,row.id),work=join(dir,'workspace');mkdirSync(dir);cpSync(join(root,'cases',row.case),work,{recursive:true});appendFileSync(join(work,'TASK.md'),'\n\n'+readFileSync(join(root,'reproduction-contract.frozen.md'),'utf8'));save(join(dir,'input-hashes.json'),hashes(work));
   const artifacts=['answer.json','REPORT.md','checks.json'],verifyCommand=[process.execPath,join(root,'verify-submission.mjs'),join(dir,'input-hashes.json')],prompt=readFileSync(join(root,'prompt.frozen.txt'),'utf8');
   active++;maxConcurrent=Math.max(maxConcurrent,active);console.log(JSON.stringify({event:'actor_start',...row,at:new Date().toISOString(),active}));
   try{
    const metrics=row.arm==='cairn'?await runScheduled({spec,work,dir,implementation:join(root,'implementation'),prompt,common:manifest.common,verifyCommand,artifacts,signal:controller.signal}):await(spec.host==='pi'?driver.runPi:driver.runCodex)({spec,work,dir,prompt,common:manifest.common,signal:controller.signal});
    for(const name of [...artifacts,'EXPLORATION.md'])if(existsSync(join(work,name)))cpSync(join(work,name),join(dir,'initial.'+name));
    const replay=spawnSync(verifyCommand[0],verifyCommand.slice(1),{input:JSON.stringify({owner:{cwd:work}}),encoding:'utf8',timeout:15000});
    let acceptance;try{acceptance=JSON.parse(replay.stdout);}catch{acceptance={ok:false,issues:[{message:replay.error?.message??'No valid checker JSON'}],infrastructureUnavailable:true};}save(join(dir,'initial.acceptance.json'),acceptance);
    save(join(dir,'actor-finished.json'),{...row,finishedAt:new Date().toISOString(),hiddenGradesDeferred:true});outcomes.push({id:row.id,ended:true});
    console.log(JSON.stringify({event:'actor_complete',...row,wallSeconds:metrics.wallSeconds,usage:metrics.usage,exitCode:metrics.exitCode,finalStopReason:metrics.finalStopReason,turnFailed:metrics.turnFailed,schedulerStatus:metrics.schedulerStatus,phaseCount:metrics.phaseCount,accepted:acceptance.ok}));
   }catch(error){save(join(dir,'infrastructure-failure.json'),{error:error.message,at:new Date().toISOString()});outcomes.push({id:row.id,infrastructureFailure:error.message});console.log(JSON.stringify({event:'infrastructure_failure',id:row.id,error:error.message}));break;}
   finally{active--;}
  }
 }));
 save(join(root,'execution-ended.json'),{endedAt:new Date().toISOString(),allActorsEnded:outcomes.length===manifest.schedule.length&&outcomes.every(value=>value.ended),maxConcurrent,outcomes,cancelled:controller.signal.aborted,hiddenGradesDeferred:true});if(controller.signal.aborted)process.exitCode=130;console.log(JSON.stringify({event:'all_lanes_ended',actors:outcomes.length,maxConcurrent}));
}else throw new Error('Use --prepare, --probe or --run');
