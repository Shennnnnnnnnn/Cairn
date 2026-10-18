// Post-run decomposition of the unchanged combined acceptance checker.
// Uniform for all 18 attempts; no actor code, labels or model calls.
import {spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=join(dirname(fileURLToPath(import.meta.url)),'runs/2026-10-18-pi-deepseek-round10-repeated');
const load=path=>JSON.parse(readFileSync(path,'utf8')),manifest=load(join(root,'manifest.json'));
if(!load(join(root,'execution-ended.json')).allActorsEnded)throw new Error('All 18 actors must end before uniform acceptance decomposition');
const results=[];
for(const row of manifest.schedule){
 const dir=join(root,row.id),input=JSON.stringify({owner:{cwd:join(dir,'workspace')}}),components={};
 if(existsSync(join(dir,'initial.acceptance-components.json')))throw new Error('Do not replace an acceptance breakdown');
 for(const [kind,command,args] of [['contract',process.execPath,[join(root,'verify-artifacts.mjs')]],['arithmetic','python3',[join(root,'verify-reproduction.py'),join(dir,'input-hashes.json')]]]){
  const result=spawnSync(command,args,{input,encoding:'utf8',timeout:10000,maxBuffer:65536});
  try{components[kind]={...JSON.parse(result.stdout),processExitCode:result.status};}catch{components[kind]={ok:false,issues:[{message:'Host component unavailable: '+(result.error?.message??result.stderr.slice(0,300))}],processExitCode:result.status,unavailable:true};}
 }
 const combined=load(join(dir,'initial.acceptance.json'));
 if(Boolean(combined.ok)!==Boolean(components.contract.ok&&components.arithmetic.ok))throw new Error('Read-only component results differ from the frozen combined result: '+row.id);
 results.push({dir,id:row.id,record:{checkedAt:new Date().toISOString(),method:'Same frozen contract checker and arithmetic checker rerun read-only for every completed attempt; combined original result retained; no hidden-label or actor code execution',...components}});
}
for(const row of results)writeFileSync(join(row.dir,'initial.acceptance-components.json'),JSON.stringify(row.record,null,2)+'\n',{mode:0o600,flag:'wx'});
console.log(JSON.stringify({actors:results.length,contractPassed:results.filter(row=>row.record.contract.ok).length,arithmeticPassed:results.filter(row=>row.record.arithmetic.ok).length,failed:results.filter(row=>!row.record.contract.ok||!row.record.arithmetic.ok).map(row=>({id:row.id,contract:row.record.contract.ok,arithmetic:row.record.arithmetic.ok}))},null,2));
