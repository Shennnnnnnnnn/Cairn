// Host-only read-only completion assessment using each actor's own frozen engine.
// No source SQLite connection, hidden grades, native transcripts, verifier command or model call.
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';

const here=dirname(fileURLToPath(import.meta.url)),root=join(here,'runs/2026-10-17-codex-sol-xhigh-round7b');
const load=path=>JSON.parse(readFileSync(path,'utf8'));
const sha=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
const manifest=load(join(root,'manifest.json'));
if(manifest.arms.length!==4||manifest.arms.some(arm=>!existsSync(join(root,arm,'actor-finished.json'))))throw new Error('All four actors must end before frozen-engine completion assessment');
const arms=manifest.arms.filter(arm=>arm!=='codex');
if(arms.some(arm=>existsSync(join(root,arm,'initial.cairn-assurance.json'))))throw new Error('Do not replace a saved frozen-engine completion assessment');
const allActorsEndedAt=manifest.arms.map(arm=>load(join(root,arm,'initial.metrics.json')).finishedAt).sort().at(-1);
const records=[];
for(const arm of arms){
 const version=arm.endsWith('previous')?'previous':arm.endsWith('after')?'after':'before';
 const archive=join(root,version==='previous'?'implementation-previous':version==='after'?'implementation-after':'implementation');
 const entry=join(archive,'dist/index.js'),snapshot=join(root,arm,'initial.cairn-tasks.json');
 const expected=manifest.implementations[version]['dist/index.js'];
 if(!expected||sha(entry)!==expected)throw new Error('Frozen engine artifact differs from the sealed manifest: '+arm);
 const source=load(snapshot),{Engine,Store}=await import(pathToFileURL(entry).href),store=new Store(':memory:');
 const engine=new Engine(store),tasks=[];
 try{
  for(const task of source){
   let reportCheck={ok:false,issues:['No saved report'],unmet:[]},verificationCurrent=false,error;
   try{
    if(task.report)reportCheck=engine.evaluateReport(task,task.report);
    verificationCurrent=engine.verificationCurrent(task);
   }catch(failure){error=failure.message;reportCheck={ok:false,issues:[`Frozen completion assessment failed: ${error}`],unmet:[]};}
   tasks.push({taskId:task.id,status:task.status,verificationCurrent,reportCheck,...(error?{error}:{})});
  }
 }finally{store.close();}
 records.push({arm,path:join(root,arm,'initial.cairn-assurance.json'),record:{
  method:'Frozen Engine.evaluateReport and Engine.verificationCurrent on saved task snapshots using an in-memory Store only',
  assessedAt:new Date().toISOString(),allActorsEndedAt,implementation:version,engineArtifactSha256:expected,
  sourceTaskSnapshotSha256:sha(snapshot),taskCount:source.length,tasks,
  completedCandidateCurrent:tasks.length===1&&tasks[0].status==='completed'&&tasks[0].verificationCurrent&&tasks[0].reportCheck.ok,
  externalVerifierExecuted:false,modelCalled:false,sourceDatabaseOpened:false,
 }});
}
for(const {path,record} of records)writeFileSync(path,JSON.stringify(record,null,2)+'\n',{mode:0o600,flag:'wx'});
console.log(JSON.stringify({event:'frozen_codex_assurance_checked',root,allActorsEndedAt,results:records.map(({arm,record})=>({arm,taskCount:record.taskCount,completedCandidateCurrent:record.completedCandidateCurrent,tasks:record.tasks.map(task=>({taskId:task.taskId,verificationCurrent:task.verificationCurrent,reportOk:task.reportCheck.ok}))}))},null,2));
