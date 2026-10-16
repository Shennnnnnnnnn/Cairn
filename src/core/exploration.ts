import { CairnError, type Task, type Claim, type FactVersion, type Derivation, type ReviewReason } from './types.js';

export function needsReview(task:Pick<Task,'claims'|'origin'>,claim:Claim,seen=new Set<string>()):boolean {
  if(!claim.derivation)return false;
  if(seen.has(claim.id))return true;
  const visited=new Set(seen).add(claim.id);
  return claim.derivation.inputs.some(input=>{
    if(input.id==='origin')return input.text!==task.origin;
    const current=task.claims.find(value=>value.id===input.id);
    return !current||current.revision!==input.revision||current.status!=='supported'||needsReview(task,current,visited);
  });
}

export function pinFacts(task:Task,refs:string[]):FactVersion[] {
  if(!Array.isArray(refs)||!refs.length||refs.some(ref=>typeof ref!=='string'||!ref.trim()))throw new CairnError('invalid_source','Exploration from needs at least one source fact');
  const facts=refs.map(ref=>{
    if(ref==='origin')return {id:'origin',revision:0,text:task.origin,scope:task.scope};
    const matches=task.claims.filter(claim=>claim.id===ref||claim.key===ref||`claim:${claim.id}`===ref);
    if(matches.length!==1)throw new CairnError('invalid_source',`Source ${ref} is unknown or ambiguous in this task`);
    const claim=matches[0]!;
    if(claim.status!=='supported'||!(claim.basis?.trim()||claim.references?.length||claim.supports.length)||needsReview(task,claim))throw new CairnError('invalid_source',`Source ${ref} is not a current supported fact`);
    if(Object.entries(task.scope).some(([key,value])=>claim.scope[key]!==value))throw new CairnError('scope_mismatch',`Source ${ref} does not cover this task scope`);
    return {id:claim.id,revision:claim.revision,text:claim.text,...(claim.basis===undefined?{}:{basis:claim.basis}),...(claim.references?{references:claim.references}:{}),scope:claim.scope};
  });
  return [...new Map(facts.map(fact=>[fact.id,fact])).values()].sort((a,b)=>a.id.localeCompare(b.id));
}

export function derive(task:Task,branchKey:string,claimId?:string):Derivation {
  const branch=task.branches?.find(value=>value.key===branchKey);
  if(!branch?.sourceFacts?.length||branch.epoch!==task.owner.epoch||!['running','awaiting_review','reviewing','completed'].includes(branch.status))throw new CairnError('invalid_derivation','producedBy needs a current exploration with from sources and actual execution');
  const current=pinFacts(task,branch.from!);
  if(JSON.stringify(current)!==JSON.stringify(branch.sourceFacts))throw new CairnError('stale_source','Exploration source facts changed; explicitly refresh from and investigate again');
  const reaches=(id:string,seen=new Set<string>()):boolean=>{
    if(id===claimId)return true;
    if(seen.has(id))return false;
    seen.add(id);return task.claims.find(value=>value.id===id)?.derivation?.inputs.some(input=>reaches(input.id,seen))??false;
  };
  if(claimId&&branch.sourceFacts.some(input=>reaches(input.id)))throw new CairnError('cyclic_derivation','A finding cannot derive from itself or its descendants');
  return {branch:branch.key,epoch:branch.epoch,attempt:branch.attempt,inputs:structuredClone(branch.sourceFacts)};
}

export function queueReview(task:Task,reason:Omit<ReviewReason,'generation'>) {
  task.review??={generation:0,acknowledged:0,pending:[]};
  const generation=++task.review.generation;
  task.review.pending.push({...reason,generation});
}

export const explorationId=(value:{branch:string;epoch:number;attempt:number})=>`exploration:${value.branch}:${value.epoch}:${value.attempt}`;
export const factNodeId=(task:Pick<Task,'claims'>,fact:FactVersion)=>fact.id==='origin'?'origin':task.claims.some(claim=>claim.id===fact.id&&claim.revision===fact.revision)?`claim:${fact.id}`:`fact:${fact.id}@${fact.revision}`;

/** Semantic provenance only; branch membership is not evidence of production. */
export function explorationTopology(task:Pick<Task,'claims'|'branches'>) {
  const versions=new Map<string,FactVersion>(),attempts=new Map<string,{derivation:Derivation;current:boolean}>();
  for(const branch of task.branches??[])if(branch.sourceFacts?.length){const derivation={branch:branch.key,epoch:branch.epoch,attempt:branch.attempt,inputs:branch.sourceFacts};attempts.set(explorationId(derivation),{derivation,current:true});}
  for(const claim of task.claims)if(claim.derivation){const id=explorationId(claim.derivation);if(!attempts.has(id))attempts.set(id,{derivation:claim.derivation,current:false});}
  const edges:{from:string;to:string;relation:'input'|'produces'|'explores'|'revises';revision?:number}[]=[];
  for(const [id,{derivation}]of attempts){
    edges.push({from:`branch:${derivation.branch}`,to:id,relation:'explores'});
    for(const fact of derivation.inputs){const node=factNodeId(task,fact);if(node.startsWith('fact:'))versions.set(node,fact);edges.push({from:node,to:id,relation:'input',revision:fact.revision});}
  }
  for(const claim of task.claims)if(claim.derivation)edges.push({from:explorationId(claim.derivation),to:`claim:${claim.id}`,relation:'produces'});
  for(const [id,fact]of versions)if(task.claims.some(claim=>claim.id===fact.id))edges.push({from:id,to:`claim:${fact.id}`,relation:'revises'});
  return {attempts:[...attempts].map(([id,value])=>({id,...value})),versions:[...versions].map(([id,fact])=>({id,fact})),edges};
}
