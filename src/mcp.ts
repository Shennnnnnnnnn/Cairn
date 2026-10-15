import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { Engine } from './core/engine.js';
import { definitions, invoke } from './tools.js';
import type { Session } from './core/types.js';
export async function startMcp(engine:Engine,session:Session){
 const server=new Server({name:'cairn',version:'1.0.0'},{capabilities:{tools:{}}});
 server.setRequestHandler(ListToolsRequestSchema,async()=>({tools:definitions(engine).map(t=>({name:t.name,description:t.description,inputSchema:z.toJSONSchema(t.schema) as any,annotations:{readOnlyHint:['cairn_state','cairn_events','cairn_check','cairn_tools'].includes(t.name),destructiveHint:t.name==='cairn_call',openWorldHint:['cairn_call','cairn_tools'].includes(t.name)}}))}));
 server.setRequestHandler(CallToolRequestSchema,async(request,extra)=>{
  try{const result=await invoke(engine,session,request.params.name,request.params.arguments??{},extra.signal);const value=result??{ok:true};return {content:[{type:'text',text:JSON.stringify(value)}],structuredContent:{result:value}};}
  catch(error){return {isError:true,content:[{type:'text',text:JSON.stringify({error:(error as any).code??'invalid_input',message:(error as Error).message})}]};}
 });
 await server.connect(new StdioServerTransport());return server;
}
