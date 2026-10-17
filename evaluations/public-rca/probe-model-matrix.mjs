// Small opt-in protocol probe, isolated from RCA cases and hidden references.
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,cpSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
const here=dirname(fileURLToPath(import.meta.url)),repo=resolve(here,'../..');
const args=Object.fromEntries(process.argv.slice(2).reduce((a,v,i,all)=>v.startsWith('--')?[...a,[v.slice(2),all[i+1]]]:a,[]));
const source=resolve(args['agent-dir']??'/Users/shen/.pi/agent'),provider=args.provider??'sub2api-copy',model=args.model??'global:deepseek-v4.1-flash';
const implementation=resolve(args.implementation??repo);
const root=mkdtempSync(join(tmpdir(),'cairn-model-probe-')),config=join(root,'private-agent'),work=join(root,'workspace');
mkdirSync(config,{mode:0o700});mkdirSync(work);
const save=(name,value)=>writeFileSync(join(root,name),typeof value==='string'?value:JSON.stringify(value,null,2)+'\n',{mode:0o600});
const models=JSON.parse(readFileSync(join(source,'models.json'),'utf8')),entry=models.providers?.[provider],selected=entry?.models.find(m=>m.id===model);
if(!selected)throw new Error('Requested provider/model is absent from the local registry');
cpSync(join(source,'auth.json'),join(config,'auth.json'));
writeFileSync(join(config,'models.json'),JSON.stringify({providers:{[provider]:{...entry,models:[selected]}}}),{mode:0o600});
writeFileSync(join(config,'settings.json'),JSON.stringify({defaultProvider:provider,defaultModel:model}),{mode:0o600});
const cli=args['pi-cli']??'/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js';
const thinking=selected.reasoning?'high':'off';
let raw='',stderr='',timedOut=false;const start=performance.now();
try{
 const cleanEnv={...process.env};delete cleanEnv.CAIRN_DEADLINE;delete cleanEnv.CAIRN_SUBMIT_RESERVE_MS;
 const child=spawn(process.execPath,[cli,'--offline','--no-extensions','--no-skills','--no-mcp','--no-context-files','--no-prompt-templates','--no-themes','--provider',provider,'--model',model,'--thinking',thinking,'--session-id',randomUUID(),'--session-dir',join(root,'sessions'),'--mode','json','--extension',join(implementation,'dist/pi-extension.mjs'),'--skill',join(implementation,'skills/cairn/SKILL.md'),'--tools','cairn_*','-p','这是无领域答案的接入探针。给定原始输入 marker=alpha。只做：cairn_start（一个条件：保留给定 marker）；cairn_checkpoint 保存一条 keyed supported Finding（basis 为本提示给定的输入、covers:["c1"]）；cairn_finish {}。不要调用其他工具，不读取任何其他资料。'],{cwd:work,env:{...cleanEnv,PATH:`${dirname(process.execPath)}:/opt/homebrew/bin:/usr/bin:/bin`,PI_CODING_AGENT_DIR:config,CAIRN_DB:join(work,'.cairn/state.db'),CAIRN_VERIFY_COMMAND:'',CAIRN_VERIFY_ARTIFACTS:''},stdio:['ignore','pipe','pipe'],detached:true});
 child.stdout.on('data',d=>{raw+=d;});child.stderr.on('data',d=>{stderr+=d;});
 const exit=await new Promise(resolve=>{child.on('close',(code,signal)=>resolve({code,signal}));child.on('error',()=>resolve({code:null,signal:'launch-error'}));});
 save('raw.jsonl',raw);save('stderr.log',stderr);
 const events=raw.split('\n').flatMap(l=>{try{return[JSON.parse(l)];}catch{return[];}}),messages=events.filter(e=>e.type==='message_end'&&e.message?.role==='assistant').map(e=>e.message);
 const usage=Object.fromEntries(['input','output','cacheRead','cacheWrite','totalTokens'].map(k=>[k,messages.reduce((n,m)=>n+(m.usage?.[k]??0),0)]));
 const db=new DatabaseSync(join(work,'.cairn/state.db'),{readOnly:true});let tasks;try{tasks=db.prepare('SELECT state FROM tasks').all().map(r=>JSON.parse(r.state));}finally{db.close();}
 const result={kind:'Unbudgeted model/API/schema probe; no RCA cases or reference labels',implementation,requestedThinking:thinking,root,provider,model,actualModels:[...new Set(messages.map(m=>`${m.provider}/${m.model}`))],thinking:[...new Set(messages.map(m=>m.thinkingLevel).filter(Boolean))],wallSeconds:(performance.now()-start)/1000,exit,timedOut,usage,usageIsLowerBound:timedOut||exit.code!==0||messages.some(m=>m.stopReason==='error'),success:exit.code===0&&tasks.some(t=>t.status==='completed'&&t.claims.length>=1),toolErrors:events.filter(e=>e.type==='tool_execution_end'&&e.isError).length};
 save('probe.metrics.json',result);console.log(JSON.stringify(result));if(!result.success)process.exitCode=1;
}finally{rmSync(config,{recursive:true,force:true});}
