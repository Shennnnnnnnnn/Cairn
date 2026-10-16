#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { Store } from './core/store.js';
import { Engine } from './core/engine.js';
import { CairnError, publicTask, type Host, type Session } from './core/types.js';
import { database } from './paths.js';
import { startMcp } from './mcp.js';
import { normalize, handleNative, hookOutput, observedCapabilities } from './adapters/hooks.js';
import { install, uninstall, installationStatus, type Target } from './install.js';
import { ToolRuntime } from './tools.js';
import { gatewaySchema, Gateway } from './gateway.js';
import { markdown, html } from './export.js';
import { startUi } from './ui/server.js';
import { uiDatabase, rememberUiDatabase, forgetUiDatabase } from './ui/preferences.js';
import { mcpDatabase, rememberMcpDatabase, forgetMcpDatabase } from './mcp-preferences.js';
import { installMultica, uninstallMultica, multicaStatus } from './multica.js';
import { VERSION } from './version.js';
import { prepareDemo, runDemo } from './demo.js';
import { startDemoTools } from './demo-tools.js';

const shellQuote=(value:string)=>`'${value.replaceAll("'", "'\\''")}'`;
async function demonstration(v:{root?:string;port?:string;delay?:string;prepare?:boolean;'no-ui'?:boolean;target?:string;db?:string;json?:boolean}) {
 if(v.db)throw new CairnError('invalid_input','The demo uses its own new database. Choose a fresh directory with --root instead of --db.');
 if(v.target&&!v.prepare)throw new CairnError('invalid_input','Use --target with demo --prepare to prepare a real CLI workspace.');
 if(v.target&&!['pi','claude','codex'].includes(v.target))throw new CairnError('invalid_input','--target must be pi, claude or codex');
 const delayMs=Number(v.delay??1500),port=Number(v.port??8000);
 if(!Number.isInteger(delayMs)||delayMs<0||delayMs>60000)throw new CairnError('invalid_input','--delay must be an integer from 0 to 60000 milliseconds');
 if(!Number.isInteger(port)||port<0||port>65535)throw new CairnError('invalid_input','--port must be an integer from 0 to 65535; use 0 for a free port');
 const entry=fileURLToPath(import.meta.url),prepared=await prepareDemo(v.root,entry);
 if(v.prepare){
  const installed=v.target?install(v.target as Target,'project',prepared.root):undefined;
  const result={...prepared,prepared:true,demo:true,installed};
  if(v.json)process.stdout.write(JSON.stringify(result)+'\n');
  else process.stdout.write(`样例工作区已准备：${prepared.root}\n模拟数据与原始工具已配置，尚未调用模型。\n\n  cd ${shellQuote(prepared.root)}\n  export CAIRN_DB=${shellQuote(prepared.db)}\n  unset CAIRN_WORKSPACE\n${v.target?`  ${v.target}\n`:'  cairn install --target codex  # 或 pi、claude\n'}\n让 Agent 读取 PROMPT.md 并执行；宿主的账号、审批和 hooks 信任设置仍然生效。\n看板：cairn ui --db ${shellQuote(prepared.db)}\n完成样例后使用新终端，或 unset CAIRN_DB。\n`);
  return;
 }
 const controller=new AbortController();let signalName='SIGINT',store:Store|undefined,dashboard:Awaited<ReturnType<typeof startUi>>|undefined;
 const interrupt=(name:string)=>{signalName=name;controller.abort();};
 const onInt=()=>interrupt('SIGINT'),onTerm=()=>interrupt('SIGTERM');
 process.once('SIGINT',onInt);process.once('SIGTERM',onTerm);
 try{
  if(!v['no-ui']){
   store=new Store(prepared.db);dashboard=await startUi(new Engine(store),{port});
  }
  if(!v.json)process.stdout.write(`Cairn 完整链路演示（固定步骤＋模拟数据，不调用模型）\n工作区：${prepared.root}\n${dashboard?`蓝白看板：${dashboard.url}\n`:'看板未启动。\n'}\n`);
  let linked=false;
  const result=await runDemo({...prepared,entry,delayMs,signal:controller.signal,onStep:step=>{
   if(v.json)return;
   process.stdout.write(`${String(step.seq).padStart(2,'0')}. ${step.name}${step.detail?` · ${typeof step.detail==='string'?step.detail:JSON.stringify(step.detail)}`:''}\n`);
   if(dashboard&&step.taskId&&!linked){linked=true;process.stdout.write(`    任务图：${dashboard.url}/#${step.taskId}\n`);}
  }});
  if(v.json)process.stdout.write(JSON.stringify({...result,url:dashboard?.url,demo:true})+'\n');
  else process.stdout.write(`\n演示完成：${result.taskId}\n报告：${result.reportPath}\n证据图：${result.evidencePath}\n执行日志：${result.executionPath}\n${dashboard?'看板继续显示结果，按 Ctrl+C 关闭。\n':`重看链路：cairn ui --db ${shellQuote(prepared.db)}\n`}`);
  if(dashboard&&!controller.signal.aborted)await new Promise<void>(resolve=>controller.signal.addEventListener('abort',()=>resolve(),{once:true}));
 }catch(error){
  if(!controller.signal.aborted)throw error;
  if(!v.json)process.stdout.write('\n演示已中断，已记录的进度保留在样例工作区。\n');
  process.exitCode=signalName==='SIGTERM'?143:130;
 }finally{
  process.removeListener('SIGINT',onInt);process.removeListener('SIGTERM',onTerm);
  await dashboard?.close();store?.close();
 }
}

