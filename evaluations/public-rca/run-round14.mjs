// Frozen Pi Kimi experiment. Two arms, eighteen fresh actors, no inference budget.
import {spawnSync} from 'node:child_process';
import {mkdirSync,cpSync,readFileSync,existsSync,readdirSync,statSync,appendFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {specs,save} from './pi-driver-round14.mjs';

const repo=resolve(process.cwd()),here=join(repo,'evaluations/public-rca');
const root=join(here,'runs/2026-10-18-kimi-scheduler-round14');
const baseline=join(here,'runs/2026-10-18-scheduler-contract-round13-final');
const mode=process.argv[2],load=p=>JSON.parse(readFileSync(p,'utf8'));
const sha=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const hashes=p=>Object.fromEntries(readdirSync(p).sort().flatMap(n=>statSync(join(p,n)).isDirectory()?Object.entries(hashes(join(p,n))).map(([k,v])=>[n+'/'+k,v]):[[n,sha(join(p,n))]]));
const configs=['/Users/shen/.pi/agent/models.json','/Users/shen/.pi/agent/settings.json'];
const controller=new AbortController();
if(mode==='--run')for(const event of ['SIGINT','SIGTERM'])process.on(event,()=>controller.abort(new Error('User cancelled with '+event)));
function assertFrozen(m){
 for(const [n,h]of Object.entries(m.frozenFiles))if(sha(join(root,n))!==h)throw new Error('Frozen evaluator changed: '+n);
 for(const [n,h]of Object.entries(m.implementation))if(sha(join(root,'implementation',n))!==h)throw new Error('Frozen implementation changed: '+n);
 for(const [n,h]of Object.entries(m.cases))if(sha(join(root,'cases',n))!==h)throw new Error('Frozen input changed: '+n);
}
if(mode==='--prepare'){
 if(existsSync(root))throw new Error('Never overwrite an experiment');
 const old=load(join(baseline,'manifest.json'));
 if(JSON.stringify(hashes(join(baseline,'implementation')))!==JSON.stringify(Object.fromEntries(Object.entries(old.implementation))))throw new Error('Round13 archive drift');
 for(const [n,h]of Object.entries(old.implementation))if(sha(join(repo,n))!==h)throw new Error('Current implementation differs from Round13: '+n);
 mkdirSync(root,{recursive:true});
 for(const n of ['new-01','new-02','new-03'])cpSync(join(baseline,'cases',n),join(root,'cases',n),{recursive:true});
 for(const n of ['src','dist','skills'])cpSync(join(repo,n),join(root,'implementation',n),{recursive:true});
 const copies=['run-round14.mjs','protocol-round14.zh-CN.md','pi-driver-round14.mjs','scheduler-driver-round14.mjs','integration-fixture-round14.mjs','codex-driver-round13.mjs','native-accounting-round13.mjs','session-usage.mjs',...['analyze','read-reports','diagnostics','context-audit','scope','progress'].map(n=>n+'-round14.py'),...['assess','check-components'].map(n=>n+'-round14.mjs')];
 for(const n of copies)cpSync(join(here,n),join(root,n));
 const inherited=['prompt.frozen.txt','reproduction-contract.frozen.md','case-manifest.json','grade.py','verify-artifacts.mjs','verify-reproduction.py','verify-submission.mjs'];
 for(const n of inherited)cpSync(join(baseline,n),join(root,n));
 const schedule=[];
 for(let repeat=1;repeat<=3;repeat++)for(let ci=0;ci<3;ci++){
  const name=['new-01','new-02','new-03'][(ci+repeat-1)%3];
  for(const arm of (ci+repeat)%2?['native','cairn']:['cairn','native'])schedule.push({id:`kimi-${name}-r${repeat}-${arm}`,model:'kimi',case:name,repeat,arm,kind:'rca'});
 }
 const lineage={root:baseline,manifestSHA256:sha(join(baseline,'manifest.json')),implementationByteIdentical:true,inputsAndCheckersByteIdentical:true,nativeCommonPromptIdentical:true,modelChanged:true,perModelConcurrencyChangedFrom:1,perModelConcurrencyChangedTo:2};
 const manifest={createdAt:new Date().toISOString(),runId:root.split('/').at(-1),models:specs,schedule,repeats:3,concurrency:2,perModelConcurrency:2,perArmConcurrency:1,rcaActors:18,genericActors:0,evaluationBudgets:null,common:old.common,cairnGuidance:null,scheduler:old.scheduler,implementation:hashes(join(root,'implementation')),cases:hashes(join(root,'cases')),frozenFiles:Object.fromEntries([...copies,...inherited].map(n=>[n,sha(join(root,n))])),globalConfigHashes:Object.fromEntries(configs.filter(existsSync).map(p=>[p,sha(p)])),node:process.version,piVersion:load('/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/package.json').version,gradingPolicy:'All18 actors end; all available public reports read/ACK/sealed before hidden grading; no selective reruns.',completionPolicy:old.completionPolicy,labelPolicy:old.labelPolicy,costPolicy:old.costPolicy,stabilityPolicy:old.stabilityPolicy,baselineLineage:lineage,integrationPolicy:'Three Pi scenarios with scripted native receipts; no paid model probe.'};
 save(join(root,'manifest.json'),manifest);console.log(JSON.stringify({event:'prepared',root,actors:schedule.length,models:specs,manifestSHA256:sha(join(root,'manifest.json'))}));
}else if(mode==='--fixture'){
 const m=load(join(root,'manifest.json'));assertFrozen(m);
 if(existsSync(join(root,'integration-fixture.json')))throw new Error('Never replace fixture');
 const {runIntegrationFixture}=await import(pathToFileURL(join(root,'integration-fixture-round14.mjs')).href);
 const receipt=await runIntegrationFixture({root,manifest:m});save(join(root,'integration-fixture.json'),receipt);console.log(JSON.stringify({event:'fixture',ok:receipt.ok,scenarios:receipt.results.length,paidModelCalls:receipt.paidModelCalls}));
}else if(mode==='--run'){
 const m=load(join(root,'manifest.json'));assertFrozen(m);const fixture=load(join(root,'integration-fixture.json'));
 if(!fixture.ok||fixture.paidModelCalls!==0)throw new Error('No-model fixture required');
 if(existsSync(join(root,'execution-started.json'))||m.schedule.some(r=>existsSync(join(root,r.id))))throw new Error('Never overwrite/restart formal actors');
 const {runScheduled}=await import(pathToFileURL(join(root,'scheduler-driver-round14.mjs')).href);
 const {runPi}=await import(pathToFileURL(join(root,'pi-driver-round14.mjs')).href);
 save(join(root,'execution-started.json'),{startedAt:new Date().toISOString(),pid:process.pid,manifestSha256:sha(join(root,'manifest.json')),integrationFixtureSHA256:sha(join(root,'integration-fixture.json')),actors:m.schedule.length,evaluationBudgets:null});
 let active=0,maxConcurrent=0;const outcomes=[],spec=m.models[0];
 await Promise.all(['native','cairn'].map(async arm=>{
  for(const row of m.schedule.filter(r=>r.arm===arm)){
   if(controller.signal.aborted)break;
   const dir=join(root,row.id),work=join(dir,'workspace');mkdirSync(dir);cpSync(join(root,'cases',row.case),work,{recursive:true});appendFileSync(join(work,'TASK.md'),'\n\n'+readFileSync(join(root,'reproduction-contract.frozen.md'),'utf8'));save(join(dir,'input-hashes.json'),hashes(work));
   const artifacts=['answer.json','REPORT.md','checks.json'],verifyCommand=[process.execPath,join(root,'verify-submission.mjs'),join(dir,'input-hashes.json')],prompt=readFileSync(join(root,'prompt.frozen.txt'),'utf8');
   active++;maxConcurrent=Math.max(maxConcurrent,active);console.log(JSON.stringify({event:'actor_start',...row,at:new Date().toISOString(),active}));
   try{
    const metrics=arm==='cairn'?await runScheduled({spec,work,dir,implementation:join(root,'implementation'),prompt,common:m.common,verifyCommand,artifacts,signal:controller.signal}):await runPi({spec,work,dir,prompt,common:m.common,signal:controller.signal});
    for(const n of [...artifacts,'EXPLORATION.md'])if(existsSync(join(work,n)))cpSync(join(work,n),join(dir,'initial.'+n));
    const replay=spawnSync(verifyCommand[0],verifyCommand.slice(1),{input:JSON.stringify({owner:{cwd:work}}),encoding:'utf8',timeout:15000});
    let acceptance;try{acceptance=JSON.parse(replay.stdout);}catch{acceptance={ok:false,issues:[{message:replay.error?.message??'No valid checker JSON'}],infrastructureUnavailable:true};}save(join(dir,'initial.acceptance.json'),acceptance);
    save(join(dir,'actor-finished.json'),{...row,finishedAt:new Date().toISOString(),hiddenGradesDeferred:true});outcomes.push({id:row.id,ended:true});
    console.log(JSON.stringify({event:'actor_complete',...row,wallSeconds:metrics.wallSeconds,usage:metrics.usage,exitCode:metrics.exitCode,finalStopReason:metrics.finalStopReason,turnFailed:metrics.turnFailed,schedulerStatus:metrics.schedulerStatus,phaseCount:metrics.phaseCount,accepted:acceptance.ok}));
   }catch(error){save(join(dir,'infrastructure-failure.json'),{error:error.message,at:new Date().toISOString()});outcomes.push({id:row.id,infrastructureFailure:error.message});console.log(JSON.stringify({event:'infrastructure_failure',id:row.id,error:error.message}));break;}
   finally{active--;}
  }
 }));
 save(join(root,'execution-ended.json'),{endedAt:new Date().toISOString(),allActorsEnded:outcomes.length===m.schedule.length&&outcomes.every(v=>v.ended),maxConcurrent,outcomes,cancelled:controller.signal.aborted,hiddenGradesDeferred:true});if(controller.signal.aborted)process.exitCode=130;console.log(JSON.stringify({event:'all_lanes_ended',actors:outcomes.length,maxConcurrent}));
}else throw new Error('Use --prepare, --fixture or --run; no paid probe mode');
