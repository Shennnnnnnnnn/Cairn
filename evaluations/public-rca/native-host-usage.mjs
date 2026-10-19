import fs from 'node:fs';import {zstdDecompressSync} from 'node:zlib';
const [host,p]=process.argv.slice(2);if(!['pi','claude','dsh','codex'].includes(host)||!p)throw Error('Expected host pi|claude|dsh|codex and an exact native session path');let text='';
if(host==='dsh'){const b=fs.readFileSync(p);let offset=0;while(offset<b.length){const r=zstdDecompressSync(b.subarray(offset),{info:true});if(!(r.engine.bytesWritten>0))throw Error('No decoder progress');offset+=r.engine.bytesWritten;text+=r.buffer.toString('utf8');}}
else text=fs.readFileSync(p,'utf8');
const rows=text.trim().split('\n').filter(Boolean).map(JSON.parse),samples=new Map(),models=new Set(),providers=new Set(),extras=[];let attempts=0;
if(host==='codex'){
 let cumulative,sessionId;const efforts=new Set(),counts=new Set();
 for(const r of rows){
  if(r.type==='session_meta'){sessionId=r.payload?.id;if(r.payload?.model_provider)providers.add(r.payload.model_provider);}
  if(r.type==='turn_context'){if(r.payload?.model)models.add(r.payload.model);const e=r.payload?.effort??r.payload?.reasoning_effort;if(e)efforts.add(e);}
  if(r.type==='event_msg'&&r.payload?.type==='token_count'){
   const u=r.payload.info?.total_token_usage;
   if(u&&Number.isFinite(u.input_tokens)&&Number.isFinite(u.output_tokens)){cumulative=u;counts.add(JSON.stringify(u));}
  }
  if(r.type==='event_msg'&&['turn_aborted','error'].includes(r.payload?.type))attempts++;
 }
 // Codex records cumulative input including cached input; reasoning is already
 // part of output. Repeated cumulative snapshots must never be summed.
 const tokens=cumulative?{input:cumulative.input_tokens,output:cumulative.output_tokens,cacheRead:cumulative.cached_input_tokens??0,cacheWrite:cumulative.cache_write_input_tokens??0,total:cumulative.input_tokens+cumulative.output_tokens}:null;
 console.log(JSON.stringify({host,rows:rows.length,sessionId,models:[...models],providers:[...providers],efforts:[...efforts],modelCalls:counts.size,tokens,unknownUsageAttempts:attempts,usageLowerBound:!tokens||attempts>0,auxiliaryEvents:[]}));
 process.exit(0);
}
for(const [i,r]of rows.entries()){
 let usage,id,model,provider;
 if(host==='dsh'){
  if(r.type==='assistant/attempt')attempts++;
  if(r.type==='session/title-llm-request')extras.push({type:r.type,keys:Object.keys(r.data??{}),usage:r.data?.usage});
  if(r.type!=='assistant/message')continue;usage=r.data.usage;id=String(r.seq);model=r.data.message?.source?.model;provider=r.data.message?.source?.provider;
 }else{
  if(r.type!=='assistant'&&r.message?.role!=='assistant')continue;if(r.message?.errorMessage||r.isApiErrorMessage)attempts++;usage=r.message.usage;id=host==='claude'?r.message.id:String(r.message.timestamp??r.id??i);model=r.message.model;provider=r.message.provider;
 }
 if(model)models.add(model);if(provider)providers.add(provider);if(!usage)continue;
 const normalized=host==='dsh'?{input:usage.inputTokens,output:usage.outputTokens,cacheRead:usage.cacheReadTokens??0,cacheWrite:usage.cacheWriteTokens??0}:host==='pi'?{input:usage.input,output:usage.output,cacheRead:usage.cacheRead??0,cacheWrite:usage.cacheWrite??0}:{input:usage.input_tokens,output:usage.output_tokens,cacheRead:usage.cache_read_input_tokens??0,cacheWrite:usage.cache_creation_input_tokens??0};
 if(!Number.isFinite(normalized.input)||!Number.isFinite(normalized.output))continue;
 const prior=samples.get(id)??{};for(const k of Object.keys(normalized))prior[k]=Math.max(prior[k]??0,normalized[k]);samples.set(id,prior);
}
const sum={input:0,output:0,cacheRead:0,cacheWrite:0};for(const s of samples.values())for(const k of Object.keys(sum))sum[k]+=s[k];sum.input+=sum.cacheRead+sum.cacheWrite;sum.total=sum.input+sum.output;
console.log(JSON.stringify({host,rows:rows.length,sessionId:rows[0]?.id,models:[...models],providers:[...providers],modelCalls:samples.size,tokens:sum,unknownUsageAttempts:attempts,usageLowerBound:attempts>0||extras.some(e=>!e.usage),auxiliaryEvents:extras}));
