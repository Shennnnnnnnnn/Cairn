import {appendFileSync} from 'node:fs';
import {Server} from '@modelcontextprotocol/sdk/server/index.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {ListToolsRequestSchema,CallToolRequestSchema,McpError,ErrorCode} from '@modelcontextprotocol/sdk/types.js';
const audit=process.argv[2];
const record=(event,extra={})=>appendFileSync(audit,`${JSON.stringify({event,pid:process.pid,...extra})}\n`);
record('start');process.on('exit',()=>record('exit'));
const server=new Server({name:'gateway-catalog-fixture',version:'1'},{capabilities:{tools:{}}});
const readSchema={type:'object',description:'Preserved upstream object',properties:{probe:{type:'string',description:'Original typed argument'},team:{type:'string'}},required:['probe'],additionalProperties:false,$defs:{original:{type:'string',minLength:2}}};
const submitSchema={type:'object',properties:{payload:{type:'object',properties:{report:{type:'object',description:'Injected report'},label:{type:'string'}},required:['report','label'],additionalProperties:false}},required:['payload'],additionalProperties:false};
const tools=['read','submit','receipt','slow','rpc_error','crash'].map(name=>({name,description:`Original ${name}`,inputSchema:name==='read'?readSchema:name==='submit'?submitSchema:{type:'object',properties:{team:{type:'string'}}}}));
server.setRequestHandler(ListToolsRequestSchema,async request=>{
 record('list',{cursor:request.params?.cursor});
 return request.params?.cursor==='next'?{tools:tools.slice(2)}:{tools:tools.slice(0,2),nextCursor:'next'};
});
server.setRequestHandler(CallToolRequestSchema,async(request,extra)=>{
 const name=request.params.name,args=request.params.arguments??{};record('call',{name,args});
 if(name==='crash')process.exit(3);
 if(name==='rpc_error')throw new McpError(ErrorCode.InternalError,'Fixture RPC failure');
 if(name==='slow')await new Promise((resolve,reject)=>{const timer=setTimeout(resolve,Number(args.delayMs??2000));extra.signal.addEventListener('abort',()=>{clearTimeout(timer);reject(new Error('Cancelled fixture'));},{once:true});});
 const value={result_ref:`real-${name}`,team_id:args.team??'team',pid:process.pid,probe:args.probe??null,...(['submit','receipt'].includes(name)?{receipt:{accepted:true,reference:'real-platform-receipt'}}:{})};
 return {content:[{type:'text',text:JSON.stringify(value)}],structuredContent:value};
});
if(process.argv[3])await new Promise(resolve=>setTimeout(resolve,Number(process.argv[3])));
await server.connect(new StdioServerTransport());
