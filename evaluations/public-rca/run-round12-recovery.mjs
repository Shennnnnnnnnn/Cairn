// Two restored-service Pi model lanes, 36 independent new attempts. No actor watchdog or selective retry.
import {spawnSync} from 'node:child_process';
import {mkdirSync,cpSync,readFileSync,writeFileSync,existsSync,readdirSync,statSync,appendFileSync,mkdtempSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {specs as piSpecs,save} from './pi-driver-round12.mjs';

const repo=resolve(process.cwd()),here=join(repo,'evaluations/public-rca');
const root=join(here,'runs/2026-10-18-scheduler-pi-recovery-round12');
const previous=join(here,'runs/2026-10-18-five-model-round11');
const probeOrigin=join(here,'runs/2026-10-18-scheduler-three-model-round12');
const firstCohort=join(here,'runs/2026-10-18-scheduler-three-model-round12-final');
const mode=process.argv[2],load=path=>JSON.parse(readFileSync(path,'utf8')),sha=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
const hashes=path=>Object.fromEntries(readdirSync(path).sort().flatMap(name=>statSync(join(path,name)).isDirectory()?Object.entries(hashes(join(path,name))).map(([key,value])=>[name+'/'+key,value]):[[name,sha(join(path,name))]]));
const controller=new AbortController();
if(['--probe','--run'].includes(mode))for(const event of ['SIGINT','SIGTERM'])process.on(event,()=>controller.abort(new Error('User cancelled runner with '+event)));
const models=piSpecs;
const readOnlyConfigs=['/Users/shen/.pi/agent/models.json','/Users/shen/.pi/agent/settings.json','/Users/shen/.codex/config.toml'];
function assertFrozen(manifest){
 for(const [name,hash]of Object.entries(manifest.frozenFiles))if(sha(join(root,name))!==hash)throw new Error('Frozen evaluation file changed: '+name);
 for(const [name,hash]of Object.entries(manifest.implementation))if(sha(join(root,'implementation',name))!==hash)throw new Error('Frozen implementation changed: '+name);
 for(const [name,hash]of Object.entries(manifest.cases))if(sha(join(root,'cases',name))!==hash)throw new Error('Frozen input changed: '+name);
}
const nativeDriver=async spec=>import(pathToFileURL(join(root,spec.host==='pi'?'pi-driver-round12.mjs':'codex-driver-round12.mjs')).href);

if(mode==='--prepare'){
 if(existsSync(root))throw new Error('Never overwrite an experiment');
 mkdirSync(root,{recursive:true});
 const original=load(join(firstCohort,'manifest.json'));
 cpSync(join(firstCohort,'cases'),join(root,'cases'),{recursive:true});
 cpSync(join(firstCohort,'implementation'),join(root,'implementation'),{recursive:true});
 const originalFiles=Object.keys(original.frozenFiles).filter(name=>!['run-round12.mjs','protocol-round12.zh-CN.md','probe-origin.json','probes.json'].includes(name));
 for(const name of originalFiles)cpSync(join(firstCohort,name),join(root,name));
 cpSync(join(here,'run-round12-recovery.mjs'),join(root,'run-round12-recovery.mjs'));
 cpSync(join(here,'protocol-round12-recovery.zh-CN.md'),join(root,'protocol-round12-recovery.zh-CN.md'));
 cpSync(join(firstCohort,'probes.json'),join(root,'probes.json'));
 const implementationHashes=hashes(join(root,'implementation'));
 if(JSON.stringify(implementationHashes)!==JSON.stringify(original.implementation))throw new Error('Recovery implementation differs');
 const origin={originalRunRoot:firstCohort,manifestSHA256:sha(join(firstCohort,'manifest.json')),probesSHA256:sha(join(firstCohort,'probes.json')),probeRoots:load(join(firstCohort,'probes.json')).map(value=>value.root),implementationByteIdentical:true,userRecoveryInstructionReceivedAt:'2026-10-18T00:40:30Z',serviceRestoration:'User reported the Pi model services restored; no separate paid service probe',cohortPolicy:'New complete 36-attempt Pi cohort, preserving the entire original 54. Reuse original Sol18 only once in revised main54; historical original Pi36 reported separately. Each new model lane waits for its old lane to finish.'};
 save(join(root,'probe-origin.json'),origin);
 const copies=[...originalFiles,'run-round12-recovery.mjs','protocol-round12-recovery.zh-CN.md','probes.json','probe-origin.json'];
 const manifest={...original,createdAt:new Date().toISOString(),runId:root.split('/').at(-1),models:original.models.filter(value=>value.host==='pi'),schedule:original.schedule.filter(value=>value.model!=='sol'),concurrency:2,rcaActors:36,implementation:implementationHashes,cases:hashes(join(root,'cases')),frozenFiles:Object.fromEntries(copies.map(name=>[name,sha(join(root,name))])),probeOrigin:origin,priorCohort:firstCohort,oldLanesMustFinishBeforeNewLane:true,cohort:'post-user-reported-service-restoration',gradingPolicy:'All original54 and new36 end; all available public reports reviewed before any hidden-label grading. No selective individual rerun.'};
 save(join(root,'manifest.json'),manifest);console.log(JSON.stringify({event:'prepared',root,actors:manifest.schedule.length,models:manifest.models,implementationByteIdentical:true}));
}else if(mode==='--probe'){throw new Error('No paid probe rerun: original probe receipts are preserved');
}else if(mode==='--run'){
 const manifest=load(join(root,'manifest.json'));assertFrozen(manifest);const probes=load(join(root,'probes.json'));
 if(!probes.every(value=>value.integrationValid))throw new Error('Resolve invalid integration before formal actors; failed service/model probes remain retained');
 if(existsSync(join(root,'execution-started.json'))||manifest.schedule.some(row=>existsSync(join(root,row.id))))throw new Error('Never overwrite or restart formal actors');
 const {runScheduled}=await import(pathToFileURL(join(root,'scheduler-driver-round12.mjs')).href);
 save(join(root,'execution-started.json'),{startedAt:new Date().toISOString(),pid:process.pid,manifestSha256:sha(join(root,'manifest.json')),probeSha256:sha(join(root,'probes.json')),actors:manifest.schedule.length,evaluationBudgets:null,priorCohort:firstCohort});
 let active=0,maxConcurrent=0;const outcomes=[];
 await Promise.all(manifest.models.map(async spec=>{
  const oldRows=load(join(firstCohort,'manifest.json')).schedule.filter(row=>row.model===spec.slug);
  console.log(JSON.stringify({event:'waiting_for_prior_lane',model:spec.slug,priorCohort:firstCohort,at:new Date().toISOString()}));
  while(!oldRows.every(row=>existsSync(join(firstCohort,row.id,'actor-finished.json')))){
   if(controller.signal.aborted)return;
   await new Promise(resolve=>{const finish=()=>{clearTimeout(timer);controller.signal.removeEventListener('abort',finish);resolve();},timer=setTimeout(finish,1000);controller.signal.addEventListener('abort',finish,{once:true});});
  }
  if(controller.signal.aborted)return;
  save(join(root,'prior-lane-'+spec.slug+'.json'),{model:spec.slug,releasedAt:new Date().toISOString(),priorActors:oldRows.length,allPriorActorsFinished:true,priorActorFinishHashes:Object.fromEntries(oldRows.map(row=>[row.id,sha(join(firstCohort,row.id,'actor-finished.json'))]))});
  console.log(JSON.stringify({event:'prior_lane_finished',model:spec.slug,at:new Date().toISOString()}));
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
}else throw new Error('Use --prepare or --run');
