import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {zstdCompressSync} from 'node:zlib';
const script=resolve('evaluations/public-rca/native-host-usage.mjs');
function read(host:string,content:Buffer|string){
 const dir=mkdtempSync(join(tmpdir(),'cairn-host-ledger-')),file=join(dir,'session');
 try{writeFileSync(file,content);const r=spawnSync(process.execPath,[script,host,file],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout);}finally{rmSync(dir,{recursive:true,force:true});}
}
test('DSH accounting decodes every appended zstd frame and labels unreported auxiliary usage',()=>{
 const header={type:'session',id:'actual-native'},event={type:'assistant/message',seq:2,data:{message:{source:{model:'fixture',provider:'fixture'}},usage:{inputTokens:5,outputTokens:2,cacheReadTokens:3}}};
 const frames=[header,event,{type:'assistant/attempt',seq:3,data:{}},{type:'session/title-llm-request',data:{}}].map(r=>zstdCompressSync(JSON.stringify(r)+'\n'));
 const r=read('dsh',Buffer.concat(frames));assert.equal(r.rows,4);assert.equal(r.tokens.input,8);assert.equal(r.tokens.total,10);assert.equal(r.unknownUsageAttempts,1);assert.equal(r.usageLowerBound,true);
});
test('Claude split messages are deduplicated and cache remains a disjoint input component',()=>{
 const event={type:'assistant',message:{role:'assistant',id:'same-response',model:'fixture',usage:{input_tokens:5,output_tokens:2,cache_read_input_tokens:3}}};
 const r=read('claude',[event,event].map(r=>JSON.stringify(r)).join('\n'));assert.equal(r.modelCalls,1);assert.equal(r.tokens.input,8);assert.equal(r.tokens.total,10);
});
test('Codex uses the final cumulative snapshot without adding cached or reasoning tokens again',()=>{
 const snapshot=(input:number,output:number)=>({type:'event_msg',payload:{type:'token_count',info:{total_token_usage:{input_tokens:input,output_tokens:output,cached_input_tokens:8,reasoning_output_tokens:3}}}});
 const rows=[{type:'session_meta',payload:{id:'native-thread',model_provider:'openai'}},{type:'turn_context',payload:{model:'fixture',effort:'xhigh'}},snapshot(10,4),snapshot(30,9),snapshot(30,9)];
 const r=read('codex',rows.map(x=>JSON.stringify(x)).join('\n'));assert.equal(r.tokens.input,30);assert.equal(r.tokens.total,39);assert.equal(r.tokens.cacheRead,8);assert.equal(r.modelCalls,2);assert.equal(r.sessionId,'native-thread');assert.deepEqual(r.efforts,['xhigh']);
});
test('Codex missing usage remains unknown rather than zero',()=>{
 const r=read('codex',JSON.stringify({type:'session_meta',payload:{id:'native-thread'}}));assert.equal(r.tokens,null);assert.equal(r.usageLowerBound,true);
});
