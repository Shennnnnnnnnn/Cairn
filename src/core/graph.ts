import { explorationTopology, needsReview, factNodeId } from './exploration.js';
import { branchRun, branchStatus } from './branches.js';
import type { Task, Check, Claim, Criterion, EvidenceMode, FactVersion } from './types.js';

export type EvidenceRelation = 'basis'|'supports'|'refutes'|'criterion'|'addresses'|'goal';
export interface SemanticEdge { from:string; to:string; relation:string; revision?:number }
export interface EvidenceEdge extends SemanticEdge { relation:EvidenceRelation }
export interface SemanticNode {
  id:string; kind:string; label:string; status:string;
  source:'task'|'agent'|'host'|'human'|'captured'|'unavailable';
  branch?:string; data:Record<string,unknown>;
}
export interface SemanticGraph {
  schema:'cairn.graph.v1'; taskId:string; revision:number;
  goal:string; origin:string; constraints:string[]; scope:Task['scope'];
  owner:Task['owner']; status:Task['status']; evidenceMode:EvidenceMode;
  nodes:SemanticNode[]; edges:SemanticEdge[];
  questions:string[]; next?:string; summary?:string; reportSummary?:string;
  validation:Check; review?:Task['review']; reopened?:Task['reopened'];
}

/** Evidence topology is shared by the model graph and the visual graph. */
export function evidenceRelations(task:{evidenceMode?:EvidenceMode;claims:Claim[];criteria:Criterion[]}):EvidenceEdge[] {
  const edges:EvidenceEdge[]=[];
  for(const claim of task.claims){
    if(task.evidenceMode==='curated'&&(claim.basis||claim.references?.length))edges.push({from:`basis:${claim.id}`,to:`claim:${claim.id}`,relation:'basis'});
    for(const id of claim.supports)edges.push({from:`obs:${id}`,to:`claim:${claim.id}`,relation:'supports'});
    for(const id of claim.refutes)edges.push({from:`obs:${id}`,to:`claim:${claim.id}`,relation:'refutes'});
    for(const id of claim.relatedCriteria??[])if(!task.criteria.find(c=>c.id===id)?.claimIds.includes(claim.id))edges.push({from:`claim:${claim.id}`,to:`criterion:${id}`,relation:'addresses'});
  }
  for(const criterion of task.criteria){
    for(const id of criterion.claimIds)edges.push({from:`claim:${id}`,to:`criterion:${criterion.id}`,relation:'criterion'});
    edges.push({from:`criterion:${criterion.id}`,to:'goal',relation:'goal'});
  }
  return edges;
}

