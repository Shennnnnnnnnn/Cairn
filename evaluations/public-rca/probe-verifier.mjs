// Host-owned synthetic read-only verifier. No model code or benchmark labels are executed/read.
import {readFileSync,statSync} from 'node:fs';
import {resolve} from 'node:path';
let input='';for await(const chunk of process.stdin)input+=chunk;
const issues=[];
try{
 const task=JSON.parse(input);if(typeof task.owner?.cwd!=='string')throw new Error('Missing host workspace');
 const path=resolve(task.owner.cwd,'marker.txt'),stat=statSync(path);
 if(!stat.isFile()||stat.size!==6)throw new Error('marker.txt must be the six-byte preconfigured marker');
 if(readFileSync(path,'utf8')!=='alpha\n')throw new Error('marker.txt differs from the preconfigured marker');
}catch(error){issues.push({message:error.message,references:['marker.txt']});}
console.log(JSON.stringify({ok:!issues.length,issues,method:'contract',scope:'Exact preconfigured synthetic marker.txt bytes only; no domain evidence, inference or hidden labels.'}));
