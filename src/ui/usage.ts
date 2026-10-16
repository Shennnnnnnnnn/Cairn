import type { Task } from '../core/types.js';
export function usageTime(task:Pick<Task,'createdAt'|'status'|'timing'>,at:number,fallbackEnd:string){
 const timing=task.timing;
 const end=task.status==='completed'?Date.parse(timing?.stoppedAt??fallbackEnd):at;
 return {wallMs:Math.max(0,end-Date.parse(task.createdAt)),activeMs:timing?timing.activeMs+(task.status==='active'&&timing.activeSince?Math.max(0,at-Date.parse(timing.activeSince)):0):null,partial:!!timing&&Date.parse(timing.trackedSince)>Date.parse(task.createdAt)+1000};
}
export function projectUsage(task:Task,at:number,updatedAt:string){
 const usage=task.usage,tokens=usage?.tokens;
 return {tokens:tokens?{...tokens,total:tokens.input+tokens.output}:null,modelCalls:usage?.modelCalls??null,
  toolCalls:usage?.toolCalls??null,cairnCalls:usage?.cairnCalls??null,toolErrors:usage?.toolErrors??null,
  sources:usage?.sources??[],stoppedAt:task.status==='active'?undefined:task.timing?.stoppedAt??updatedAt,...usageTime(task,at,updatedAt)};
}
export type ResourceUsage=ReturnType<typeof projectUsage>;
export function elapsedLabel(ms:number|null){
 if(ms===null)return '—';
 const seconds=Math.max(0,Math.floor(ms/1000)),hours=Math.floor(seconds/3600),minutes=Math.floor(seconds%3600/60);
 return `${hours?`${hours}时 `:''}${minutes}分 ${String(seconds%60).padStart(2,'0')}秒`;
}
