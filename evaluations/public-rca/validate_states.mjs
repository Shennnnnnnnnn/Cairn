// Read frozen task snapshots; never reopen, finish, or alter experimental state.
import {evaluateTask} from '../../dist/index.js';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=join(dirname(fileURLToPath(import.meta.url)),'runs',process.argv[2]??'2026-10-16-aiops2022');
const manifest=JSON.parse(readFileSync(join(root,'manifest.json'),'utf8'));
const results=[];
for(const [caseName,mode] of manifest.order){
 if(mode!=='pi-cairn')continue;
 const path=join(root,caseName,mode,'cairn-tasks.json');if(!existsSync(path))continue;
 const reviewedPath=join(root,caseName,mode,'reviewed-grade.json');
 const reviewed=existsSync(reviewedPath)?JSON.parse(readFileSync(reviewedPath,'utf8')):null;
 const grade=JSON.parse(readFileSync(join(root,caseName,mode,'grade.json'),'utf8'));
 for(const task of JSON.parse(readFileSync(path,'utf8')))results.push({case:caseName,id:task.id,status:task.status,criteriaCheck:evaluateTask(task),independentLabelJointTop1:grade.jointTop1,independentReviewedJointTop1:reviewed?.jointTop1??grade.jointTop1});
}
writeFileSync(join(root,'state-validation.json'),JSON.stringify(results,null,2)+'\n');
console.log(JSON.stringify(results,null,2));
