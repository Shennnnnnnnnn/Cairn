// Read-only final assessment, using the tested frozen engine and private task DBs.
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
const here=dirname(fileURLToPath(import.meta.url)),root=join(here,'runs/2026-10-17-codex-sol-xhigh-round8-repeated');
const load=path=>JSON.parse(readFileSync(path,'utf8')),sha=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
const manifest=load(join(root,'manifest.json'));
if(!load(join(root,'execution-ended.json')).allActorsEnded||manifest.schedule.some(row=>!existsSync(join(root,row.id,'actor-finished.json'))))throw new Error('All 18 actors must end first');
const entry=join(root,'implementation/dist/index.js');
if(sha(entry)!==manifest.implementation['dist/index.js'])throw new Error('Frozen engine changed');
const {Engine,Store}=await import(pathToFileURL(entry).href),driver=await import(pathToFileURL(join(root,'driver.frozen.mjs')).href);
const results=[];
for(const row of manifest.schedule.filter(row=>row.arm==='cairn')){
 const dir=join(root,row.id),work=join(dir,'workspace'),metrics=load(join(dir,'initial.metrics.json'));
 const protocol=driver.assertCairnProtocol({work,metrics,verifyCommand:[process.execPath,join(root,'verify-submission.mjs'),join(dir,'input-hashes.json')],artifacts:['answer.json','REPORT.md','checks.json'],launch:load(join(dir,'launch.json')),tools:load(join(dir,'initial.tools.json')),strict:false});
 const source=load(join(dir,'initial.cairn-tasks.json'));
 if(JSON.stringify(protocol.tasks)!==JSON.stringify(source))throw new Error('Private source task DB differs from the saved snapshot: '+row.id);
 const store=new Store(':memory:'),engine=new Engine(store),tasks=[];
 try{
  for(const task of source){
   let reportCheck={ok:false,issues:['No saved report'],unmet:[]},verificationCurrent=false,error;
   try{if(task.report)reportCheck=engine.evaluateReport(task,task.report);verificationCurrent=engine.verificationCurrent(task);}catch(failure){error=failure.message;}
   tasks.push({taskId:task.id,status:task.status,verificationCurrent,reportCheck,...(error?{error}:{})});
  }
 }finally{store.close();}
 const record={id:row.id,assessedAt:new Date().toISOString(),engineSha256:sha(entry),taskSnapshotSha256:sha(join(dir,'initial.cairn-tasks.json')),privateProtocolValid:protocol.valid,singleTaskGoal:protocol.singleTaskGoal,tasks,completedCandidateCurrent:protocol.singleTaskGoal&&tasks.length===1&&tasks[0].status==='completed'&&tasks[0].verificationCurrent&&tasks[0].reportCheck.ok,method:'Read-only private DB identity check; frozen Engine.evaluateReport and verificationCurrent on JSON snapshots with an in-memory Store',sourceDatabaseOpenedReadOnly:true,sourceDatabaseWritten:false,externalVerifierExecuted:false,modelCalled:false};
 if(existsSync(join(dir,'initial.cairn-assurance.json')))throw new Error('Never replace a saved assessment');
 results.push({dir,record});
}
for(const {dir,record} of results)writeFileSync(join(dir,'initial.cairn-assurance.json'),JSON.stringify(record,null,2)+'\n',{mode:0o600,flag:'wx'});
console.log(JSON.stringify({assessed:results.length,current:results.filter(row=>row.record.completedCandidateCurrent).length,results:results.map(row=>({id:row.record.id,current:row.record.completedCandidateCurrent}))},null,2));
