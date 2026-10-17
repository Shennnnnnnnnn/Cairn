// Global host-only grading barrier. Grades never enter an actor's workspace.
import {spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync,existsSync,mkdtempSync,mkdirSync,cpSync,rmSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const here=dirname(fileURLToPath(import.meta.url)),root=join(here,'runs/2026-10-17-pi-deepseek-round9-repeated');
const load=path=>JSON.parse(readFileSync(path,'utf8')),sha=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
const save=(path,value)=>writeFileSync(path,JSON.stringify(value,null,2)+'\n',{mode:0o600,flag:'wx'});
const manifest=load(join(root,'manifest.json')),execution=load(join(root,'execution-ended.json')),reviews=load(join(root,'qualitative-audit.json')),start=load(join(root,'execution-started.json'));
if(existsSync(join(root,'finished.json')))throw new Error('Already finalized');
if(!execution.allActorsEnded||manifest.schedule.length!==18||execution.maxConcurrent>3)throw new Error('All 18 actors must end with maximum three concurrent');
if(start.manifestSha256!==sha(join(root,'manifest.json')))throw new Error('Manifest changed after the first actor');
for(const [name,expected] of Object.entries(manifest.frozenFiles))if(sha(join(root,name))!==expected)throw new Error('Frozen input changed: '+name);
for(const [name,expected] of Object.entries(manifest.implementation))if(sha(join(root,'implementation',name))!==expected)throw new Error('Frozen implementation changed: '+name);
for(const [name,expected] of Object.entries(manifest.cases))if(sha(join(root,'cases',name))!==expected)throw new Error('Frozen case changed: '+name);
if(sha(join(root,manifest.probe.file))!==manifest.probe.sha256)throw new Error('Probe changed');
const rows=manifest.schedule.map(row=>{
 const dir=join(root,row.id),report=join(dir,'initial.REPORT.md');
 if(!existsSync(join(dir,'actor-finished.json'))||existsSync(join(dir,'initial.grade.json')))throw new Error('Actor still running or early label grade: '+row.id);
 const review=reviews.results.find(value=>value.id===row.id),metrics=load(join(dir,'initial.metrics.json'));
 if(!review||(existsSync(report)?!review.readFinalReport||review.reportSha256!==sha(report):!review.missingReportConfirmed))throw new Error('Read the complete final public report or confirm missing: '+row.id);
 if(Date.parse(metrics.startedAt)<Date.parse(manifest.sealedAt)||metrics.timedOut||metrics.budgetExceeded)throw new Error('Unexpected evaluator intervention');
 if(row.arm==='cairn'&&!existsSync(join(dir,'initial.cairn-assurance.json')))throw new Error('Check frozen Cairn assurance first');
 return {...row,dir,metrics};
});
const threads=rows.map(row=>row.metrics.threadId).filter(Boolean);
if(new Set(threads).size!==threads.length)throw new Error('Native session reused');
const events=rows.flatMap(row=>[{at:row.metrics.startedAt,delta:1},{at:row.metrics.finishedAt,delta:-1}]).sort((a,b)=>a.at.localeCompare(b.at)||a.delta-b.delta);
let active=0,max=0;for(const event of events){active+=event.delta;max=Math.max(max,active);}
if(active||max>3)throw new Error('Concurrency metadata mismatch');
const record={allActorsEndedBeforeGrading:true,allPublicReportsReviewedBeforeGrading:true,allActorsEndedAt:rows.map(row=>row.metrics.finishedAt).sort().at(-1),gradingStartedAt:new Date().toISOString(),maxConcurrent:max,actors:rows.length,manifestSha256:sha(join(root,'manifest.json')),qualitativeAuditSha256:sha(join(root,'qualitative-audit.json'))};
const scratch=mkdtempSync(join(tmpdir(),'cairn-pi-round9-grading-')),graded=[];
try{
 for(const row of rows){
  const work=join(scratch,row.id);mkdirSync(work);
  for(const name of ['answer.json','REPORT.md'])if(existsSync(join(row.dir,'initial.'+name)))cpSync(join(row.dir,'initial.'+name),join(work,name));
  const result=spawnSync('python3',[join(root,'grade.py'),row.case,work],{encoding:'utf8',timeout:15000});
  if(result.status!==0)throw new Error('Host grading process failed: '+result.stderr);
  graded.push({row,value:JSON.parse(result.stdout)});
 }
 save(join(root,'finalization.json'),record);
 for(const {row,value} of graded)save(join(row.dir,'initial.grade.json'),value);
 save(join(root,'finished.json'),{...record,finishedAt:new Date().toISOString()});
 console.log(JSON.stringify({event:'repeated_finalized',actors:rows.length,maxConcurrent:max}));
}finally{rmSync(scratch,{recursive:true,force:true});}
