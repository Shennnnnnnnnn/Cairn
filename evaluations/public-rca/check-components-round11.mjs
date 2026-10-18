// Uniform post-run breakdown of frozen contract and arithmetic checkers.
import {spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
const root=resolve('evaluations/public-rca/runs/2026-10-18-five-model-round11'),load=p=>JSON.parse(readFileSync(p,'utf8'));
if(!load(join(root,'execution-ended.json')).allActorsEnded)throw new Error('All actors must end');
const results=[];
for(const row of load(join(root,'manifest.json')).schedule.filter(r=>r.kind==='rca')){
 const dir=join(root,row.id),components={},input=JSON.stringify({owner:{cwd:join(dir,'workspace')}});
 for(const [kind,command,args] of [['contract',process.execPath,[join(root,'verify-artifacts.mjs')]],['arithmetic','/usr/bin/python3',[join(root,'verify-reproduction.py'),join(dir,'input-hashes.json')]]]){
  const r=spawnSync(command,args,{input,encoding:'utf8',timeout:10000,maxBuffer:65536});
  try{components[kind]={...JSON.parse(r.stdout),processExitCode:r.status};}catch{components[kind]={ok:false,unavailable:true,issues:[{message:r.error?.message??'No valid checker JSON'}]};}
 }
 const original=load(join(dir,'initial.acceptance.json')),record={id:row.id,method:'Read-only uniform replay of frozen checkers; original combined acceptance retained; no hidden labels or model calls',...components,originalCombined:original.ok,replayAgrees:Boolean(original.ok)===Boolean(components.contract.ok&&components.arithmetic.ok)};
 const path=join(dir,'initial.acceptance-components.json');if(existsSync(path)){if(JSON.stringify(load(path))!==JSON.stringify(record))throw new Error('Component result changed');}else writeFileSync(path,JSON.stringify(record,null,2)+'\n',{mode:0o600,flag:'wx'});results.push(record);
}
console.log(JSON.stringify({actors:results.length,contractPassed:results.filter(r=>r.contract.ok).length,arithmeticPassed:results.filter(r=>r.arithmetic.ok).length,originalReplayDisagreements:results.filter(r=>!r.replayAgrees).map(r=>r.id)}));
