import {randomUUID,createHash} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {resolveSources,workRef} from './causality.js';
import {claimReferenceIssues} from './artifacts.js';
import {CairnError,type Task,type HandoffInput,type Handoff,type Claim,type Session} from './types.js';
export const completedNext='Task completed. Review the saved candidate and acceptance scope before reuse; explicitly reopen for new work.';

/** SQLite is authoritative. A private immutable Markdown file is a convenience
 * projection; failure to write it never discards the saved handoff detail. */
export function saveGeneratedHandoff(task:Task,databasePath:string,candidate:string,at:string,reason:string,branch?:{actor:Session;key:string}):boolean{
  const owner=branch?{...branch.actor,epoch:task.owner.epoch}:task.owner;
  const checkpoint=branch?task.progress?.find(p=>p.key===branch.key)?.branchCheckpoint:task.checkpoint;
  const key=branch?`@host/branch/${createHash('sha256').update(branch.key).digest('hex')}`:'@host/state';
  const state={candidate,owner,status:task.status,branchKey:branch?.key,checkpoint:checkpoint?{summary:checkpoint.summary,questions:checkpoint.questions,next:checkpoint.next}:undefined,progress:branch?undefined:task.progress?.map(({key,status,from,branchStatus})=>({key,status,from,branchStatus}))};
  const fingerprint=createHash('sha256').update(JSON.stringify(state)).digest('hex');
  if(task.handoffs?.findLast(h=>h.key===key)?.source?.fingerprint===fingerprint)return false;
  const source={...owner,taskId:task.id,revision:task.revision,candidate,fingerprint,state:'saved' as const,reason,...(branch?{branchKey:branch.key}:{})};
  const selected=branch?task.claims.filter(c=>c.branchKey===branch.key).slice(-12):selectHandoffContext(task).claims;
  const summary=(checkpoint?.summary??task.report?.summary??`No findings saved yet. Goal: ${task.goal}`).slice(0,1800);
  const unmet=task.criteria.filter(c=>!c.claimIds.length).map(c=>`${c.id}: ${c.text}`);
  const next=!branch&&task.status==='completed'?completedNext:checkpoint?.next??(branch?'Owner must review this branch proposal; it does not establish criterion coverage.':unmet.length?'Inspect the saved facts and unmet criteria; choose one useful test or preserve the gap.':'Review the strongest remaining alternative and the current acceptance result.');
  const referenceCache=new Map();
  let detail=[`# Cairn saved handoff`,JSON.stringify(source),`Status: ${task.status}`,`Origin: ${task.origin}`,`Goal: ${task.goal}`,
    `Constraints:\n${task.constraints.join('\n')}`,`Latest checkpoint: ${summary}`,`Criteria:\n${task.criteria.map(c=>`${c.id}: ${c.text} [${c.claimIds.join(', ')}]`).join('\n')}`,
    `Findings (declared status is not independent correctness; reference state is at save time):\n${selected.map(c=>{const issues=claimReferenceIssues(task,c,referenceCache);return JSON.stringify({id:c.id,key:c.key,revision:c.revision,status:c.status,text:c.text,basis:c.basis,references:c.references,referenceState:{status:issues.length?'stale':c.referenceArtifacts?.length?'current':'untracked',issues:issues.slice(0,2)},from:c.from,branchKey:c.branchKey});}).join('\n')}`,
    `Questions:\n${(checkpoint?.questions??[]).join('\n')}`,`Next: ${next}`,`Submitted file snapshots:\n${JSON.stringify(task.artifacts??[])}`,
    'Saved knowledge only. No receiver has been started, notified or acknowledged by this record. Full task/history remains in the source database.'
  ].join('\n\n');
  if(Buffer.byteLength(detail,'utf8')>60000)detail=Buffer.from(detail).subarray(0,60000).toString('utf8').replace(/\uFFFD$/,'')+'\n\nDetail truncated; read the source task/history for the complete state.';
  const handoff:Handoff={id:`handoff_${randomUUID()}`,key,summary,sessionRef:`${owner.host}:${owner.sessionId}`,from:selected.map(c=>`claim:${c.id}`),next,at,revision:task.revision,source,detail};
  if(databasePath!==':memory:'){
    try{
      const directory=resolve(dirname(databasePath),'handoffs');mkdirSync(directory,{recursive:true,mode:0o700});
      const path=join(directory,`${handoff.id}.md`);writeFileSync(path,detail,{encoding:'utf8',mode:0o600,flag:'wx',flush:true});handoff.report=path;
    }catch(error){handoff.projectionError=`Report file unavailable; detail is saved in SQLite: ${(error as Error).message}`.slice(0,500);}
  }
  (task.handoffs??=[]).push(handoff);return true;
}