/** All persisted semantic content, without UI geometry, raw IO or a host transcript. */
export function semanticGraph(task:Task,validation:Check):SemanticGraph {
  const nodes:SemanticNode[]=[],edges:SemanticEdge[]=[];
  const factRef=(fact:FactVersion)=>({id:fact.id,revision:fact.revision,node:factNodeId(task,fact)});
  const add=(id:string,kind:string,label:string,status:string,source:SemanticNode['source'],data:Record<string,unknown>,branch?:string)=>{
    nodes.push({id,kind,label,status,source,...(branch?{branch}:{}),data});
  };
  const edge=(from:string,to:string,relation:string)=>edges.push({from,to,relation});
  add('origin','origin',task.origin,'known','task',{});
  add('goal','goal',task.goal,task.status,'task',{budget:task.budget});
  for(const c of task.criteria)add(`criterion:${c.id}`,'criterion',c.text,validation.unmet.includes(c.id)?'unmet':'satisfied','task',{id:c.id,claimIds:c.claimIds});
  for(const b of task.branches??[]){
    const run=branchRun(task,b),status=branchStatus(task,b);
    add(`branch:${b.key}`,'branch',b.title,status,'agent',{...b,...(b.sourceFacts?{sourceFacts:b.sourceFacts.map(factRef)}:{}),status,recordedStatus:b.status,activitySource:run?'host':'agent',...(run?{executionId:`agent:${run.epoch}:${run.attempt}:${run.agentId}`}:{})},b.key);
    edge(b.parent?`branch:${b.parent}`:'origin',`branch:${b.key}`,'branch');
  }
  for(const run of task.agentRuns??[]){
    const id=`agent:${run.epoch}:${run.attempt}:${run.agentId}`;
    const status=run.status==='running'&&(run.epoch!==task.owner.epoch||run.host!==task.owner.host)?'stale':run.status;
    add(id,'execution',run.type??'Native child execution',status,'host',{...run,status,recordedStatus:run.status});
    const branch=task.branches?.find(b=>branchRun(task,b)===run);
    edge(branch?`branch:${branch.key}`:'origin',id,branch?'execution':'context');
  }
  for(const work of task.progress??[]){
    const id=`work:${work.source}:${work.key}`;
    const status=task.status!=='active'&&work.status==='running'?(task.status==='suspended'?'blocked':'pending'):work.status;
    add(id,'work',work.title,status,work.source,{...work,status,recordedStatus:work.status},work.branch);
    edge(work.branch?`branch:${work.branch}`:'origin',id,'stage');
  }
  if(task.evidenceMode!=='curated'){
    for(const action of task.actions){
      add(`action:${action.id}`,'action',action.purpose,action.status,'agent',{...action});
      edge('origin',`action:${action.id}`,'context');
      for(const id of action.observationIds)edge(`action:${action.id}`,`obs:${id}`,'result');
    }
    for(const observation of task.observations){
      const {input:_input,output:_output,...metadata}=observation;
      add(`obs:${observation.id}`,'observation',observation.tool,observation.eligible?observation.status:'ineligible','captured',metadata);
    }
  }
  for(const claim of task.claims){
    add(`claim:${claim.id}`,'claim',claim.text,needsReview(task,claim)?'needs_review':claim.status,claim.provenance==='captured'?'captured':'agent',{...claim,...(claim.derivation?{derivation:{...claim.derivation,inputs:claim.derivation.inputs.map(factRef)}}:{}),needsReview:needsReview(task,claim)},claim.branch);
    if(task.evidenceMode==='curated'&&(claim.basis||claim.references?.length)){
      add(`basis:${claim.id}`,'basis',claim.basis??'Referenced material','recorded','agent',{basis:claim.basis??'',references:claim.references??[],scope:claim.scope},claim.branch);
      edge(claim.branch?`branch:${claim.branch}`:'origin',`basis:${claim.id}`,'context');
    }
    edge(claim.branch?`branch:${claim.branch}`:'origin',`claim:${claim.id}`,'membership');
  }
  const topology=explorationTopology(task);
  for(const {id,fact}of topology.versions)add(id,'fact',fact.text,'superseded','agent',{...fact,currentRevision:task.claims.find(claim=>claim.id===fact.id)?.revision});
  for(const {id,derivation,current}of topology.attempts){const branch=task.branches?.find(branch=>branch.key===derivation.branch);add(id,'exploration',branch?.question??branch?.title??derivation.branch,current&&branch?branchStatus(task,branch):'recorded','agent',{...derivation,inputs:derivation.inputs.map(factRef),current},derivation.branch);}
  edges.push(...topology.edges);
  if(task.review)add('global-review','global-review','Review new evidence and feedback',task.review.generation>task.review.acknowledged?'pending':'reviewed','agent',{...task.review});
  for(const hint of task.hints){add(`hint:${hint.id}`,'hint',hint.text,'provided','human',{...hint});edge(`hint:${hint.id}`,'goal','context');}
  edges.push(...evidenceRelations(task));
  const known=new Set(nodes.map(node=>node.id));
  // Broken or privacy-filtered references stay explicit; never look up another task.
  for(const id of new Set(edges.flatMap(e=>[e.from,e.to])))if(!known.has(id)){
    add(id,'unavailable',id,'unavailable','unavailable',{reason:'Reference is unavailable in this task projection'});known.add(id);
  }
  const unique=[...new Map(edges.map(e=>[JSON.stringify([e.from,e.to,e.relation]),e])).values()];
  return {schema:'cairn.graph.v1',taskId:task.id,revision:task.revision,goal:task.goal,origin:task.origin,constraints:task.constraints,scope:task.scope,owner:task.owner,status:task.status,evidenceMode:task.evidenceMode??'captured',nodes,edges:unique,
    questions:task.checkpoint?.questions??[],...(task.checkpoint?.next?{next:task.checkpoint.next}:{}),...(task.checkpoint?.summary?{summary:task.checkpoint.summary}:{}),...(task.report?{reportSummary:task.report.summary}:{}),validation,...(task.review?{review:task.review}:{}),...(task.reopened?{reopened:task.reopened}:{})};
}

