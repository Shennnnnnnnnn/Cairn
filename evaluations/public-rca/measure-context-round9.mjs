// Domain-free, fixed public requests. Bytes are not model tokens or actual fees.
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
const base=resolve('evaluations/public-rca/runs'),old=join(base,'2026-10-17-codex-sol-xhigh-round8-repeated/implementation'),current=join(base,'2026-10-17-pi-deepseek-round9-repeated/implementation');
const bytes=v=>Buffer.byteLength(JSON.stringify(v));
async function measure(root){
 const {createHarness}=await import(pathToFileURL(join(root,'dist/index.js')));
 let clock=Date.parse('2026-10-17T10:00:00Z');
 const h=createHarness({database:':memory:',now:()=>new Date(clock),session:{host:'pi',sessionId:'fixed-measurement',cwd:'/workspace'}});
 try{
  const catalog=await h.tools.list(),start=await h.tools.invokeModel('cairn_start',{goal:'Explain observed behavior using the original input',criteria:['Justify the explanation','Preserve the unresolved alternative']});
  const batch=Array.from({length:6},(_,i)=>({key:`fact-${i}`,text:`Observation ${i}: `+'Observed the original behavior. '.repeat(12),status:'supported',basis:'Used the documented input under unchanged conditions',covers:[]}));
  const first=await h.tools.invokeModel('cairn_checkpoint',{findings:batch,questions:['Which alternative reproduces this behavior?'],next:'Compare the distinguishing prediction'});
  const revision=await h.tools.invokeModel('cairn_checkpoint',{findings:[{...batch[0],text:'Alternative failed under the same documented conditions',status:'refuted'}]});
  const retry=await h.tools.invokeModel('cairn_checkpoint',{findings:[{...batch[0],text:'Alternative failed under the same documented conditions',status:'refuted'}]});
  const recovery=await h.tools.invokeModel('cairn_read',{});
  clock+=61000;const reminder=h.engine.explorationGuidance(start.taskId,{host:'pi',sessionId:'fixed-measurement',cwd:'/workspace'});
  return {reminderBytes:Buffer.byteLength(reminder??''),catalogBytes:bytes(catalog),skillBytes:readFileSync(join(root,'skills/cairn/SKILL.md')).length,startBytes:bytes(start),firstDeltaBytes:bytes(first),revisionBytes:bytes(revision),idempotentRetryBytes:bytes(retry),recoveryBytes:bytes(recovery),savedFindings:recovery.claims.length,storedAlternative:recovery.claims.find(c=>c.key==='fact-0').status,questions:recovery.checkpoint.questions,next:recovery.checkpoint.next};
 }finally{await h.close();}
}
const result={kind:'Fixed generic public request byte comparison, no model calls; not token or monetary savings',before:await measure(old),after:await measure(current)};
writeFileSync(join(current,'../context-measurement.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
