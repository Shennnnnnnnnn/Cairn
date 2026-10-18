// Host-only global barrier. No label grading until all model lanes have ended.
import {spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync,existsSync,mkdirSync,mkdtempSync,chmodSync,cpSync,rmSync} from 'node:fs';
import {join,dirname,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const here=dirname(fileURLToPath(import.meta.url));
const root=join(here,'runs',process.argv[2]);
const load=p=>JSON.parse(readFileSync(p,'utf8'));
const save=(p,v)=>writeFileSync(p,JSON.stringify(v,null,2)+'\n');
const sha=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const m=load(join(root,'manifest.json')),a=load(join(root,'parallel-amendment.json'));
if(existsSync(join(root,'finished.json')))throw new Error('Already finalized');
if(!existsSync(join(root,'original-runner-drained.json')))throw new Error('Wait for the original runner to drain after Step');
const drained=load(join(root,'original-runner-drained.json'));
if(!drained.expectedHostDrain||drained.actorInterrupted)throw new Error('Unexpected original runner termination');
const provenance=[];
for(const [slug,id] of Object.entries(a.laneRunIds)){
 const lane=join(here,'runs',id),lm=load(join(lane,'manifest.json'));
 if(!existsSync(join(lane,'actors-finished.json')))throw new Error('Lane is still running: '+slug);
 if(existsSync(join(lane,'finished.json')))throw new Error('A lane must not independently grade');
 if(lm.order.length!==3||lm.order.some(([s])=>s!==slug)||lm.modelLane!==slug)throw new Error('Unexpected lane order');
 for(const key of ['models','cases','archiveHashesByArm','registeredModelLimits','budgetPolicy','artifactRequirements'])
  if(JSON.stringify(lm[key])!==JSON.stringify(m[key]))throw new Error('Lane registration/input drift: '+key);
 for(const key of ['promptHash','reproductionContractHash','verifierHash','numericVerifierHash','compositionVerifierHash','graderHash','commonSystemPromptHash','cairnGuidanceHash','preflightProbeHash'])
  if(lm[key]!==m[key])throw new Error('Lane protocol drift: '+key);
 if(sha(join(lane,'runner.frozen.mjs'))!==lm.runnerHash)throw new Error('Frozen lane runner drift');
 if(sha(join(lane,'protocol.before.md'))!==lm.protocolHash)throw new Error('Frozen lane protocol drift');
 for(const [mode,files] of Object.entries(lm.archiveHashesByArm)){
  const archive=join(lane,mode==='pi-cairn-previous'?lm.previousImplementationArchive:lm.implementationArchive);
  for(const [name,expected] of Object.entries(files))if(sha(join(archive,name))!==expected)throw new Error('Lane implementation drift: '+slug+'/'+name);
 }
 const source=readFileSync(join(lane,'runner.frozen.mjs'),'utf8');
 if(source.includes('setTimeout')||!source.includes("args['defer-grading']==='yes'"))throw new Error('Unexpected lane control');
 provenance.push({modelSlug:slug,root:lane,manifestSha256:sha(join(lane,'manifest.json')),runnerSha256:lm.runnerHash,protocolSha256:sha(join(lane,'protocol.before.md'))});
}
const rows=m.order.map(([slug,c,mode])=>{
 const key=[slug,c,mode].join('/'),dir=resolve(m.episodeLocations[key]);
 if(!existsSync(join(dir,'episode.metrics.json')))throw new Error('Actor is not harvested: '+key);
 if(existsSync(join(dir,'initial.grade.json')))throw new Error('Unexpected early grade: '+key);
 const metric=load(join(dir,'initial.metrics.json'));
 if(metric.timedOut||metric.budgetExceeded)throw new Error('Unexpected evaluator interruption: '+key);
 return {key,slug,case:c,mode,dir,metric};
});
if(rows.length!==12||new Set(rows.map(r=>r.metric.sessionId)).size!==12)throw new Error('Expected twelve fresh actors');
const qualitative=load(join(root,'qualitative-audit.json'));
if(qualitative.results?.length!==12)throw new Error('Review all twelve final public reports before grading');
for(const r of rows){
 const review=qualitative.results.find(v=>v.modelSlug===r.slug&&v.mode===r.mode);
 const report=join(r.dir,'initial.REPORT.md');
 if(!review||(existsSync(report)?!review.readFinalReport||review.reportSha256!==sha(report):!review.missingReportConfirmed))throw new Error('Missing final report review: '+r.key);
}
const latestEnd=rows.map(r=>r.metric.finishedAt).sort().at(-1);
const events=rows.flatMap(r=>[{at:r.metric.startedAt,delta:1},{at:r.metric.finishedAt,delta:-1}]).sort((x,y)=>x.at.localeCompare(y.at)||x.delta-y.delta);
let concurrent=0,maxConcurrent=0;
for(const e of events){concurrent+=e.delta;maxConcurrent=Math.max(maxConcurrent,concurrent);}
if(concurrent||maxConcurrent>3)throw new Error('Unexpected concurrency');
const record={allActorsEndedAt:latestEnd,gradingStartedAt:new Date().toISOString(),allActorsEndedBeforeGrading:true,allPublicReportReviewsBeforeGrading:true,qualitativeAuditSha256:sha(join(root,'qualitative-audit.json')),maxConcurrentActors:maxConcurrent,laneProvenance:provenance,amendmentSha256:sha(join(root,'parallel-amendment.json')),snapshots:rows.map(r=>({key:r.key,dir:r.dir,finishedAt:r.metric.finishedAt,artifacts:Object.fromEntries(m.artifactRequirements.filter(f=>existsSync(join(r.dir,'initial.'+f))).map(f=>[f,sha(join(r.dir,'initial.'+f))]))}))};
save(join(root,'combined-finalization.json'),record);
const scratch=mkdtempSync(join(tmpdir(),'cairn-matrix-global-grading-'));chmodSync(scratch,0o700);
try{
 for(const r of rows){
  const work=join(scratch,r.slug+'-'+r.mode);
  // cpSync creates the destination and retains frozen answer/report bytes only.
  mkdirSync(work);
  for(const f of ['answer.json','REPORT.md'])if(existsSync(join(r.dir,'initial.'+f)))cpSync(join(r.dir,'initial.'+f),join(work,f));
  const g=spawnSync('python3',[join(here,'grade.py'),r.case,work],{encoding:'utf8',timeout:15000});
  if(g.status!==0)throw new Error('Host grading failed: '+r.key+' '+g.stderr);
  const grade=JSON.parse(g.stdout);save(join(r.dir,'initial.grade.json'),grade);
 }
 save(join(root,'finished.json'),{finishedAt:new Date().toISOString(),allActorsEndedBeforeGrading:true,allActorsEndedAt:latestEnd,maximumConcurrentActors:maxConcurrent,combinedFinalization:'combined-finalization.json'});
 console.log(JSON.stringify({event:'global_matrix_complete',root,actors:rows.length,maxConcurrentActors:maxConcurrent}));
}finally{rmSync(scratch,{recursive:true,force:true});}
