import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { Engine } from './core/engine.js';
import { ToolRuntime } from './tools.js';
import type { Session } from './core/types.js';
import { VERSION } from './version.js';

export async function startMcp(engine:Engine,session:Session) {
  const runtime=new ToolRuntime(engine,session);
  const server=new Server({name:'cairn',version:VERSION},{capabilities:{tools:{}}});
  server.setRequestHandler(ListToolsRequestSchema,async()=>({tools:(await runtime.list()).map(tool=>({
    name:tool.name,description:tool.description,inputSchema:tool.inputSchema as {type:'object'},
    // The five core tools only append/update local goal records. Omitting this
    // hint defaults to destructive in MCP and can block ordinary noninteractive
    // CLI runs. Forwarded tools retain the conservative upstream/default policy.
    annotations:{readOnlyHint:tool.readOnly??false,openWorldHint:tool.name.startsWith('cairn_tool_'),...(!tool.name.startsWith('cairn_tool_')?{destructiveHint:false}:{})},
  }))}));
  server.setRequestHandler(CallToolRequestSchema,async(request,extra)=>{
    try {
      const result=await runtime.invoke(request.params.name,request.params.arguments??{},extra.signal),value=result??{ok:true};
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
