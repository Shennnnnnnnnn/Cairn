// Three fixed model lanes, 54 fresh attempts. No evaluator inference budget.
import {spawnSync} from 'node:child_process';
import {mkdirSync,cpSync,readFileSync,existsSync,readdirSync,statSync,appendFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {specs as piSpecs,save} from './pi-driver-round13.mjs';

const repo=resolve(process.cwd()),here=join(repo,'evaluations/public-rca');
const root=join(here,'runs/2026-10-18-scheduler-contract-round13-final');
const original=join(here,'runs/2026-10-18-scheduler-three-model-round12-final');
const previous=join(here,'runs/2026-10-18-scheduler-pi-recovery-round12');
const historicalProbes=join(here,'runs/2026-10-18-scheduler-three-model-round12');
const initialFixtureSnapshot=join(here,'runs/2026-10-18-scheduler-contract-round13');
const mode=process.argv[2],load=path=>JSON.parse(readFileSync(path,'utf8'));
const sha=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
const hashes=path=>Object.fromEntries(readdirSync(path).sort().flatMap(name=>statSync(join(path,name)).isDirectory()?Object.entries(hashes(join(path,name))).map(([key,value])=>[name+'/'+key,value]):[[name,sha(join(path,name))]]));
const models=[...piSpecs,{slug:'sol',host:'codex',id:'gpt-6.1-sol',thinking:'xhigh'}].map((spec,index)=>({...spec,scheduleIndex:index}));
const controller=new AbortController();
if(mode==='--run')for(const event of ['SIGINT','SIGTERM'])process.on(event,()=>controller.abort(new Error('User cancelled runner with '+event)));
const readOnlyConfigs=['/Users/shen/.pi/agent/models.json','/Users/shen/.pi/agent/settings.json','/Users/shen/.codex/config.toml'];
function assertFrozen(manifest){
 for(const [name,hash]of Object.entries(manifest.frozenFiles))if(sha(join(root,name))!==hash)throw new Error('Frozen evaluation file changed: '+name);
 for(const [name,hash]of Object.entries(manifest.implementation))if(sha(join(root,'implementation',name))!==hash)throw new Error('Frozen implementation changed: '+name);
 for(const [name,hash]of Object.entries(manifest.cases))if(sha(join(root,'cases',name))!==hash)throw new Error('Frozen input changed: '+name);
}

if(mode==='--prepare'){
 if(existsSync(root))throw new Error('Never overwrite an experiment');
 const baseline=load(join(previous,'summary.main54.json')),old=load(join(original,'manifest.json'));
 if(baseline.rows.length!==54)throw new Error('Round12 combined main54 baseline unavailable');
 if(old.common!==load(join(previous,'manifest.json')).common)throw new Error('Baseline common prompts differ');
 mkdirSync(root,{recursive:true});
 for(const name of ['new-01','new-02','new-03'])cpSync(join(original,'cases',name),join(root,'cases',name),{recursive:true});
 for(const name of ['src','dist','skills'])cpSync(join(repo,name),join(root,'implementation',name),{recursive:true});
 const copies=['pi-driver-round13.mjs','codex-driver-round13.mjs','native-accounting-round13.mjs','scheduler-driver-round13.mjs','run-round13.mjs','session-usage.mjs','protocol-round13.zh-CN.md','integration-fixture-round13.mjs','analyze-round13.py','assess-round13.mjs','read-reports-round13.py','check-components-round13.mjs','diagnostics-round13.py','scope-round13.py','progress-round13.py','context-audit-round13.py','write-report-round13.py'];
 for(const name of copies)cpSync(join(here,name),join(root,name));
 const inherited=['prompt.frozen.txt','reproduction-contract.frozen.md','case-manifest.json','grade.py','verify-artifacts.mjs','verify-reproduction.py','verify-submission.mjs'];
 for(const name of inherited)cpSync(join(original,name),join(root,name));
 const initial=load(join(initialFixtureSnapshot,'manifest.json'));
 if(JSON.stringify(hashes(join(root,'implementation')))!==JSON.stringify(initial.implementation))throw new Error('Core/src/dist/skills differ from the retained initial fixture snapshot');
 for(const name of inherited)if(sha(join(root,name))!==sha(join(initialFixtureSnapshot,name)))throw new Error('Control input/prompt/checker differs from initial snapshot: '+name);
 for(const host of ['pi','codex'])if(sha(join(root,`${host}-driver-round13.mjs`))!==sha(join(initialFixtureSnapshot,`${host}-driver-round13.mjs`)))throw new Error('Native driver changed after initial fixture failure');
 const fixtureOrigin={initialRoot:initialFixtureSnapshot,manifestSHA256:sha(join(initialFixtureSnapshot,'manifest.json')),failureSHA256:sha(join(initialFixtureSnapshot,'fixture-failure.json')),logSHA256:sha(join(initialFixtureSnapshot,'fixture-failure.log')),paidModelCalls:0,reason:'Only synthetic fixture expectation corrected: the first Reason reuses the closed Bootstrap coordinator. Initial snapshot and partial fixture receipts retained; model execution/core/control prompts/checkers unchanged.',implementationByteIdentical:true,nativeDriversByteIdentical:true,controlInputsByteIdentical:true};
 save(join(root,'fixture-origin.json'),fixtureOrigin);copies.push('fixture-origin.json');
 const schedule=[];
 for(const spec of models)for(let repeat=1;repeat<=3;repeat++)for(let ci=0;ci<3;ci++){
  const mi=spec.scheduleIndex,name=['new-01','new-02','new-03'][(ci+repeat+mi-1)%3];
  for(const arm of (ci+repeat+mi)%2?['native','cairn']:['cairn','native'])schedule.push({id:`${spec.slug}-${name}-r${repeat}-${arm}`,model:spec.slug,case:name,repeat,arm,kind:'rca'});
 }
 if(JSON.stringify(schedule)!==JSON.stringify(old.schedule))throw new Error('Round12 model-index order changed');
 const driverLineage=Object.fromEntries(['pi','codex'].map(host=>{
  const from=join(original,`${host}-driver-round12.mjs`),to=join(root,`${host}-driver-round13.mjs`);
  let expected=readFileSync(from,'utf8').replaceAll('round12','round13');
  if(host==='pi')expected=expected
   .replace('resume,onSession,signal}){','resume,onSession,signal,noTools=false}){')
   .replace("  args.push('--tools',implementation?'read,bash,edit,write,cairn_*':'read,bash,edit,write','-p',prompt);","  args.push('--tools',implementation?'read,bash,edit,write,cairn_*':'read,bash,edit,write','-p',prompt);\n  if(noTools)args.splice(args.length-2,0,'--no-tools','--exclude-tools','*'); // Round13 repair only; native/default argv unchanged.")
   .replace('evaluationBudgets:null,registeredModelLimits',"evaluationBudgets:null,noToolsRequested:noTools,noToolsPolicy:noTools?'Pi --no-tools + --exclude-tools *; repair-only output':null,registeredModelLimits");
  else expected=expected
   .replace("import {publishEvaluationUsage} from './session-usage.mjs';","import {publishEvaluationUsage} from './session-usage.mjs';\nimport {resolveCodexUsage,createCodexRepairActionAudit} from './native-accounting-round13.mjs';")
   .replace('resume,onSession,signal}){','resume,onSession,signal,outputOnlyRepair=false}){')
   .replace("  if(resume&&nativeMetadata.tokenUsage){const cumulative=nativeMetadata.tokenUsage;usage=Object.fromEntries(Object.entries(cumulative).map(([key,value])=>[key,value-(baselineUsage?.[key]??0)]));if(Object.values(usage).some(value=>value<0))throw new Error('Native resumed usage moved backwards');}","  const accounting=resolveCodexUsage({streamUsage:usage,cumulative:nativeMetadata.tokenUsage,baseline:baselineUsage,resumed:!!resume});usage=accounting.usage;")
   .replace('  const counts={},tools=[],errors=[],clientNotices=[];','  const counts={},tools=[],errors=[],clientNotices=[];const repairActions=createCodexRepairActionAudit();')
   .replace('   let event;try{event=JSON.parse(line);}catch{return;}','   let event;try{event=JSON.parse(line);}catch{return;}\n   if(outputOnlyRepair)repairActions.observe(event);')
   .replace("  save(join(dir,'native-session-metadata.json'),nativeMetadata);","  save(join(dir,'native-session-metadata.json'),nativeMetadata);\n  const repairActionAudit=repairActions.snapshot();")
   .replace('usageIsLowerBound:errors.length>0||!usage||turnFailed||result.exitCode!==0,','usageIsLowerBound:!!accounting.diagnostic||errors.length>0||!usage||turnFailed||result.exitCode!==0,accountingDiagnostic:accounting.diagnostic,')
   .replace('evaluationBudgets:null,nativeResume','evaluationBudgets:null,outputOnlyRepair,nativeResume')
   .replace('toolCalls:tools.length,toolErrors:','toolCalls:outputOnlyRepair?repairActionAudit.observedNativeActions:tools.length,repairActionAudit:outputOnlyRepair?repairActionAudit:null,toolErrors:');
  if(expected!==readFileSync(to,'utf8'))throw new Error('Unreviewed native driver delta: '+host);
  return [host,{from,sha256:sha(from),round13SHA256:sha(to),changes:'round13 archive naming; repair-only no-tools/zero-action audit; inconsistent resumed usage retained as unknown diagnostic instead of throwing; native/default argv and prompts unchanged',normalNativeArgvUnchanged:true}];
 }));
 const lineage={baselineRoot:previous,baselineSummary:join(previous,'summary.main54.json'),baselineSummarySHA256:sha(join(previous,'summary.main54.json')),baselineSources:{deepseek:previous,glm:previous,sol:original},composition:'restoredPi Deep18+GLM18 and original Sol18; original mixed-window GLM is historical only',inputSource:original,originalManifestSHA256:sha(join(original,'manifest.json')),commonIdentical:true,scheduleIdentical:true,nativeDrivers:driverLineage,inheritedCheckersIdentical:true,historicalProbeOnly:{root:historicalProbes,manifestSHA256:sha(join(historicalProbes,'manifest.json')),probesSHA256:sha(join(historicalProbes,'probes.json')),newInference:false,currentIntegrationValidation:false}};
 save(join(root,'baseline-lineage.json'),lineage);copies.push('baseline-lineage.json');
 const manifest={createdAt:new Date().toISOString(),runId:root.split('/').at(-1),models,schedule,repeats:3,concurrency:3,perModelConcurrency:1,rcaActors:54,genericActors:0,evaluationBudgets:null,common:old.common,cairnGuidance:null,scheduler:{enabled:true,maxParallel:1,phaseModel:'same model and effort as paired native arm',owner:'trusted mcp scheduler; native session identities separately recorded',nativeToolsOnly:true},implementation:hashes(join(root,'implementation')),cases:hashes(join(root,'cases')),frozenFiles:Object.fromEntries([...copies,...inherited].map(name=>[name,sha(join(root,name))])),globalConfigHashes:Object.fromEntries(readOnlyConfigs.filter(existsSync).map(path=>[path,sha(path)])),node:process.version,piVersion:load('/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/package.json').version,codexVersion:spawnSync('/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex',['--version'],{encoding:'utf8'}).stdout.trim(),gradingPolicy:'All54 actors end, all available public REPORT parts read and acknowledged/missing confirmed, then seal before any hidden scoring; no selective reruns.',completionPolicy:old.completionPolicy,labelPolicy:old.labelPolicy,costPolicy:'All native phase usage including errors/repairs; native cumulative ledgers deduplicated and independently reconciled. Unknown errors retain lower bounds. Billing unknown.',stabilityPolicy:old.stabilityPolicy,previousRun:previous,previousSummaryFile:'summary.main54.json',baselineLineage:lineage,integrationPolicy:'Only scripted native fixture through current frozen runScheduled pipeline; no paid probe. Original probes are historical only.'};
 save(join(root,'manifest.json'),manifest);console.log(JSON.stringify({event:'prepared',root,actors:schedule.length,models,baselineSummarySHA256:lineage.baselineSummarySHA256}));
}else if(mode==='--fixture'){
 const manifest=load(join(root,'manifest.json'));assertFrozen(manifest);
 if(existsSync(join(root,'integration-fixture.json')))throw new Error('Do not replace integration fixture receipts');
 const {runIntegrationFixture}=await import(pathToFileURL(join(root,'integration-fixture-round13.mjs')).href);
 const receipt=await runIntegrationFixture({root,manifest});save(join(root,'integration-fixture.json'),receipt);
 console.log(JSON.stringify({event:'integration_fixture',ok:receipt.ok,paidModelCalls:receipt.paidModelCalls}));
}else if(mode==='--run'){
 const manifest=load(join(root,'manifest.json'));assertFrozen(manifest);const fixture=load(join(root,'integration-fixture.json'));
 if(!fixture.ok||fixture.paidModelCalls!==0)throw new Error('Current frozen no-model integration fixture must pass');
 if(existsSync(join(root,'execution-started.json'))||manifest.schedule.some(row=>existsSync(join(root,row.id))))throw new Error('Never overwrite or restart formal actors');
 const {runScheduled}=await import(pathToFileURL(join(root,'scheduler-driver-round13.mjs')).href);
 save(join(root,'execution-started.json'),{startedAt:new Date().toISOString(),pid:process.pid,manifestSha256:sha(join(root,'manifest.json')),integrationFixtureSHA256:sha(join(root,'integration-fixture.json')),actors:manifest.schedule.length,evaluationBudgets:null});
 let active=0,maxConcurrent=0;const outcomes=[];
 await Promise.all(manifest.models.map(async spec=>{
  const driver=await import(pathToFileURL(join(root,spec.host==='pi'?'pi-driver-round13.mjs':'codex-driver-round13.mjs')).href);
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
}else throw new Error('Use --prepare, --fixture or --run; no paid probe mode');
