// Trusted host composes contract inspection and independent CSV replay. Never reads hidden labels.
import {spawnSync} from 'node:child_process';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
let input='';for await(const chunk of process.stdin)input+=chunk;
const here=dirname(fileURLToPath(import.meta.url)),issues=[];
for(const [command,args] of [[process.execPath,[join(here,'verify-artifacts.mjs')]],['python3',[join(here,'verify-reproduction.py'),...process.argv.slice(2)]]]){
 const child=spawnSync(command,args,{input,encoding:'utf8',timeout:8000,maxBuffer:65536});
 if(child.status!==0){issues.push({message:`Independent check unavailable: ${child.error?.message??child.stderr.slice(0,400)}`});continue;}
 try{const result=JSON.parse(child.stdout);if(!result.ok)issues.push(...result.issues);}catch{issues.push({message:'Independent checker returned invalid JSON'});}
}
console.log(JSON.stringify({ok:!issues.length,issues,method:'replay',scope:'Artifact contract and independent numeric replay of checks.json against original local CSVs. Hidden RCA labels are not read; cause/category, metric collection semantics and unstructured prose are outside this check.'}));
