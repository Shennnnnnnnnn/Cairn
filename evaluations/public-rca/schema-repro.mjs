// Reproduce the integration friction without any model calls or experiment edits.
import {createHarness} from '../../dist/index.js';
import {writeFileSync} from 'node:fs';
const h=createHarness({database:':memory:',session:{host:'mcp',sessionId:'public-eval-schema-repro',cwd:process.cwd()}});
try{
 const tool=(await h.tools.list()).find(t=>t.name==='cairn_checkpoint');
 const context=await h.tools.invoke('cairn_start',{goal:'Reproduce checkpoint input contract',criteria:['Save a summary']});
 let error;
 try{await h.tools.invoke('cairn_checkpoint',{});}catch(e){error=e.message;}
 const saved=await h.tools.invoke('cairn_checkpoint',{summary:'A supplied summary succeeds'});
 const result={advertisedRequired:tool.inputSchema.required??[],advertisedSummaryOptional:!(tool.inputSchema.required??[]).includes('summary'),emptyNormalCheckpointError:error,explicitSummarySucceeded:Boolean(saved)};
 if(!result.advertisedSummaryOptional||!error?.includes('Checkpoint summary is required')||!result.explicitSummarySucceeded)throw new Error('Reproducer no longer matches observed behavior');
 writeFileSync(new URL('./runs/2026-10-16-aiops2022/schema-repro.json',import.meta.url),JSON.stringify(result,null,2)+'\n');
 console.log(JSON.stringify(result));
}finally{await h.close();}
