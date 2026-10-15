#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { Store } from './core/store.js';
import { Engine } from './core/engine.js';
import { CairnError, type Host, type Session } from './core/types.js';
import { database } from './paths.js';
import { startMcp } from './mcp.js';
import { normalize, handleNative, hookOutput } from './adapters/hooks.js';
import { install, uninstall, installationStatus, type Target } from './install.js';
import { invoke } from './tools.js';
import { gatewaySchema, Gateway } from './gateway.js';
import { markdown, html } from './export.js';

export async function main(argv=process.argv.slice(2)){
 const command=argv[0]??'help';
 const {values:v,positionals}=parseArgs({args:argv.slice(1),allowPositionals:true,options:{target:{type:'string'},scope:{type:'string'},root:{type:'string'},host:{type:'string'},'session-id':{type:'string'},db:{type:'string'},file:{type:'string'},input:{type:'string'},'task-id':{type:'string'},format:{type:'string'},out:{type:'string'},'takeover':{type:'boolean'},'json':{type:'boolean'}}});
 const output=(value:unknown)=>process.stdout.write(JSON.stringify(value??{ok:true},null,2)+'\n');
 if(command==='help'||command==='--help'){
  process.stdout.write(`Cairn 1.0 — goals and evidence for Pi, Claude Code and Codex\n\nNode >=24 required.\n\n  cairn install|update|uninstall --target pi|claude|codex [--scope project|user] [--root DIR]\n  cairn doctor [--target pi|claude|codex] [--scope project|user] [--root DIR]\n  cairn mcp --host pi|claude|codex|mcp [--session-id ID] [--db FILE]\n  cairn hook --host claude|codex     # native hook JSON on stdin\n  cairn configure --file whitelist.json\n  cairn task list|show|resume|suspend [ID] --host HOST --session-id ID [--takeover]\n  cairn call TOOL --input args.json --host HOST --session-id ID\n  cairn confirm TASK_ID            # human team confirmation after platform receipt\n  cairn export TASK_ID [--format json|markdown|html] [--out FILE]\n\nTask database defaults to <workspace>/.cairn/state.db. CAIRN_DB overrides it.\n`);return;
 }
 if(['install','update','uninstall'].includes(command)){
  if(!['pi','claude','codex'].includes(v.target??''))throw new CairnError('invalid_input','--target pi|claude|codex is required');
  if(v.scope&&!['project','user'].includes(v.scope))throw new CairnError('invalid_input','Invalid scope');
  const target=v.target as Target,scope=(v.scope??'project') as 'project'|'user';
  output(command==='uninstall'?uninstall(target,scope,v.root):install(target,scope,v.root));return;
 }
 let hookEvent:any;
 if(command==='hook')hookEvent=JSON.parse(readFileSync(0,'utf8'));
 const host=(v.host??process.env.CAIRN_HOST??'mcp') as Host;
 if(!['pi','claude','codex','mcp'].includes(host))throw new CairnError('invalid_input','Invalid host');
 const cwd=hookEvent?.cwd??v.root??process.cwd();
 const store=new Store(v.db?resolve(v.db):database(cwd)),engine=new Engine(store);
 const session:Session={host,cwd,sessionId:v['session-id']??''};
 try{
  if(command==='mcp'){
   const server=await startMcp(engine,session);
   const close=async()=>{await server.close();store.close();};
   process.once('SIGTERM',()=>{void close().finally(()=>process.exit(0));});
   process.once('SIGINT',()=>{void close().finally(()=>process.exit(0));});
   // stdin end closes the transport; process exit releases SQLite automatically.
   return;
  }
  if(command==='hook'){
   const event=normalize(host,hookEvent);output(hookOutput(event,handleNative(engine,host,event)));return;
  }
  if(command==='configure'){if(!v.file)throw new CairnError('invalid_input','--file is required');const config=gatewaySchema.parse(JSON.parse(readFileSync(v.file,'utf8')));store.setConfig('gateway',config);output({configured:config.tools.map(t=>({name:t.name,role:t.role}))});return;}
  if(command==='call'){if(!positionals[0]||!v.input)throw new CairnError('invalid_input','Supply TOOL --input FILE');output(await invoke(engine,session,positionals[0],JSON.parse(readFileSync(v.input,'utf8'))));return;}
  if(command==='confirm'){engine.confirm(positionals[0]??'');output({confirmed:positionals[0]});return;}
  if(command==='export'){
   const task=store.get(positionals[0]??v['task-id']??'');
   if(v.format&&!['json','markdown','html'].includes(v.format))throw new CairnError('invalid_input','Unknown export format');
   const content=v.format==='html'?html(task):v.format==='markdown'?markdown(task):JSON.stringify(task,null,2)+'\n';
   if(v.out){writeFileSync(resolve(v.out),content,{mode:0o600});output({path:resolve(v.out)});}else process.stdout.write(content);return;
  }
  if(command==='task'){
   const [operation,taskId]=positionals;
   if(operation==='list')output(store.list());else if(operation==='show')output(engine.context(taskId??''));
   else if(operation==='resume'){if(!session.sessionId)throw new CairnError('session_required','--session-id is required');output(engine.resume(taskId??'',session,v.takeover));}
   else if(operation==='suspend')output(engine.suspend(taskId??'',session));else throw new CairnError('invalid_input','Unknown task operation');return;
  }
  if(command==='doctor'){
   const targets=(v.target?[v.target]:['pi','claude','codex']) as Target[];
   if(targets.some(t=>!['pi','claude','codex'].includes(t)))throw new CairnError('invalid_input','Invalid target');
   const results=targets.map(t=>{
    const status=installationStatus(t,(v.scope??'project') as any,v.root);
    const sessions=store.db.prepare('SELECT seen,capabilities FROM sessions WHERE host=?').all(t).map(r=>({seen:JSON.parse(r.seen as string),capabilities:JSON.parse(r.capabilities as string)}));
    return {...status,declaredCapabilities:sessions.at(-1)?.capabilities??{},observedEvents:sessions.map(s=>s.seen),hooksTrust:sessions.some(s=>s.seen.SessionStart)?'startup_observed':'not_observed',coverage:t==='codex'?'Local function and MCP tools; hosted tools may bypass hooks.':'Native events only; upstream calls through cairn_call are always recorded.'};
   });
   const client=new Client({name:'cairn-doctor',version:'1.0.0'});let mcp:any;
   try{
    const entry=fileURLToPath(import.meta.url);
    await client.connect(new StdioClientTransport({command:process.execPath,args:[entry,'mcp','--db',v.db??database(cwd),'--host','mcp','--session-id','doctor'],stderr:'pipe'}),{timeout:10000});
    const tools=await client.listTools();mcp={ok:true,tools:tools.tools.length};
   }catch(error){mcp={ok:false,error:(error as Error).message};}finally{await client.close().catch(()=>{});}
   let upstream:any={ok:false,reason:'No whitelist configured'};
   if(store.config('gateway'))try{upstream={ok:true,tools:(await new Gateway(engine).list()).length};}catch(error){upstream={ok:false,error:(error as Error).message};}
   output({node:process.version,database:v.db??database(cwd),mcp,hosts:results,upstream,strictReady:upstream.ok&&mcp.ok&&results.every(r=>r.installed&&r.runtimeExists&&r.version&&['SessionStart','PreToolUse','PostToolUse','Stop'].every(e=>r.observedEvents.some(s=>s[e]))),whitelist:!!store.config('gateway')});return;
  }
  throw new CairnError('invalid_input',`Unknown command ${command}`);
 }finally{if(command!=='mcp')store.close();}
}
void main().catch(error=>{process.stderr.write(`Cairn ${error.code??'error'}: ${error.message}\n`);process.exitCode=1;});