export function saveHandoffs(task:Task,inputs:HandoffInput[],at:string):boolean {
  if(!Array.isArray(inputs)||inputs.length>8)throw new CairnError('invalid_input','Submit at most 8 handoffs per checkpoint');
  let changed=false;const keys=new Set<string>();
  for(const input of inputs){
    if(!input||typeof input.key!=='string'||!input.key.trim()||input.key.length>200||typeof input.summary!=='string'||!input.summary.trim()||input.summary.length>4000)throw new CairnError('invalid_input','Handoffs need a key and a short summary');
    if(input.key.startsWith('@host/'))throw new CairnError('invalid_input','@host/ handoff keys are reserved for the host');
    if(keys.has(input.key))throw new CairnError('invalid_input','Repeated handoff key');keys.add(input.key);
    for(const field of ['report','sessionRef','next'] as const)if(input[field]!==undefined&&(typeof input[field]!=='string'||!input[field]!.trim()||input[field]!.length>4000))throw new CairnError('invalid_input',`Invalid handoff ${field}`);
    if(input.artifacts!==undefined&&(!Array.isArray(input.artifacts)||input.artifacts.length>16||input.artifacts.some(v=>typeof v!=='string'||!v.trim()||v.length>4000)))throw new CairnError('invalid_input','Handoff artifacts must be file/link locators');
    const value:HandoffInput={key:input.key,summary:input.summary,...(input.report?{report:input.report}:{}),...(input.artifacts?{artifacts:[...new Set(input.artifacts)]}:{}),sessionRef:input.sessionRef??`${task.owner.host}:${task.owner.sessionId}`,...(input.from?{from:resolveSources(task,input.from)}:{}),...(input.next?{next:input.next}:{})};
    const previous=task.handoffs?.findLast(h=>h.key===value.key);
    if(previous){const {id,at:time,revision,...old}=previous;if(JSON.stringify(old)===JSON.stringify(value))continue;}
    (task.handoffs??=[]).push({...value,id:`handoff_${randomUUID()}`,at,revision:task.revision+1});changed=true;
  }
  return changed;
}

/** A bounded view of relevant graph nodes and report locators; canonical history stays complete. */
export function selectHandoffContext(task:Task,focus?:string,limit=12){
  const nodes=new Map<string,{from?:string[]}>();for(const c of task.claims)nodes.set(`claim:${c.id}`,c);for(const p of task.progress??[])nodes.set(workRef(p),p);
  const criterion=task.criteria.find(c=>c.id===focus),seeds:string[]=[];
  if(focus)seeds.push(...(criterion?criterion.claimIds.map(id=>`claim:${id}`):resolveSources(task,[focus])));
  else{
    for(const p of (task.progress??[]).filter(p=>!['completed','cancelled'].includes(p.status)).slice(-4))seeds.push(workRef(p));
    for(const c of task.criteria)seeds.push(...c.claimIds.map(id=>`claim:${id}`));
  }
  const selected:Claim[]=[],seen=new Set<string>(),visited=new Set<string>();
  const add=(claim:Claim)=>{if(selected.length<limit&&!seen.has(claim.id)){selected.push(claim);seen.add(claim.id);}};
  for(const seed of seeds){
    const queue=[seed];for(let i=0;i<queue.length&&visited.size<4096;i++){
      const ref=queue[i]!;if(visited.has(ref))continue;visited.add(ref);
      const node=nodes.get(ref);if(!node)continue;
      if(ref.startsWith('claim:'))add(node as Claim);
      queue.push(...(node.from??[]));
    }
  }
  const recent=task.claims.slice().reverse().sort((a,b)=>(b.updatedAt??'').localeCompare(a.updatedAt??''));
  if(focus)for(const c of recent)if(['refuted','inconclusive'].includes(c.status)&&((criterion&&c.relatedCriteria?.includes(criterion.id))||c.from?.some(ref=>visited.has(ref))))add(c);
  for(const c of recent)add(c);
  const relevantRefs=new Set([...visited,...selected.map(c=>`claim:${c.id}`)]),keys=new Set<string>();
  const latest=(task.handoffs??[]).slice().reverse().filter(h=>{if(keys.has(h.key))return false;keys.add(h.key);return true;});
  const host=latest.find(h=>h.key==='@host/state');
  const handoffs=latest.sort((a,b)=>Number(b.from?.some(ref=>relevantRefs.has(ref))??false)-Number(a.from?.some(ref=>relevantRefs.has(ref))??false)||Number(!!a.source)-Number(!!b.source)).slice(0,3);
  if(host&&!handoffs.includes(host))handoffs[handoffs.length-1]=host;
  const omittedDependencies=[...new Set(selected.flatMap(c=>c.from??[]))].filter(ref=>ref.startsWith('claim:')&&!seen.has(ref.slice(6)));
  return {claims:selected,handoffs,omittedDependencies};
}
