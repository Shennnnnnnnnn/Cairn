import {Server} from '@modelcontextprotocol/sdk/server/index.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {ListToolsRequestSchema,CallToolRequestSchema} from '@modelcontextprotocol/sdk/types.js';
const server=new Server({name:'fixture-observability',version:'1.0.0'},{capabilities:{tools:{}}});
server.setRequestHandler(ListToolsRequestSchema,async()=>({tools:['read','slow'].map(name=>({name,description:`Fixture ${name}`,inputSchema:{type:'object',properties:{},additionalProperties:true}}))}));
server.setRequestHandler(CallToolRequestSchema,async(request,extra)=>{
 if(request.params.name==='slow')await new Promise((resolve,reject)=>{const t=setTimeout(resolve,2000);extra.signal.addEventListener('abort',()=>{clearTimeout(t);reject(new Error('aborted'));},{once:true});});
 const value={result_ref:`ref-${request.params.name}`,workspace_id:'project',environment:'staging',issue_id:'issue',value:12};
 return {isError:request.params.arguments?.fail===true,content:[{type:'text',text:JSON.stringify(value)}],structuredContent:value};
});
await server.connect(new StdioServerTransport());
