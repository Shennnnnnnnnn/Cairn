// Opt-in real-host tests: uses the CLI's existing model/account, in a temporary workspace.
// Never runs as part of npm test. No model credentials are read or printed here.
import {mkdtempSync,writeFileSync,readFileSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,join,dirname} from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
const host=process.argv[2];if(!['pi','claude','codex'].includes(host))throw new Error('Usage: node scripts/host-smoke.mjs pi|claude|codex');
const root=mkdtempSync(join(tmpdir(),`cairn-live-${host}-`)),entry=resolve('dist/cairn.mjs');
const env={...process.env,PATH:`${dirname(process.execPath)}:/opt/homebrew/bin:/Users/shen/.local/bin:${process.env.PATH??''}`};
const installed=spawnSync(process.execPath,[entry,'install','--target',host,'--root',root],{env,encoding:'utf8'});
if(installed.status!==0)throw new Error(installed.stderr);
const plugin=JSON.parse(installed.stdout).plugin,db=join(root,'.cairn/state.db');
const toml=value=>typeof value==='string'?JSON.stringify(value):Array.isArray(value)?`[${value.map(toml).join(',')}]`:typeof value==='object'?`{${Object.entries(value).map(([k,v])=>`${JSON.stringify(k)}=${toml(v)}`).join(',')}}`:String(value);
writeFileSync(join(root,'evidence.txt'),'cairn-smoke-verified\n');
console.log(JSON.stringify({host,root,plugin}));
async function launch(prompt,phase){
 let command=host,args=[];
 if(host==='pi')args=['--offline','--no-context-files','--no-extensions','--extension',join(plugin,'runtime/pi-extension.mjs'),'--no-skills','--tools','read,cairn_*','--session-dir',join(root,'sessions'),'--mode','json','--thinking','low','-p',prompt];
 if(host==='claude')args=['--plugin-dir',plugin,'--setting-sources','','--tools','default','--allowedTools','Read',...['create','resume','state','evidence','claim','satisfy','action','hint','check','report','complete','suspend','delivery','events','tools','call'].map(n=>`mcp__plugin_cairn_cairn__cairn_${n}`),'--session-id',randomUUID(),'--output-format','stream-json','--verbose','--include-hook-events','--effort','low','--max-budget-usd','3','-p',prompt];
 if(host==='codex')args=['exec','--ignore-user-config','--skip-git-repo-check','--dangerously-bypass-hook-trust','--json','-s','workspace-write','-c','features.hooks=true','-c',`mcp_servers.cairn=${toml({command:process.execPath,args:[join(plugin,'runtime/cairn.mjs'),'mcp','--host','codex'],default_tools_approval_mode:'approve'})}`,'-c',`hooks=${toml(JSON.parse(readFileSync(join(root,'.codex/hooks.json'),'utf8')).hooks)}`,'-c','model_reasoning_effort="low"',prompt];
 const child=spawn(command,args,{cwd:root,env,stdio:['ignore','pipe','pipe']});let stdout='',stderr='';
 child.stdout.on('data',c=>{stdout+=c;});child.stderr.on('data',c=>{stderr+=c;});
 const timer=setTimeout(()=>child.kill('SIGTERM'),150000);
 const code=await new Promise((res,rej)=>{child.on('error',rej);child.on('exit',res);});clearTimeout(timer);
 writeFileSync(join(root,`${phase}.jsonl`),stdout,{mode:0o600});writeFileSync(join(root,`${phase}.stderr`),stderr,{mode:0o600});
 console.log(JSON.stringify({phase,exitCode:code,stdoutBytes:stdout.length,stderrTail:stderr.slice(-1500)}));
 if(code!==0)throw new Error(`Host failed. Inspect ${root}/${phase}.stderr and .jsonl`);
}
await launch('This is a bounded Cairn plugin integration test. Use only this temporary workspace. In order: (1) cairn_create with origin="local fixture", goal="Verify fixture marker", criteria=["The file contains cairn-smoke-verified"]. (2) Read evidence.txt using the native read tool (or a read-only shell command if no Read tool exists), so the Cairn hook captures an observation. (3) cairn_state, use the automatically captured observation id to cairn_claim status=supported, text="The file contains cairn-smoke-verified", supports=[that id], refutes=[]. (4) cairn_satisfy criterion_id=c1 with this claim. (5) cairn_report summary="Fixture marker verified", citations=[{observationId:that id,statement:"The native file read returned the marker"}]. (6) cairn_suspend. Then stop with TEST_SUSPENDED. Use the session_id in Cairn startup context for MCP. Do not manually register evidence, inspect other files, use subagents or perform other tasks.', 'create');
let sql=new DatabaseSync(db),task=JSON.parse(sql.prepare('SELECT state FROM tasks ORDER BY rowid DESC LIMIT 1').get()?.state??'null');sql.close();
if(!task||task.status!=='suspended'||!task.observations.some(o=>o.source==='hook'&&o.eligible)||!task.report)throw new Error(`Native capture/report/suspend assertion failed: ${root}`);
await launch(`Continue the bounded Cairn integration test. Explicitly resume task ${task.id} with cairn_resume takeover=true, read cairn_state, and call cairn_complete. Its evidence-backed report was saved in the prior session. Do not read other files, add new evidence, use subagents or do other work. Return TEST_COMPLETED. Supply the new session_id from startup context to MCP tools.`, 'resume');
sql=new DatabaseSync(db);task=JSON.parse(sql.prepare('SELECT state FROM tasks WHERE id=?').get(task.id).state);sql.close();
if(task.status!=='completed'||task.owner.epoch!==2)throw new Error(`Native completion/recovery assertion failed: ${root}`);
console.log(JSON.stringify({host,ok:true,taskId:task.id,observations:task.observations.length,epoch:task.owner.epoch,root}));