/** Evidence-connected selection, including competing findings and branch ancestry. */
export function relatedGraph(graph:SemanticGraph,ref:string) {
  const seed=graph.nodes.find(node=>node.id===ref||node.id===`branch:${ref}`);
  if(!seed)throw new Error('Graph focus does not belong to this task');
  const selected=new Set([seed.id]);
  if(seed.kind==='branch'){
    const branches=new Set([seed.id]);let changed=true;
    while(changed){changed=false;for(const e of graph.edges)if(e.relation==='branch'&&branches.has(e.from)&&!branches.has(e.to)){branches.add(e.to);changed=true;}}
    for(const node of graph.nodes)if(branches.has(node.id)||node.branch&&branches.has(`branch:${node.branch}`))selected.add(node.id);
  }
  const proof=new Set(['basis','supports','refutes','criterion','addresses','result','input','produces','revises']);let changed=true;
  while(changed){
    changed=false;
    for(const e of graph.edges)if(proof.has(e.relation)&&(selected.has(e.from)||selected.has(e.to))){
      for(const id of [e.from,e.to])if(!selected.has(id)){selected.add(id);changed=true;}
    }
  }
  for(const node of graph.nodes)if(selected.has(node.id)&&node.branch)selected.add(`branch:${node.branch}`);
  changed=true;while(changed){changed=false;for(const e of graph.edges)if(e.relation==='branch'&&selected.has(e.to)&&!selected.has(e.from)){selected.add(e.from);changed=true;}}
  selected.add('origin');selected.add('goal');
  for(const node of graph.nodes)if(node.kind==='hint'||node.kind==='global-review')selected.add(node.id);
  for(const e of graph.edges)if(e.relation==='execution'&&selected.has(e.from))selected.add(e.to);
  const nodes=graph.nodes.filter(node=>selected.has(node.id)),edges=graph.edges.filter(e=>selected.has(e.from)&&selected.has(e.to));
  return {...graph,nodes,edges,selection:{ref:seed.id,policy:'evidence-connected',omittedNodes:graph.nodes.length-nodes.length,omittedEdges:graph.edges.length-edges.length}};
}

export function graphIndex(graph:SemanticGraph) {
  return {...graph,nodes:graph.nodes.map(({id,kind,status,source,branch})=>({id,kind,status,source,...(branch?{branch}:{})})),content:'topology-index'};
}

export function graphDelta(before:SemanticGraph,after:SemanticGraph) {
  const old=new Map(before.nodes.map(n=>[n.id,n])),now=new Map(after.nodes.map(n=>[n.id,n]));
  const key=(edge:SemanticEdge)=>JSON.stringify(edge);
  const oldEdges=new Set(before.edges.map(key)),newEdges=new Set(after.edges.map(key));
  const {nodes:_nodes,edges:_edges,...current}=after;
  return {schema:'cairn.graph-delta.v1',taskId:after.taskId,
    added:after.nodes.filter(n=>!old.has(n.id)),updated:after.nodes.filter(n=>old.has(n.id)&&JSON.stringify(old.get(n.id))!==JSON.stringify(n)),removed:before.nodes.filter(n=>!now.has(n.id)).map(n=>n.id),
    addedEdges:after.edges.filter(e=>!oldEdges.has(key(e))),removedEdges:before.edges.filter(e=>!newEdges.has(key(e))),
    current};
}
