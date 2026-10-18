import {spawnSync} from 'node:child_process';
import {mkdirSync,cpSync,readFileSync,writeFileSync,existsSync,readdirSync,statSync,appendFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {specs,save} from './pi-driver-round15.mjs';
const repo=resolve(process.cwd()),here=join(repo,'evaluations/public-rca'),root=join(here,'runs/2026-10-18-deepseek-original-context-round15'),baseline=join(here,'runs/2026-10-18-kimi-scheduler-round14');
const mode=process.argv[2],load=p=>JSON.parse(readFileSync(p,'utf8')),sha=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const hashes=p=>Object.fromEntries(readdirSync(p).sort().filter(n=>!['__pycache__','.DS_Store'].includes(n)).flatMap(n=>statSync(join(p,n)).isDirectory()?Object.entries(hashes(join(p,n))).map(([k,v])=>[n+'/'+k,v]):[[n,sha(join(p,n))]]));
const controller=new AbortController(),arms=['native','original','cairn-fresh','cairn-reuse'];
if(mode==='--run')for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>controller.abort(new Error('User cancelled '+signal)));
function frozen(m){
 for(const [name,h] of Object.entries(m.frozenFiles))if(sha(join(root,name))!==h)throw new Error('Frozen evaluator changed: '+name);
 for(const [prefix,key] of [['implementation','implementation'],['original','original'],['cases','cases']])for(const [name,h] of Object.entries(m[key]))if(sha(join(root,prefix,name))!==h)throw new Error('Frozen '+prefix+' changed: '+name);
}
if(mode==='--prepare'){
 if(existsSync(root))throw new Error('Never overwrite an experiment');
 mkdirSync(root,{recursive:true});const old=load(join(baseline,'manifest.json'));
 for(const name of ['new-01','new-02','new-03'])cpSync(join(baseline,'cases',name),join(root,'cases',name),{recursive:true});
 for(const name of ['src','dist','skills'])cpSync(join(repo,name),join(root,'implementation',name),{recursive:true});
 const original='/Users/shen/Documents/Code/Cairn-main';
 cpSync(join(original,'cairn/src'),join(root,'original/cairn/src'),{recursive:true,filter:source=>!source.includes('__pycache__')&&!source.endsWith('.DS_Store')});
 cpSync(join(original,'cairn/pyproject.toml'),join(root,'original/cairn/pyproject.toml'));
 cpSync(join(original,'dispatch.local.example.yaml'),join(root,'original/dispatch.local.example.yaml'));
 const copies=['run-round15.mjs','protocol-round15.zh-CN.md','pi-driver-round15.mjs','scheduler-driver-round15.mjs','integration-fixture-round15.mjs','original-driver-round15.mjs','original-driver-round15.py','original-pi-bridge-round15.mjs','analyze-round15.py','read-reports-round15.py','scope-round15.py','assess-round15.mjs','check-components-round15.mjs','codex-driver-round13.mjs','native-accounting-round13.mjs','session-usage.mjs'];
 for(const name of copies)cpSync(join(here,name),join(root,name));
 const inherited=['prompt.frozen.txt','reproduction-contract.frozen.md','case-manifest.json','grade.py','verify-artifacts.mjs','verify-reproduction.py','verify-submission.mjs'];
 for(const name of inherited)cpSync(join(baseline,name),join(root,name));
 const schedule=[];
 for(let repeat=1;repeat<=3;repeat++)for(let ci=0;ci<3;ci++)for(let ai=0;ai<4;ai++){
  const name=['new-01','new-02','new-03'][(ci+repeat-1)%3],arm=arms[(ai+repeat+ci)%4];
  schedule.push({id:`deepseek-${name}-r${repeat}-${arm}`,model:'deepseek',case:name,repeat,arm,kind:'rca',coordinatorMode:arm==='cairn-fresh'?'fresh-full':arm==='cairn-reuse'?'reuse-delta':null});
 }
 const configPaths=['/Users/shen/.pi/agent/models.json','/Users/shen/.pi/agent/settings.json'];
 const dependencies=spawnSync('/opt/homebrew/bin/uv',['pip','freeze','--python','/private/tmp/cairn-round15-python/bin/python'],{encoding:'utf8',env:{...process.env,UV_CACHE_DIR:'/private/tmp/cairn-round15-uv-cache'}});if(dependencies.status!==0)throw new Error(dependencies.stderr);save(join(root,'python-dependencies.txt'),dependencies.stdout);
 const manifest={createdAt:new Date().toISOString(),runId:root.split('/').at(-1),models:specs,arms,schedule,repeats:3,concurrency:4,perModelConcurrency:4,perArmConcurrency:1,rcaActors:36,genericActors:0,evaluationBudgets:null,common:old.common,scheduler:{maxParallel:1},implementation:hashes(join(root,'implementation')),original:hashes(join(root,'original')),cases:hashes(join(root,'cases')),frozenFiles:Object.fromEntries([...copies,...inherited,'python-dependencies.txt'].map(name=>[name,sha(join(root,name))])),globalConfigHashes:Object.fromEntries(configPaths.map(p=>[p,sha(p)])),node:process.version,piVersion:load('/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/package.json').version,baselineLineage:{root:baseline,manifestSHA256:sha(join(baseline,'manifest.json')),nativePromptAndInputsIdentical:true},completionPolicy:'Natural stop + 3 nonempty files + valid answer; original additionally project completed; new additionally current task completed/acceptance. Uniform acceptance and effective delivery reported separately.',labelPolicy:old.labelPolicy,costPolicy:old.costPolicy,gradingPolicy:'All36 end, every available public report read/ACK/sealed, then hidden labels; no selective reruns',originalAdaptation:'Actual server/dispatcher/contracts/prompts with private TestClient/process bridge and deadlines disabled; source untouched',integrationPolicy:'Six new context-mode fixtures and two actual Python runtime fixtures; zero paid probes'};
 save(join(root,'manifest.json'),manifest);console.log(JSON.stringify({event:'prepared',root,actors:36,manifestSHA256:sha(join(root,'manifest.json'))}));
}else if(mode==='--fixture'){
 const m=load(join(root,'manifest.json'));frozen(m);if(existsSync(join(root,'integration-fixture.json')))throw new Error('Never replace fixture');
 const {runIntegrationFixture}=await import(pathToFileURL(join(root,'integration-fixture-round15.mjs')).href);
 const modern=await runIntegrationFixture({root,manifest:m});
 const {runOriginal}=await import(pathToFileURL(join(root,'original-driver-round15.mjs')).href),original=[];
 for(const scenario of ['direct','loop']){
  const dir=join(root,'integration-fixtures','original-'+scenario),work=join(dir,'workspace');mkdirSync(work,{recursive:true});save(join(work,'marker.txt'),'alpha\n');
  const metrics=await runOriginal({root,spec:m.models[0],work,dir,prompt:'Read marker.txt and confirm its documented value.',common:'No-model native transport fixture.',fixture:true,scenario});
  if(metrics.originalStatus!=='completed'||metrics.exitCode!==0)throw new Error('Original fixture failed '+JSON.stringify(metrics));
  if(scenario==='loop'&&JSON.stringify(metrics.phases.map(p=>p.phase))!==JSON.stringify(['bootstrap','conclude','reason','explore','reason']))throw new Error('Original loop not exercised');
  original.push({scenario,completed:true,phases:metrics.phases.map(p=>p.phase),paidModelCalls:0});
 }
 save(join(root,'integration-fixture.json'),{ok:modern.ok&&original.every(r=>r.completed),modern,original,paidModelCalls:0});console.log(JSON.stringify({event:'fixture',modern:modern.results.length,original:original.length,paidModelCalls:0}));
}else if(mode==='--run'){
 const m=load(join(root,'manifest.json'));frozen(m);if(!load(join(root,'integration-fixture.json')).ok)throw new Error('Fixture required');
 if(existsSync(join(root,'execution-started.json'))||m.schedule.some(r=>existsSync(join(root,r.id))))throw new Error('Never restart formal actors');
 const {runPi}=await import(pathToFileURL(join(root,'pi-driver-round15.mjs')).href),{runScheduled}=await import(pathToFileURL(join(root,'scheduler-driver-round15.mjs')).href),{runOriginal}=await import(pathToFileURL(join(root,'original-driver-round15.mjs')).href);
 save(join(root,'execution-started.json'),{startedAt:new Date().toISOString(),pid:process.pid,manifestSha256:sha(join(root,'manifest.json')),integrationFixtureSHA256:sha(join(root,'integration-fixture.json')),actors:36,evaluationBudgets:null});
 const outcomes=[];let active=0,maxConcurrent=0;
 await Promise.all(arms.map(async arm=>{
  for(const row of m.schedule.filter(r=>r.arm===arm)){
   if(controller.signal.aborted)break;
   const dir=join(root,row.id),work=join(dir,'workspace');mkdirSync(dir);cpSync(join(root,'cases',row.case),work,{recursive:true});appendFileSync(join(work,'TASK.md'),'\n\n'+readFileSync(join(root,'reproduction-contract.frozen.md'),'utf8'));save(join(dir,'input-hashes.json'),hashes(work));
   const artifacts=['answer.json','REPORT.md','checks.json'],verifyCommand=[process.execPath,join(root,'verify-submission.mjs'),join(dir,'input-hashes.json')],prompt=readFileSync(join(root,'prompt.frozen.txt'),'utf8'),args={root,spec:m.models[0],work,dir,prompt,common:m.common,verifyCommand,artifacts,signal:controller.signal};
   active++;maxConcurrent=Math.max(maxConcurrent,active);console.log(JSON.stringify({event:'actor_start',...row,at:new Date().toISOString(),active}));
   try{
    const metrics=arm==='native'?await runPi(args):arm==='original'?await runOriginal(args):await runScheduled({...args,implementation:join(root,'implementation'),coordinatorMode:row.coordinatorMode});
    for(const name of [...artifacts,'EXPLORATION.md'])if(existsSync(join(work,name)))cpSync(join(work,name),join(dir,'initial.'+name));
    const replay=spawnSync(verifyCommand[0],verifyCommand.slice(1),{input:JSON.stringify({owner:{cwd:work}}),encoding:'utf8',timeout:15000});
    let acceptance;try{acceptance=JSON.parse(replay.stdout);}catch{acceptance={ok:false,issues:[{message:replay.error?.message??'No valid checker JSON'}],infrastructureUnavailable:true};}save(join(dir,'initial.acceptance.json'),acceptance);
    save(join(dir,'actor-finished.json'),{...row,finishedAt:new Date().toISOString(),hiddenGradesDeferred:true});outcomes.push({id:row.id,ended:true});
    console.log(JSON.stringify({event:'actor_complete',...row,wallSeconds:metrics.wallSeconds,usage:metrics.usage,exitCode:metrics.exitCode,finalStopReason:metrics.finalStopReason,turnFailed:metrics.turnFailed,originalStatus:metrics.originalStatus,schedulerStatus:metrics.schedulerStatus,phaseCount:metrics.phaseCount,accepted:acceptance.ok}));
   }catch(error){save(join(dir,'infrastructure-failure.json'),{error:error.message,at:new Date().toISOString()});outcomes.push({id:row.id,infrastructureFailure:error.message});console.log(JSON.stringify({event:'infrastructure_failure',id:row.id,error:error.message}));break;}
   finally{active--;}
  }
 }));
 save(join(root,'execution-ended.json'),{endedAt:new Date().toISOString(),allActorsEnded:outcomes.length===36&&outcomes.every(r=>r.ended),maxConcurrent,outcomes,cancelled:controller.signal.aborted,hiddenGradesDeferred:true});console.log(JSON.stringify({event:'all_lanes_ended',actors:outcomes.length,maxConcurrent}));if(controller.signal.aborted)process.exitCode=130;
}else throw new Error('Use --prepare / --fixture / --run; no paid probes');