export async function main(argv=process.argv.slice(2)){
 const command=argv[0]??'help';
 if(['--version','-v','version'].includes(command)){process.stdout.write(`${VERSION}\n`);return;}
 const {values:v,positionals}=parseArgs({args:argv.slice(1),allowPositionals:true,options:{target:{type:'string'},agent:{type:'string'},'workspace-id':{type:'string'},adopt:{type:'boolean'},scope:{type:'string'},root:{type:'string'},host:{type:'string'},port:{type:'string'},remember:{type:'boolean'},forget:{type:'boolean'},prepare:{type:'boolean'},'no-ui':{type:'boolean'},delay:{type:'string'},'session-id':{type:'string'},db:{type:'string'},file:{type:'string'},input:{type:'string'},'task-id':{type:'string'},format:{type:'string'},out:{type:'string'},'takeover':{type:'boolean'},'json':{type:'boolean'},reason:{type:'string'},author:{type:'string'},invalidate:{type:'string'}}});
 if((v.remember||v.forget)&&!['ui','mcp'].includes(command))throw new CairnError('invalid_input','--remember and --forget are only available for cairn ui or cairn mcp');
 if(v.remember&&v.forget)throw new CairnError('invalid_input','Use either --remember or --forget');
 if((v.agent||v['workspace-id']||v.adopt)&&(!['install','update','uninstall','doctor'].includes(command)||v.target!=='multica'))throw new CairnError('invalid_input','--agent, --workspace-id and --adopt require --target multica on an installation or doctor command');
 const output=(value:unknown)=>process.stdout.write(JSON.stringify(value??{ok:true},null,2)+'\n');
 if(command==='help'||command==='--help'){
  process.stdout.write(`Cairn ${VERSION} — goals and evidence for Pi, Claude Code and Codex\n\nNode >=24 required. Install globally from the repository with npm run install:global.\n\n  cairn --version\n  cairn demo [--port 8000] [--delay 1500] [--no-ui] [--json]\n  cairn demo --prepare [--target pi|claude|codex] [--root NEW_DIR]\n  cairn install|update|uninstall --target pi|claude|codex [--scope project|user] [--root DIR]\n  cairn install --target multica --agent NAME [--workspace-id ID] [--adopt]\n  cairn update|uninstall|doctor --target multica\n  cairn doctor [--target pi|claude|codex] [--scope project|user] [--root DIR]\n  cairn ui                         # open the remembered dashboard or current workspace\n  cairn ui --db FILE --remember    # remember a dashboard database once\n  cairn ui --forget                # clear the remembered database and exit\n  cairn ui [--port 8000] [--db FILE]\n  cairn mcp                        # generic MCP, automatic connection identity\n  cairn mcp --db FILE --remember   # remember the generic MCP database\n  cairn mcp --forget               # clear the generic MCP preference and exit\n  cairn mcp --host pi|claude|codex [--session-id ID] [--db FILE]\n  cairn hook --host claude|codex     # native hook JSON on stdin\n  cairn configure --file whitelist.json\n  cairn task list|show|resume [ID] --host HOST --session-id ID [--takeover]\n  cairn task hint ID \"提示内容\" [--author human]\n  cairn task suspend ID            # human pause; invalidates worker leases\n  cairn task reopen ID --reason \"外部验证反馈\" [--invalidate finding-key]\n  cairn call TOOL --input args.json --host HOST --session-id ID\n  cairn confirm TASK_ID            # human team confirmation after platform receipt\n  cairn export TASK_ID [--format json|markdown|html] [--out FILE]\n\nTask database defaults to <workspace>/.cairn/state.db. CAIRN_DB overrides it.\nUI database: --db > CAIRN_DB > remembered dashboard > workspace database.\nGeneric MCP: --db > CAIRN_DB > remembered MCP database > workspace database.\nNative adapters keep real host identity and workspace database selection.\nWithout --port, UI tries 8000 and selects a free port if occupied.\nDemo always creates a separate workspace/database and uses labelled simulated data.\n`);return;
 }
 if(command==='demo'){await demonstration(v);return;}
 if(command==='demo-tools'){
  if(!v.root)throw new CairnError('invalid_input','demo-tools needs --root for its generated scenario');
  const server=await startDemoTools(resolve(v.root));
  let closing:Promise<void>|undefined;
  const close=()=>closing??=server.close();
  process.once('SIGTERM',()=>{void close().finally(()=>process.exit(0));});
  process.once('SIGINT',()=>{void close().finally(()=>process.exit(0));});
  if(process.stdin.readableEnded)await close();else process.stdin.once('end',()=>{void close().catch(error=>{process.stderr.write(`Cairn demo tools: ${error.message}\n`);process.exitCode=1;});});return;
 }
 if(['install','update','uninstall'].includes(command)){
  if(v.target==='multica'){
   if(v.scope&&v.scope!=='user')throw new CairnError('invalid_input','Multica connects a runtime user; use --scope user or omit it');
   const options={agent:v.agent,workspaceId:v['workspace-id'],db:v.db,adopt:v.adopt,root:v.root};
   if(command==='uninstall'){output(uninstallMultica(options));return;}
   const result=installMultica(options);
   if(result.installed){rememberMcpDatabase(result.database);rememberUiDatabase(result.database);}
   output(result);return;
  }
  if(!['pi','claude','codex'].includes(v.target??''))throw new CairnError('invalid_input','--target pi|claude|codex|multica is required');
  if(v.db)throw new CairnError('invalid_input','--db on installation commands is only supported for --target multica');
  if(v.scope&&!['project','user'].includes(v.scope))throw new CairnError('invalid_input','Invalid scope');
  const target=v.target as Target,scope=(v.scope??'project') as 'project'|'user';
  output(command==='uninstall'?uninstall(target,scope,v.root):install(target,scope,v.root));return;
 }
 if(command==='ui'&&v.forget){
  if(v.db||v.port||v.host||v.root)throw new CairnError('invalid_input','--forget clears the remembered dashboard and exits; do not combine it with startup options');
  forgetUiDatabase();process.stdout.write('已清除默认看板。下次 cairn ui 将读取当前工作区数据库。\n');return;
 }
 if(command==='mcp'&&v.forget){
  if(v.db||v.root||v['session-id']||v.host&&v.host!=='mcp')throw new CairnError('invalid_input','--forget clears the generic MCP database preference and exits; do not combine it with startup options');
  forgetMcpDatabase();process.stdout.write('已清除通用 MCP 默认数据库。\n');return;
 }
 if(command==='doctor'&&v.target==='multica'){output(multicaStatus({agent:v.agent,workspaceId:v['workspace-id'],root:v.root}));return;}
 let hookEvent:any;
 if(command==='hook')hookEvent=JSON.parse(readFileSync(0,'utf8'));
 const host=(command==='ui'?'mcp':v.host??process.env.CAIRN_HOST??'mcp') as Host;
 if(!['pi','claude','codex','mcp'].includes(host))throw new CairnError('invalid_input','Invalid host');
 if(command==='mcp'&&v.remember&&host!=='mcp')throw new CairnError('invalid_input','Only generic --host mcp uses a remembered MCP database; native adapters use their workspace configuration');
 const cwd=hookEvent?.cwd??v.root??process.cwd();
 const selectedDatabase=command==='ui'?uiDatabase(cwd,v.db):command==='mcp'&&host==='mcp'?mcpDatabase(cwd,v.db):v.db?resolve(v.db):database(cwd);
 const store=new Store(selectedDatabase),engine=new Engine(store);
 const session:Session={host,cwd,sessionId:v['session-id']??(command==='mcp'&&host==='mcp'?`mcp-${randomUUID()}`:'')};
 try{
  if(command==='ui'){
   let dashboard:Awaited<ReturnType<typeof startUi>>|undefined,usedFreePort=false;
   try{
    try{dashboard=await startUi(engine,{host:v.host??'127.0.0.1',port:v.port===undefined?8000:Number(v.port)});}
    catch(error){
     if(v.port!==undefined||(error as NodeJS.ErrnoException).code!=='EADDRINUSE')throw error;
     dashboard=await startUi(engine,{host:v.host??'127.0.0.1',port:0});usedFreePort=true;
    }
    if(v.remember)rememberUiDatabase(selectedDatabase);
   }catch(error){await dashboard?.close();store.close();throw error;}
   process.stdout.write(`${usedFreePort?'默认端口 8000 已被占用，已自动选择可用端口。\n':''}Cairn 关系图看板：${dashboard.url}\n数据库：${selectedDatabase}\n${v.remember?'已记住此看板，以后直接运行 cairn ui。\n':''}打开浏览器查看；CLI 中的新进展会自动同步。按 Ctrl+C 关闭看板。\n`);
   let closing=false;
   const close=()=>{if(closing)return;closing=true;void dashboard!.close().finally(()=>{store.close();process.exit(0);});};
   process.once('SIGTERM',close);process.once('SIGINT',close);return;
  }
  if(command==='mcp'){
   let server:Awaited<ReturnType<typeof startMcp>>|undefined;
   try{server=await startMcp(engine,session);if(v.remember)rememberMcpDatabase(selectedDatabase);}
   catch(error){await server?.close();store.close();throw error;}
   let closing:Promise<void>|undefined;
   const close=()=>closing??=(async()=>{try{await server!.close();}finally{store.close();}})();
   process.once('SIGTERM',()=>{void close().finally(()=>process.exit(0));});
   process.once('SIGINT',()=>{void close().finally(()=>process.exit(0));});
   // EOF must also release upstream processes, not wait for the host to force termination.
   if(process.stdin.readableEnded)await close();else process.stdin.once('end',()=>{void close().catch(error=>{process.stderr.write(`Cairn MCP close: ${error.message}\n`);process.exitCode=1;});});
   return;
  }
  if(command==='hook'){
   const event=normalize(host,hookEvent);output(hookOutput(event,handleNative(engine,host,event)));return;
  }
  if(command==='configure'){if(!v.file)throw new CairnError('invalid_input','--file is required');const config=gatewaySchema.parse(JSON.parse(readFileSync(v.file,'utf8')));store.setConfig('gateway',config);output({configured:config.tools.map(t=>({name:t.name,role:t.role}))});return;}
  if(command==='call'){
   if(!positionals[0]||!v.input)throw new CairnError('invalid_input','Supply TOOL --input FILE');
   const runtime=new ToolRuntime(engine,session);
   try{output(await runtime.invoke(positionals[0],JSON.parse(readFileSync(v.input,'utf8'))));}finally{await runtime.close();}return;
  }
  if(command==='confirm'){engine.confirm(positionals[0]??'');output({confirmed:positionals[0]});return;}
  if(command==='export'){
   const task=publicTask(store.get(positionals[0]??v['task-id']??''));
   if(v.format&&!['json','markdown','html'].includes(v.format))throw new CairnError('invalid_input','Unknown export format');
   const content=v.format==='html'?html(task):v.format==='markdown'?markdown(task):JSON.stringify(task,null,2)+'\n';
   if(v.out){writeFileSync(resolve(v.out),content,{mode:0o600});output({path:resolve(v.out)});}else process.stdout.write(content);return;
  }
  if(command==='task'){
   const [operation,taskId]=positionals;
   if(operation==='list')output(store.list());else if(operation==='show')output(engine.context(taskId??''));
   else if(operation==='resume'){if(!session.sessionId)throw new CairnError('session_required','--session-id is required');output(engine.resume(taskId??'',session,v.takeover));}
   else if(operation==='suspend')output(session.sessionId?engine.finish(taskId??'',session,{outcome:'suspended'}):engine.suspendByHuman(taskId??''));
   else if(operation==='reopen'){
    const task=store.get(taskId??'');
    if(!v.reason)throw new CairnError('invalid_input','Supply --reason for external verification feedback');
    const reopened=engine.reopen(task.id,session.sessionId?session:task.owner,v.reason,{takeover:!!v.takeover,invalidate:v.invalidate?[v.invalidate]:[],author:'human'});output(engine.context(reopened.id));
   }
   else if(operation==='hint'){
    const hint=v.input?JSON.parse(readFileSync(v.input,'utf8')):{text:positionals.slice(2).join(' '),author:v.author??'human'};
    if(typeof hint.text!=='string'||!hint.text.trim()||typeof hint.author!=='string'||!hint.author.trim())throw new CairnError('invalid_input','Hint text and human author are required');
    output(engine.addHint(taskId??'',hint.text,hint.author));
   }else throw new CairnError('invalid_input','Unknown task operation');return;
  }
  if(command==='doctor'){
   const targets=(v.target?[v.target]:['pi','claude','codex']) as Target[];
   if(targets.some(t=>!['pi','claude','codex'].includes(t)))throw new CairnError('invalid_input','Invalid target');
   const results=targets.map(t=>{
    const status=installationStatus(t,(v.scope??'project') as any,v.root);
    const sessions=store.db.prepare('SELECT seen,capabilities FROM sessions WHERE host=? AND cwd=? ORDER BY rowid').all(t,cwd).map(r=>({seen:JSON.parse(r.seen as string),capabilities:JSON.parse(r.capabilities as string)}));
    const latest=sessions.at(-1);
    return {...status,declaredCapabilities:latest?.capabilities??{},observedCapabilities:observedCapabilities(latest?.seen??{}),observedEvents:sessions.map(s=>s.seen),hooksTrust:latest?.seen.SessionStart?'startup_observed':'not_observed',coverage:t==='codex'?'Local function and MCP tools; hosted tools may bypass hooks.':'Native events only; cairn_tool_* calls are recorded by the gateway.'};
   });
   const client=new Client({name:'cairn-doctor',version:VERSION});let mcp:any;
   try{
    const entry=fileURLToPath(import.meta.url);
    await client.connect(new StdioClientTransport({command:process.execPath,args:[entry,'mcp','--db',v.db??database(cwd),'--host','mcp','--session-id','doctor'],stderr:'pipe'}),{timeout:10000});
    const tools=await client.listTools();mcp={ok:true,tools:tools.tools.length};
   }catch(error){mcp={ok:false,error:(error as Error).message};}finally{await client.close().catch(()=>{});}
   let upstream:any={ok:false,reason:'No whitelist configured'};
   if(store.config('gateway')){
    const gateway=new Gateway(engine);
    try{upstream={ok:true,tools:(await gateway.list()).length};}catch(error){upstream={ok:false,error:(error as Error).message};}finally{await gateway.close();}
   }
   output({node:process.version,database:v.db??database(cwd),mcp,hosts:results,upstream,strictReady:upstream.ok&&mcp.ok&&results.every(r=>r.installed&&r.runtimeExists&&r.version&&Object.values(r.observedCapabilities).every(Boolean)),whitelist:!!store.config('gateway')});return;
  }
  throw new CairnError('invalid_input',`Unknown command ${command}`);
 }finally{if(command!=='mcp'&&command!=='ui')store.close();}
}
void main().catch(error=>{process.stderr.write(`Cairn ${error.code??'error'}: ${error.message}\n`);process.exitCode=1;});
