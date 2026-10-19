// Application-side controlled tools for native hosts without Pi extension APIs.
// Cairn's goal tools and native hooks remain in its own plugin.
import fs from 'node:fs';
import {randomUUID} from 'node:crypto';
import {Server} from '@modelcontextprotocol/sdk/server/index.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {ListToolsRequestSchema,CallToolRequestSchema} from '@modelcontextprotocol/sdk/types.js';
import {AjvJsonSchemaValidator} from '@modelcontextprotocol/sdk/validation/ajv';
import {registerMulticaPlatform} from '../../src/adapters/multica-platform.ts';
import {registerReplayTools} from './multica-replay-tools.mjs';
const settings=JSON.parse(fs.readFileSync(process.env.CAIRN_REPLAY_SETTINGS,'utf8'));
const sessionId=process.env.CAIRN_MULTICA_SESSION_ID;
if(!sessionId)throw Error('Application tools require the actual native session ID from the trusted launcher');
const context={cwd:process.cwd(),sessionManager:{getSessionId:()=>sessionId}};
const tools=new Map(),handlers=new Map();
const port={registerTool(t){tools.set(t.name,{...t,validate:new AjvJsonSchemaValidator().getValidator(t.parameters)});},on(n,h){handlers.set(n,[...(handlers.get(n)??[]),h]);}};
registerReplayTools(port,registerMulticaPlatform,settings);
for(const h of handlers.get('session_start')??[])await h({},context);
const server=new Server({name:'task-application',version:'1.0.0'},{capabilities:{tools:{}}});
server.setRequestHandler(ListToolsRequestSchema,()=>({tools:[...tools.values()].map(t=>({name:t.name,description:t.description,inputSchema:t.parameters}))}));
server.setRequestHandler(CallToolRequestSchema,async(req,extra)=>{
 try{
  const tool=tools.get(req.params.name);if(!tool)throw Error('Unknown application tool');
  const args=req.params.arguments??{},valid=tool.validate(args);if(!valid.valid)throw Error(valid.errorMessage??'Invalid tool input');
  return await tool.execute(randomUUID(),args,extra.signal,undefined,context);
 }catch(e){return {isError:true,content:[{type:'text',text:e.message}]};}
});
await server.connect(new StdioServerTransport());
