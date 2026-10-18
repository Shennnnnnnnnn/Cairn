import { randomUUID } from 'node:crypto';
import { Store } from './core/store.js';
import { Engine, type EngineOptions } from './core/engine.js';
import { ToolRuntime } from './tools.js';
import { CairnError, type Session } from './core/types.js';

export interface HarnessTool { name:string; description:string; inputSchema:Record<string,unknown>; readOnly?:boolean; role?:string }
export interface HarnessOptions extends EngineOptions { database:string; session?:Session; now?:()=>Date }
export interface Harness {
  engine:Engine;
  tools:{ list():Promise<HarnessTool[]>; invoke(name:string,input:unknown,signal?:AbortSignal):Promise<unknown>; invokeModel(name:string,input:unknown,signal?:AbortSignal):Promise<unknown> };
  close():Promise<void>;
}
/** A host supplies execution; Cairn supplies the persistent blackboard and five-tool protocol. */
export function createHarness(options:HarnessOptions):Harness {
  const store=new Store(options.database),engine=new Engine(store,options.now,options);
  const runtime=new ToolRuntime(engine,options.session??{host:'mcp',sessionId:`harness-${randomUUID()}`,cwd:process.cwd()});
  let closing:Promise<void>|undefined;
  const open=()=>{if(closing)throw new CairnError('closed','This harness has been closed');};
  return {engine,tools:{list:async()=>{open();return runtime.list();},invoke:async(name,input,signal)=>{open();return runtime.invoke(name,input,signal);},invokeModel:async(name,input,signal)=>{open();return runtime.invokeModel(name,input,signal);}},
    close:()=>closing??=(async()=>{try{await runtime.close();}finally{store.close();}})()};
}
