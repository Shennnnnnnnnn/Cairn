// Opt-in provider compatibility probe; no cases, labels or benchmark answers.
import {mkdtempSync,cpSync,chmodSync,writeFileSync,readFileSync,rmSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
const config=process.argv[2];if(!config)throw new Error('Pass the configured Pi agent directory');
const root=mkdtempSync(join(tmpdir(),'cairn-schema-probe-')),privateConfig=join(root,'agent'),work=join(root,'work');
const {mkdirSync}=await import('node:fs');mkdirSync(privateConfig);mkdirSync(work);chmodSync(privateConfig,0o700);
try{
 for(const file of ['auth.json','models.json'])if(existsSync(join(config,file))){cpSync(join(config,file),join(privateConfig,file));chmodSync(join(privateConfig,file),0o600);}
 const models=JSON.parse(readFileSync(join(privateConfig,'models.json'),'utf8'));for(const provider of Object.values(models.providers??{}))for(const model of provider.models??[])if(model.id==='kimi-k3')model.maxTokens=1024;
 writeFileSync(join(privateConfig,'models.json'),JSON.stringify(models),{mode:0o600});
 writeFileSync(join(privateConfig,'settings.json'),JSON.stringify({defaultProvider:'sub2api-copy-copy',defaultModel:'kimi-k3'}),{mode:0o600});
 const result=spawnSync(process.execPath,['/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js','--offline','--no-extensions','--no-skills','--no-mcp','--no-context-files','--no-prompt-templates','--no-themes','--extension',resolve('dist/pi-extension.mjs'),'--provider','sub2api-copy-copy','--model','kimi-k3','--thinking','off','--mode','json','-p','只回复 SCHEMA_OK，不调用工具。'],{cwd:work,env:{...process.env,PI_CODING_AGENT_DIR:privateConfig,CAIRN_DB:join(work,'state.db'),CAIRN_VERIFY_COMMAND:'',CAIRN_DEADLINE:''},encoding:'utf8',timeout:50000,maxBuffer:1000000});
 const messages=result.stdout.split('\n').flatMap(line=>{try{const e=JSON.parse(line);return e.type==='message_end'&&e.message?.role==='assistant'?[e.message]:[];}catch{return [];}});
 const errors=messages.filter(m=>m.stopReason==='error').map(m=>m.errorMessage),text=messages.flatMap(m=>m.content??[]).filter(c=>c.type==='text').map(c=>c.text).join('\n');
 const ok=result.status===0&&!errors.length&&text.includes('SCHEMA_OK');
 console.log(JSON.stringify({ok,kind:'provider-schema-probe-only',provider:'sub2api-copy-copy',model:'kimi-k3',thinking:'off',maxTokens:1024,exitCode:result.status,errors,usage:messages.map(m=>m.usage),text,processError:result.error?.message}));
 if(!ok)process.exitCode=1;
}finally{rmSync(root,{recursive:true,force:true});}
