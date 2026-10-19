// Evaluation transport only: the frozen Cairn CLI remains authoritative.
// Codex supplies threadId in MCP request metadata; never infer it from a model
// argument, the latest rollout file, or another connection's activity.
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {Server} from '@modelcontextprotocol/sdk/server/index.js';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {ListToolsRequestSchema,CallToolRequestSchema} from '@modelcontextprotocol/sdk/types.js';
import {AjvJsonSchemaValidator} from '@modelcontextprotocol/sdk/validation/ajv';
import {registerMulticaPlatform} from '../../src/adapters/multica-platform.ts';
import {registerReplayTools} from './multica-replay-tools.mjs';

const mode=process.argv[2];
if(!['cairn','application'].includes(mode))throw Error('Expected cairn or application transport');
const settings=JSON.parse(fs.readFileSync(process.env.CAIRN_REPLAY_SETTINGS,'utf8'));
let sessionId,prepared=false,client,transport,opening;
const context={cwd:process.cwd(),sessionManager:{getSessionId:()=>{if(!sessionId)throw Error('Native thread is not bound');return sessionId;}}};
const tools=new Map(),handlers=new Map();
const port={registerTool(t){tools.set(t.name,{...t,validate:new AjvJsonSchemaValidator().getValidator(t.parameters)});},on(n,h){handlers.set(n,[...(handlers.get(n)??[]),h]);}};
if(mode==='application')registerReplayTools(port,registerMulticaPlatform,settings);
function bind(req){
 const id=req.params._meta?.threadId;
 if(typeof id!=='string'||!/^[a-zA-Z0-9_-]{1,200}$/.test(id))throw Error('Codex must supply authoritative threadId in MCP request metadata');
 if(sessionId&&sessionId!==id)throw Error('A different native thread cannot reuse this connection');
 sessionId=id;
 const meta=JSON.parse(fs.readFileSync(path.join(context.cwd,'.multica/daemon_task_context.json'),'utf8'));
 const issueId=process.env.MULTICA_ISSUE_ID??meta.issue_id;
 if(typeof issueId!=='string'||!/^[a-zA-Z0-9_-]{1,200}$/.test(issueId))throw Error('Missing runtime Issue identity');
 const output=path.join(settings.platform.artifactRoot,issueId,id,'output');
 const env={...process.env,CAIRN_MULTICA_SESSION_ID:id,CAIRN_MULTICA_ISSUE_ID:issueId,MULTICA_ARTIFACT_ROOT:settings.platform.artifactRoot,CAIRN_VERIFY_ARTIFACTS:JSON.stringify(['REPORT.md','answer.json','receipt.json'].map(f=>path.join(output,f)))};
 if(!prepared){
  fs.mkdirSync(path.dirname(output),{recursive:true});
  fs.writeFileSync(path.join(path.dirname(output),mode+'-binding.json'),JSON.stringify({host:'codex',sessionId:id,issueId,cwd:context.cwd,metadataKeys:Object.keys(req.params._meta??{}),artifactRequirements:JSON.parse(env.CAIRN_VERIFY_ARTIFACTS)}));
 }
 return env;
}
async function core(env,bound){
 if(opening)return opening;
 if(client&&!!bound===!!prepared)return client;
 opening=(async()=>{
  if(client)await client.close();
  client=new Client({name:'cairn-native-transport',version:'1.0.0'},{capabilities:{}});
  const args=[process.env.CAIRN_FROZEN_CLI,'mcp','--host','codex','--root',context.cwd,'--db',process.env.CAIRN_DB];
  if(bound)args.push('--session-id',sessionId);
  transport=new StdioClientTransport({command:process.execPath,args,env:Object.fromEntries(Object.entries(env).filter(([,v])=>typeof v==='string')),stderr:'inherit'});
  await client.connect(transport);prepared=!!bound;return client;
 })();
 try{return await opening;}finally{opening=undefined;}
}
const server=new Server({name:mode==='cairn'?'cairn':'task-application',version:'1.0.0'},{capabilities:{tools:{listChanged:true}}});
server.setRequestHandler(ListToolsRequestSchema,async()=>mode==='cairn'?(await core(process.env,prepared)).listTools():({tools:[...tools.values()].map(t=>({name:t.name,description:t.description,inputSchema:t.parameters,annotations:{destructiveHint:false}}))}));
server.setRequestHandler(CallToolRequestSchema,async(req,extra)=>{
 try{
  const env=bind(req);
  if(mode==='cairn'){
   const c=await core(env,true),result=await c.callTool({name:req.params.name,arguments:req.params.arguments??{}},undefined,{signal:extra.signal});
   if(['cairn_start','cairn_resume'].includes(req.params.name))await server.sendToolListChanged();
   return result;
  }
  if(!prepared){for(const h of handlers.get('session_start')??[])await h({},context);prepared=true;}
  const tool=tools.get(req.params.name);if(!tool)throw Error('Unknown application tool');
  const args=req.params.arguments??{},valid=tool.validate(args);if(!valid.valid)throw Error(valid.errorMessage??'Invalid tool input');
  return await tool.execute(randomUUID(),args,extra.signal,undefined,context);
 }catch(e){return {isError:true,content:[{type:'text',text:e.message}]};}
});
server.onclose=()=>{void client?.close();};
await server.connect(new StdioServerTransport());
