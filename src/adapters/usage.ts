import { openSync, closeSync, fstatSync, readSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import type { Engine } from '../core/engine.js';
import type { Host, Session, TokenUsage } from '../core/types.js';
import { emptyTokens, tokenUsage, usageKey } from '../core/usage.js';
const number=(value:unknown)=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0?value:0;
export function piTokens(usage:any):TokenUsage|undefined {
 if(!usage||typeof usage.input!=='number'||typeof usage.output!=='number')return;
 const cacheRead=number(usage.cacheRead),cacheWrite=number(usage.cacheWrite);
 return {input:number(usage.input)+cacheRead+cacheWrite,output:number(usage.output),cacheRead,cacheWrite,reasoning:number(usage.reasoning)};
}
/** Deliberately accept only known numeric usage shapes. No prompts or tool IO escape this adapter. */
export function transcriptUsage(host:Host,row:any):{id:string;tokens:TokenUsage;cumulative?:boolean;modelCall?:boolean}|undefined {
 if(host==='codex'&&row?.type==='event_msg'&&row.payload?.type==='token_count'){
  const u=row.payload.info?.total_token_usage;
  if(!u||typeof u.input_tokens!=='number'||typeof u.output_tokens!=='number')return;
  return {id:'session-total',cumulative:true,tokens:{input:number(u.input_tokens),output:number(u.output_tokens),cacheRead:number(u.cached_input_tokens),cacheWrite:0,reasoning:number(u.reasoning_output_tokens)}};
 }
 if(host==='claude'&&row?.type==='assistant'&&typeof row.message?.id==='string'){
  const u=row.message.usage;
  if(!u||typeof u.input_tokens!=='number'||typeof u.output_tokens!=='number')return;
  const tokens=emptyTokens();tokens.cacheRead=number(u.cache_read_input_tokens);tokens.cacheWrite=number(u.cache_creation_input_tokens);
  tokens.input=number(u.input_tokens)+tokens.cacheRead+tokens.cacheWrite;tokens.output=number(u.output_tokens);
  return {id:`message:${row.message.id}`,tokens,modelCall:true};
 }
}
/** Bounded, incremental compatibility reader; transcript formats are not a host API.
 * Only numeric samples and a hashed file cursor are persisted. Failure leaves usage unknown.
 */
export function syncTranscriptUsage(engine:Engine,session:Session,path:unknown,baseline=false){
 if(!['codex','claude'].includes(session.host)||typeof path!=='string'||!isAbsolute(path))return;
 let fd:number|undefined;
 try{
  fd=openSync(path,'r');const stat=fstatSync(fd);if(!stat.isFile())return;
  const key=`usage:cursor:${usageKey(session,path)}`,identity=`${stat.dev}:${stat.ino}`;
  const cursor=engine.store.config<{identity:string;offset:number}>(key);
  let offset=cursor?.identity===identity&&cursor.offset<=stat.size?cursor.offset:0;
  const max=4*1024*1024;
  let skipFirst=false;
  if(stat.size-offset>max){offset=stat.size-max;skipFirst=true;}
  const data=Buffer.alloc(Math.min(max,stat.size-offset));const length=readSync(fd,data,0,data.length,offset);
  const end=data.lastIndexOf(10,length-1);if(end<0)return;
  let text=data.subarray(0,end+1).toString('utf8');if(skipFirst)text=text.slice(text.indexOf('\n')+1);
  // Each numeric receipt commits atomically. A repeated or older cursor is harmless:
  // receipts deduplicate messages and cannot rewind cumulative counters.
  for(const line of text.split('\n')){
   if(!line.includes('"usage"')&&!line.includes('"token_count"'))continue;
   let row:any;try{row=JSON.parse(line);}catch{continue;}
   const sample=transcriptUsage(session.host,row);
   if(sample)tokenUsage(engine,session,`${sample.id}:${identity}`,sample.tokens,{...sample,baseline:baseline||!cursor,source:`${session.host}/transcript`});
  }
  engine.store.setConfig(key,{identity,offset:offset+end+1});
 }catch{/* Optional metadata must never block a tool, interruption, or completion. */}
 finally{if(fd!==undefined)closeSync(fd);}
}
