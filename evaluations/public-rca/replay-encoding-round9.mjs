// Read-only replay of previous public wire-validation failures, no actor code/LLM.
// Run with node --import tsx; imports the current source that final freeze audit checks.
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {Type} from '@sinclair/typebox';
import {coreCatalog,prepareModelInput} from '../../src/tools.ts';
import {validateToolArguments} from '/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai/dist/utils/validation.js';
const base=resolve('evaluations/public-rca/runs'),old=join(base,'2026-10-17-codex-sol-xhigh-round8-repeated'),root=join(base,'2026-10-17-pi-deepseek-round9-repeated');
const load=p=>JSON.parse(readFileSync(p,'utf8')),tool={name:'cairn_checkpoint',parameters:Type.Unsafe(coreCatalog().find(t=>t.name==='cairn_checkpoint').inputSchema)};
const accepts=input=>{try{validateToolArguments(tool,{name:tool.name,arguments:input});return true;}catch{return false;}};
const rows=[];
for(const row of load(join(old,'manifest.json')).schedule.filter(r=>r.arm==='cairn')){
 const path=join(old,row.id,'initial.tools.json');
 for(const t of load(path)){
  if(t.tool!=='cairn_checkpoint'||!(t.result?.isError||t.status==='failed'||t.error)||!['artifacts','handoffs'].some(f=>t.arguments?.[f]?.some(v=>typeof v==='string')))continue;
  const before=JSON.stringify(t.arguments),prepared=prepareModelInput(t.tool,t.arguments);
  rows.push({actor:row.id,toolId:t.id,publicSourceSha256:createHash('sha256').update(readFileSync(path)).digest('hex'),beforeAccepted:accepts(t.arguments),afterAccepted:accepts(prepared),callerUnchanged:JSON.stringify(t.arguments)===before});
 }
}
const result={method:'Exact previous public checkpoint payloads with artifact/handoff object-string rejection; actual installed Pi validator, unchanged object schema, shared preparation only. Does not bypass semantic file/source/owner checks or rerun a benchmark.',rows,passed:rows.filter(r=>!r.beforeAccepted&&r.afterAccepted&&r.callerUnchanged).length,total:rows.length};
writeFileSync(join(root,'previous-encoding-replay.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));if(result.total!==3||result.passed!==3)process.exitCode=1;
