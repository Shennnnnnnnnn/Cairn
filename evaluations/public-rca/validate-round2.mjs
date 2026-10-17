// Pure read-only evaluation of saved snapshots; never bind or change experimental tasks.
import {Engine,Store,evaluateTask} from '../../dist/index.js';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=join(dirname(fileURLToPath(import.meta.url)),'runs',process.argv[2]??'2026-10-16-aiops2022-round2b');
const manifest=JSON.parse(readFileSync(join(root,'manifest.json'),'utf8')),store=new Store(':memory:'),engine=new Engine(store),results=[];
try{
 for(const [caseName,mode] of manifest.order){
  if(mode!=='pi-cairn')continue;
  const path=join(root,caseName,mode,'cairn-tasks.json');if(!existsSync(path))continue;
  const grade=JSON.parse(readFileSync(join(root,caseName,mode,'reviewed-grade.json'),'utf8'));
  for(const task of JSON.parse(readFileSync(path,'utf8')))results.push({case:caseName,id:task.id,status:task.status,structural:evaluateTask(task),completion:engine.completionCheck(task),verificationStatus:task.verification?.status,hostExecution:task.execution,independentReviewedJointTop1:grade.jointTop1});
 }
 writeFileSync(join(root,'round2-state-validation.json'),JSON.stringify(results,null,2)+'\n');console.log(JSON.stringify(results,null,2));
}finally{store.close();}
