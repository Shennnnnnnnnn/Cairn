import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { Engine } from './core/engine.js';
import { ToolRuntime } from './tools.js';
import type { Session } from './core/types.js';
import { VERSION } from './version.js';

/** Claude Code rejects root combinators before a tool can reach the API.
 * Runtime validation remains authoritative, including checkpoint delta checks. */
export function mcpToolSchema(schema:Record<string,unknown>,host:Session['host'],name?:string){
  if(host!=='claude')return schema;
  const copy=structuredClone(schema);
  if(copy.oneOf){delete copy.oneOf;if(name==='cairn_update'){copy.minProperties=1;copy.maxProperties=1;}}
  delete copy.anyOf;
  return copy;
}

export async function startMcp(engine:Engine,session:Session) {
  const runtime=new ToolRuntime(engine,session);
  const server=new Server({name:'cairn',version:VERSION},{capabilities:{tools:{listChanged:true}}});
  server.setRequestHandler(ListToolsRequestSchema,async()=>({tools:(await runtime.list()).map(tool=>({
    name:tool.name,description:tool.description,inputSchema:mcpToolSchema(tool.inputSchema,session.host,tool.name) as {type:'object'},
    // The six core tools only append/update local goal records. Omitting this
    // hint defaults to destructive in MCP and can block ordinary noninteractive
    // CLI runs. Forwarded tools retain the conservative upstream/default policy.
    annotations:{readOnlyHint:tool.readOnly??false,openWorldHint:tool.name.startsWith('cairn_tool_'),...(!tool.name.startsWith('cairn_tool_')?{destructiveHint:false}:{})},
  }))}));
  server.setRequestHandler(CallToolRequestSchema,async(request,extra)=>{
    try {
      const result=await runtime.invokeModel(request.params.name,request.params.arguments??{},extra.signal),value=result??{ok:true};
      if(['cairn_start','cairn_resume'].includes(request.params.name))await server.sendToolListChanged();
      return {content:[{type:'text',text:JSON.stringify(value)}],structuredContent:{result:value}};
    } catch(error) {
      return {isError:true,content:[{type:'text',text:JSON.stringify({error:(error as any).code??'invalid_input',message:(error as Error).message})}]};
    }
  });
  const close=server.close.bind(server);
  server.close=async()=>{try{await runtime.close();}finally{await close();}};
  server.onclose=()=>{void runtime.close();};
  await server.connect(new StdioServerTransport());return server;
}
