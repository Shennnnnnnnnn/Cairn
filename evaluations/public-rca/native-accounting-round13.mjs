// Trusted metadata accounting only; never changes execution or terminal status.
export function resolveCodexUsage({streamUsage,cumulative,baseline,resumed}){
 if(!resumed)return {usage:streamUsage??null,diagnostic:null};
 if(!cumulative||!baseline)return {usage:null,diagnostic:{kind:!cumulative?'resume_cumulative_usage_unavailable':'resume_baseline_usage_unavailable',usageIsLowerBound:true,baseline:baseline??null,cumulative:cumulative??null,streamUsage:streamUsage??null,meaning:'Resumed usage cannot be safely deduplicated without both cumulative boundaries; retain raw metadata rather than guessing zero or duplicating prior usage.'}};
 const delta=Object.fromEntries(Object.entries(cumulative).map(([key,value])=>[key,typeof value==='number'?value-(baseline?.[key]??0):NaN]));
 const invalid=Object.entries(delta).filter(([,value])=>!Number.isFinite(value)||value<0);
 if(invalid.length)return {usage:null,diagnostic:{kind:'resume_cumulative_usage_inconsistent',usageIsLowerBound:true,invalidFields:invalid.map(([key])=>key),baseline:baseline??null,cumulative,streamUsage:streamUsage??null,meaning:'Preserve original native CLI/task terminal status and raw ledgers. The incremental usage is unknown; do not guess zero or discard the actor.'}};
 return {usage:delta,diagnostic:null};
}

/** Public metadata only; a started tool remains an action even without completion. */
export function createCodexRepairActionAudit(){
 const ids=new Set();let anonymousEvents=0;
 return {observe(event){
  if(!['item.started','item.updated','item.completed'].includes(event.type)||!event.item)return;
  const item=event.item;if(['reasoning','agent_message','error'].includes(item.type))return;
  if(typeof item.id==='string'&&item.id)ids.add(item.id);else anonymousEvents++;
 },snapshot(){return {observedNativeActions:ids.size+anonymousEvents,identifiedActions:ids.size,anonymousActionEvents:anonymousEvents,toolDisableMechanism:'Prompt plus post-hoc rejection on any public native action; no asserted Codex pre-execution tool disable flag'};}};
}
