// Host-only barrier: freeze public-report reviews before any hidden-label grade.
import {spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync,existsSync,mkdtempSync,mkdirSync,cpSync,rmSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const here=dirname(fileURLToPath(import.meta.url)),root=join(here,'runs/2026-10-17-codex-sol-xhigh-round7b');
const load=p=>JSON.parse(readFileSync(p,'utf8')),sha=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const save=(p,v)=>writeFileSync(p,JSON.stringify(v,null,2)+'\n');
const manifest=load(join(root,'manifest.json')),reviews=load(join(root,'qualitative-audit.json'));
const {assertCairnProtocol}=await import(new URL('./driver.frozen.mjs','file://'+root+'/'));
const prior=load(join(here,'runs',manifest.baselineRun,'manifest.json'));
if(existsSync(join(root,'finished.json')))throw new Error('Already finalized');
if(sha(join(root,'case-manifest.json'))!==prior.sourceManifestHash||sha(join(root,'identifier-policy.json'))!==prior.identifierPolicyHash)throw new Error('Reference labels/policy differ from the sealed earlier run');
if(!manifest.implementations.after||!manifest.driverAfterHash)throw new Error('Freeze and run the optimized arm first');
if(!manifest.correctedProbeSha256||sha(join(root,'corrected-probe.json'))!==manifest.correctedProbeSha256||!load(join(root,'corrected-probe.json')).success)throw new Error('Successful corrected integration probe is not sealed');
for(const excluded of manifest.invalidatedDevelopmentRuns??[])if(sha(join(here,'runs',excluded.runId,'invalidated.json'))!==excluded.recordSha256)throw new Error('Excluded development cost/protocol record changed');
for(const [name,expected] of Object.entries(manifest.verifiers))if(sha(join(root,name))!==expected)throw new Error('Frozen verifier changed: '+name);
for(const [version,files] of Object.entries(manifest.implementations)){
 const archive=join(root,version==='previous'?'implementation-previous':version==='before'?'implementation':'implementation-after');
 for(const [name,expected] of Object.entries(files))if(sha(join(archive,name))!==expected)throw new Error('Frozen implementation changed: '+version+'/'+name);
}
const rows=manifest.arms.map(arm=>{
 const dir=join(root,arm);if(!existsSync(join(dir,'actor-finished.json')))throw new Error('Actor is still running: '+arm);
 if(existsSync(join(dir,'initial.grade.json')))throw new Error('Unexpected early grading: '+arm);
 const metrics=load(join(dir,'initial.metrics.json')),report=join(dir,'initial.REPORT.md');
 if(Date.parse(metrics.startedAt)<Date.parse(manifest.afterPreparedAt))throw new Error('An actor started before every implementation was frozen: '+arm);
 if(arm!=='codex'){
  const work=join(dir,'workspace'),launch=load(join(dir,'launch.json')),verifyCommand=[launch.options['mcp_servers.cairn'].command,join(root,'verify-submission.mjs'),join(dir,'input-hashes.json')];
  const protocol=assertCairnProtocol({work,metrics,verifyCommand,artifacts:['answer.json','REPORT.md','checks.json'],launch,tools:load(join(dir,'initial.tools.json')),strict:false});
  if(!load(join(dir,'initial.cairn-protocol.json')).valid||JSON.stringify(load(join(dir,'initial.cairn-tasks.json')))!==JSON.stringify(protocol.tasks))throw new Error('Private Cairn task snapshot/protocol differs: '+arm);
 }
 const review=reviews.results?.find(v=>v.arm===arm);
 if(!review||(existsSync(report)?!review.readFinalReport||review.reportSha256!==sha(report):!review.missingReportConfirmed))throw new Error('Review the whole final public report first: '+arm);
 if(metrics.timedOut||metrics.budgetExceeded)throw new Error('Unexpected evaluator interruption: '+arm);
 return {arm,dir,metrics};
});
const startedThreads=rows.map(r=>r.metrics.threadId).filter(Boolean);
if(rows.length!==4||new Set(startedThreads).size!==startedThreads.length)throw new Error('Expected four fresh invocations with no reused native thread');
const events=rows.flatMap(r=>[{at:r.metrics.startedAt,delta:1},{at:r.metrics.finishedAt,delta:-1}]).sort((a,b)=>a.at.localeCompare(b.at)||a.delta-b.delta);
let concurrent=0,maxConcurrent=0;for(const e of events){concurrent+=e.delta;maxConcurrent=Math.max(maxConcurrent,concurrent);}
if(concurrent||maxConcurrent>3)throw new Error('Unexpected concurrency');
const record={allActorsEndedBeforeGrading:true,allPublicReportsReviewedBeforeGrading:true,allCairnProtocolsVerified:true,allImplementationsFrozenBeforeActors:true,allActorsEndedAt:rows.map(r=>r.metrics.finishedAt).sort().at(-1),gradingStartedAt:new Date().toISOString(),maxConcurrentActors:maxConcurrent,qualitativeAuditSha256:sha(join(root,'qualitative-audit.json')),manifestSha256:sha(join(root,'manifest.json'))};
save(join(root,'finalization.json'),record);
const scratch=mkdtempSync(join(tmpdir(),'cairn-codex-grading-'));
try{
 for(const r of rows){
  const work=join(scratch,r.arm);mkdirSync(work);
  for(const f of ['answer.json','REPORT.md'])if(existsSync(join(r.dir,'initial.'+f)))cpSync(join(r.dir,'initial.'+f),join(work,f));
  const result=spawnSync('python3',[join(root,'grade.py'),manifest.case,work],{encoding:'utf8',timeout:15000});
  if(result.status!==0)throw new Error('Host grading failed: '+result.stderr);
  save(join(r.dir,'initial.grade.json'),JSON.parse(result.stdout));
 }
 save(join(root,'finished.json'),{...record,finishedAt:new Date().toISOString()});
 console.log(JSON.stringify({event:'codex_comparison_finalized',root,actors:rows.length,maxConcurrent}));
}finally{rmSync(scratch,{recursive:true,force:true});}
