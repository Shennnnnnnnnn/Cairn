import { createHash } from 'node:crypto';
import type { Engine } from './engine.js';
import type { Session, Task, TokenUsage } from './types.js';

export const emptyTokens=():TokenUsage=>({input:0,output:0,cacheRead:0,cacheWrite:0,reasoning:0});
export const usageKey=(session:Session,id:string)=>createHash('sha256').update(JSON.stringify([session.host,session.sessionId,session.cwd,id])).digest('hex');
const validTokens=(tokens:TokenUsage)=>Object.values(tokens).every(value=>Number.isSafeInteger(value)&&value>=0)&&tokens.cacheRead+tokens.cacheWrite<=tokens.input&&tokens.reasoning<=tokens.output;
function owner(engine:Engine,session:Session):Task|undefined {
 const binding=engine.store.session(session),task=engine.active(session);
 return task&&binding?.epoch===task.owner.epoch&&task.owner.host===session.host&&task.owner.sessionId===session.sessionId&&task.owner.cwd===session.cwd?task:undefined;
}
function save(engine:Engine,task:Task,source:string,delta:Partial<{tokens:TokenUsage;modelCalls:number;toolCalls:number;cairnCalls:number;toolErrors:number}>){
 const totals=task.usage??{sources:[],updatedAt:engine.at()};
 if(delta.tokens){totals.tokens??=emptyTokens();for(const key of Object.keys(delta.tokens) as (keyof TokenUsage)[])totals.tokens[key]+=delta.tokens[key];}
 for(const key of ['modelCalls','toolCalls','cairnCalls','toolErrors'] as const)if(delta[key]!==undefined)totals[key]=(totals[key]??0)+delta[key];
 if(!totals.sources.includes(source))totals.sources.push(source);
 totals.updatedAt=engine.at();task.usage=totals;
 // Usage cannot invalidate a semantic completion check or trigger a review loop.
 engine.store.save(task,'usage.updated',{source,delta},engine.at());
}
/** Reserve only an opaque dedup key before dispatch, count once on actual return. */
export function toolUsage(engine:Engine,session:Session,id:string,phase:'start'|'end',cairn:boolean,isError=false,allowUnbound=false){
 if(!id)return;
 engine.store.transaction(()=>{
  const key=usageKey(session,`tool:${id}`),row=engine.store.db.prepare('SELECT * FROM usage_samples WHERE key=?').get(key);
  const prior=row?JSON.parse(row.value as string):undefined;
  if(prior?.done||!row&&!allowUnbound&&phase==='end')return;
  let task=row?.task_id?engine.store.get(row.task_id as string):owner(engine,session);
  if(!task||row&&Number(row.epoch)!==task.owner.epoch||task.owner.host!==session.host||task.owner.sessionId!==session.sessionId||task.owner.cwd!==session.cwd)return;
  if(!row&&task.status!=='active'||phase==='start'&&task.status!=='active')return;
  engine.store.db.prepare('INSERT INTO usage_samples VALUES (?,?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,task.id,task.owner.epoch,JSON.stringify({done:phase==='end',cairn:prior?.cairn??cairn}));
  if(phase==='end')save(engine,task,`${session.host}/native`,{toolCalls:(prior?.cairn??cairn)?0:1,cairnCalls:(prior?.cairn??cairn)?1:0,toolErrors:isError?1:0});
 });
}
/** A host message ID or cumulative stream ID, never text supplied by the model. */
export function tokenUsage(engine:Engine,session:Session,id:string,tokens:TokenUsage,options:{baseline?:boolean;cumulative?:boolean;modelCall?:boolean;source?:string;binding?:{taskId:string;epoch:number}}={}){
 if(!id||!validTokens(tokens))return;
 engine.store.transaction(()=>{
  const key=usageKey(session,`tokens:${id}`),row=engine.store.db.prepare('SELECT * FROM usage_samples WHERE key=?').get(key);
  const previous:TokenUsage|undefined=row?JSON.parse(row.value as string).tokens:undefined;
  const next=emptyTokens(),delta=emptyTokens();
  for(const field of Object.keys(next) as (keyof TokenUsage)[]){next[field]=Math.max(previous?.[field]??0,tokens[field]);delta[field]=next[field]-(previous?.[field]??0);}
  const task=owner(engine,session),attribution=options.cumulative?task:row?(row.task_id&&task?.id===row.task_id&&task.owner.epoch===Number(row.epoch)?task:undefined):task;
  // Ignore older cumulative reports; a new native stream needs a new sample ID.
  const reset=options.cumulative&&previous&&(tokens.input<previous.input||tokens.output<previous.output);
  if(reset)return; // An older concurrent hook cannot rewind a cumulative baseline.
  engine.store.db.prepare('INSERT INTO usage_samples VALUES (?,?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,options.baseline?null:task?.id??null,task?.owner.epoch??null,JSON.stringify({tokens:next}));
  const bound=attribution&&options.binding?.taskId===attribution.id&&options.binding.epoch===attribution.owner.epoch;
  if(options.baseline||options.cumulative&&!previous||!attribution||attribution.status!=='active'&&!bound||previous&&!Object.values(delta).some(Boolean))return;
  save(engine,attribution,options.source??`${session.host}/native`,{tokens:delta,...(options.modelCall&&!previous?{modelCalls:1}:{})});
 });
}
