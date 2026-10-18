// Host-only, read-only frozen-engine assurance. No inference or source DB writes.
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const root=resolve('evaluations/public-rca/runs/2026-10-18-kimi-scheduler-round14');
const load=p=>JSON.parse(readFileSync(p,'utf8')),m=load(join(root,'manifest.json'));
if(!load(join(root,'execution-ended.json')).allActorsEnded)throw new Error('Every actor must end first');
const {Engine,Store}=await import(pathToFileURL(join(root,'implementation/dist/index.js')).href);
const records=[];
for(const row of m.schedule.filter(r=>r.arm==='cairn')){
 const dir=join(root,row.id),source=load(join(dir,'initial.cairn-tasks.json')),protocol=load(join(dir,'initial.cairn-protocol.json'));
 const store=new Store(':memory:'),engine=new Engine(store),tasks=[];
 try{for(const task of source){let reportCheck={ok:false,issues:['No report']},current=false,error;try{if(task.report)reportCheck=engine.evaluateReport(task,task.report);current=engine.verificationCurrent(task);}catch(e){error=e.message;}tasks.push({id:task.id,status:task.status,reportCheck,current,error});}}finally{store.close();}
 const record={id:row.id,singleTaskGoal:protocol.singleTaskGoal,tasks,completedCandidateCurrent:protocol.singleTaskGoal&&tasks.length===1&&tasks[0].status==='completed'&&tasks[0].reportCheck.ok&&tasks[0].current,sourceDatabaseWritten:false,modelCalled:false};
 const path=join(dir,'initial.cairn-assurance.json');if(existsSync(path)){if(JSON.stringify(load(path))!==JSON.stringify(record))throw new Error('Read-only assessment changed');}else writeFileSync(path,JSON.stringify(record,null,2)+'\n',{mode:0o600,flag:'wx'});records.push(record);
}
console.log(JSON.stringify({assessed:records.length,current:records.filter(r=>r.completedCandidateCurrent).length}));
