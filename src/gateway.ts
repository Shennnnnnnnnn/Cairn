import { randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { z } from 'zod';
import { Engine } from './core/engine.js';
import { CairnError, type Session, type Scope } from './core/types.js';
import { markdown } from './export.js';
export const gatewaySchema=z.object({
  servers:z.record(z.string(),z.object({command:z.string().optional(),args:z.array(z.string()).default([]),env:z.record(z.string(),z.string()).optional(),url:z.url().optional(),headers:z.record(z.string(),z.string()).optional()}).refine(s=>!!s.command!==!!s.url,'Use exactly one command or url')),
  tools:z.array(z.object({name:z.string().min(1),server:z.string(),upstream:z.string(),role:z.enum(['read','submit','receipt']).default('read'),resultRefPath:z.string().optional(),scopePaths:z.record(z.string(),z.string()).optional(),receiptPath:z.string().optional(),reportPath:z.string().optional(),reportFormat:z.enum(['json','markdown']).default('json'),timeoutMs:z.number().int().min(100).max(300000).default(30000)}))
}).superRefine((v,ctx)=>{const names=new Set<string>();for(const t of v.tools){if(!v.servers[t.server])ctx.addIssue({code:'custom',message:`Unknown server ${t.server}`});if(names.has(t.name))ctx.addIssue({code:'custom',message:`Duplicate tool ${t.name}`});if(t.role==='submit'&&(!t.reportPath||!t.receiptPath))ctx.addIssue({code:'custom',message:`Submission tool ${t.name} requires reportPath and receiptPath`});names.add(t.name);}});
export type GatewayConfig=z.infer<typeof gatewaySchema>;
export function valueAt(value:unknown,path:string):unknown {
  // MCP servers often return JSON in a text block, rather than structuredContent.
  let current:any=value;
  for(const part of path.split('.')){if(current===null||current===undefined)return;current=current[part];}
  return current;
}
export function structuredResult(result:any):unknown {
  if(result?.structuredContent)return result.structuredContent;
  const text=result?.content?.find((c:any)=>c.type==='text')?.text;
  if(text)try{return JSON.parse(text);}catch{}
  return result;
}
export class Gateway {
  constructor(readonly engine:Engine){}
  config():GatewayConfig {const c=this.engine.store.config<GatewayConfig>('gateway');if(!c)throw new CairnError('missing_whitelist','No upstream whitelist configured');return gatewaySchema.parse(c);}
  async connect(name:string){
    const config=this.config().servers[name];if(!config)throw new CairnError('not_found','Unknown upstream server');
    const client=new Client({name:'cairn-gateway',version:'1.0.0'});
    const transport=config.url?new StreamableHTTPClientTransport(new URL(config.url),{requestInit:{headers:config.headers}}):
      new StdioClientTransport({command:config.command!,args:config.args,env:config.env,stderr:'inherit'});
    try{await client.connect(transport,{timeout:10000});return client;}catch(error){await client.close().catch(()=>{});throw error;}
  }
  async list(){
    const config=this.config(), clients=new Map<string,Client>();
    try{
      for(const tool of config.tools)if(!clients.has(tool.server))clients.set(tool.server,await this.connect(tool.server));
      const catalog=new Map<string,Awaited<ReturnType<Client['listTools']>>>();
      for(const [name,client]of clients){
        const all:Awaited<ReturnType<Client['listTools']>>={tools:[]},seen=new Set<string>();let cursor:string|undefined;
        do{
          const page=await client.listTools(cursor?{cursor}:undefined);all.tools.push(...page.tools);cursor=page.nextCursor;
          if(cursor){if(seen.has(cursor)||seen.size>=100)throw new CairnError('invalid_catalog','Upstream tool pagination did not terminate');seen.add(cursor);}
        }while(cursor);
        catalog.set(name,all);
      }
      return config.tools.map(t=>{const upstream=catalog.get(t.server)?.tools.find(x=>x.name===t.upstream);if(!upstream)throw new CairnError('missing_tool',`Whitelisted upstream ${t.name} is unavailable`);return {name:t.name,role:t.role,description:upstream.description,inputSchema:upstream.inputSchema};});
    }finally{await Promise.allSettled([...clients.values()].map(c=>c.close()));}
  }
  async call(taskId:string,session:Session,name:string,args:Record<string,unknown>,signal?:AbortSignal){
    const task=this.engine.store.get(taskId),tool=this.config().tools.find(t=>t.name===name);
    if(!tool)throw new CairnError('not_allowed',`Tool ${name} is not on the configured whitelist`);
    if(tool.role==='submit'){
      args=structuredClone(args);
      const path=tool.reportPath!.split('.');let cursor:any=args;
      for(const key of path){if(['__proto__','constructor','prototype'].includes(key))throw new CairnError('invalid_mapping','Unsafe report path');}
      for(const key of path.slice(0,-1))cursor=cursor[key]??={};
      cursor[path.at(-1)!]=tool.reportFormat==='markdown'?markdown(task):task.report;
    }
    const callId=`gateway:${randomUUID()}`;
    this.engine.beforeTool(taskId,session,callId,name,tool.role==='submit',tool.role==='receipt');
    let client:Client|undefined;
    try{
      client=await this.connect(tool.server);
      const remaining=task.budget.deadline?Date.parse(task.budget.deadline)-this.engine.now().getTime():Infinity;
      if(remaining<=0)throw new CairnError('deadline','Task expired while connecting to the upstream server');
      signal?.throwIfAborted();
      const result=await client.callTool({name:tool.upstream,arguments:args},undefined,{timeout:Math.max(1,Math.min(tool.timeoutMs,remaining)),resetTimeoutOnProgress:false,signal});
      const structured=structuredResult(result),scope:Scope={...task.scope};
      for(const [key,path]of Object.entries(tool.scopePaths??{})){
        const v=valueAt(structured,path);if(typeof v!=='string')throw new CairnError('invalid_scope',`Missing upstream scope ${key}`);scope[key as keyof Scope]=v;
      }
      const ref=tool.resultRefPath?valueAt(structured,tool.resultRefPath):undefined;
      const receipt=tool.receiptPath?valueAt(structured,tool.receiptPath):undefined;
      const observation=this.engine.observe(taskId,session,{callId,tool:name,input:args,output:result,source:'gateway',status:result.isError?'error':'success',scope,resultRef:typeof ref==='string'?ref:undefined,receipt});
      if(tool.role==='submit'&&!result.isError){
        if(!receipt)throw new CairnError('ambiguous_submission','Submission returned no mapped receipt; reconcile through a configured receipt tool before retrying');
        this.engine.delivery(taskId,session,`submission:${taskId}`,observation.id);
      }
      return observation;
    }catch(error){
      this.engine.observe(taskId,session,{callId,tool:name,input:args,output:{error:(error as Error).message},source:'gateway',status:'error'});
      throw error;
    }finally{await client?.close().catch(()=>{});}
  }
}
