// Scripted native receipts through the exact evaluation adapter; never calls an LLM.
import {mkdirSync,readFileSync,writeFileSync,copyFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {runScheduled} from './scheduler-driver-round15.mjs';
import {resolveCodexUsage,createCodexRepairActionAudit} from './native-accounting-round13.mjs';
const save=(path,value)=>writeFileSync(path,typeof value==='string'?value:JSON.stringify(value,null,2)+'\n');
const assert=(value,message)=>{if(!value)throw new Error('Integration fixture: '+message);};
const sha=path=>createHash('sha256').update(readFileSync(path)).digest('hex');

export async function runIntegrationFixture({root,manifest}){
 const fixtureRoot=join(root,'integration-fixtures');mkdirSync(fixtureRoot);
 const actionAudit=createCodexRepairActionAudit();
 for(const type of ['item.started','item.updated','item.completed'])actionAudit.observe({type,item:{id:'deduplicated-action',type:'command_execution'}});
 actionAudit.observe({type:'item.started',item:{id:'never-completed-action',type:'file_change'}});
 actionAudit.observe({type:'item.started',item:{type:'command_execution'}});
 actionAudit.observe({type:'item.completed',item:{id:'public-reply',type:'agent_message'}});
 assert(actionAudit.snapshot().observedNativeActions===3,'started-only action must be counted; repeated ID deduplicated and anonymous event conservative');
 const results=[];
 for(const coordinatorMode of ['fresh-full','reuse-delta'])for(const host of ['pi'])for(const scenario of ['direct','reason-repair-loop','artifact-only-reason',...(host==='codex'?['negative-usage','repair-started-action']:[])]){
  const spec=manifest.models.find(value=>value.host===host),dir=join(fixtureRoot,host+'-'+coordinatorMode+'-'+scenario),work=join(dir,'workspace');mkdirSync(work,{recursive:true});save(join(work,'marker.txt'),scenario==='artifact-only-reason'?'beta\n':'alpha\n');save(join(work,'expected.txt'),'alpha\n');
  let normalReasons=0,repairCalls=0,coordinatorRef,bootstrapRef;const requests=[];
  const runner=async({spec,dir,work,resume,onSession,noTools,outputOnlyRepair,schedulerRequest:request})=>{
   const sessionId=resume?.sessionId??randomUUID(),sessionRef=`${host}:${sessionId}`;
   if(request.phase==='bootstrap')bootstrapRef=sessionRef;
   onSession(sessionId);requests.push({id:request.id,phase:request.phase,resume:request.resume??null,repair:request.repair??null,contextMode:request.contextMode??null,noTools,outputOnlyRepair,sessionRef});
   let output;
   if(scenario==='artifact-only-reason'){
    if(request.phase==='bootstrap')output={decision:'complete',checkpoint:{findings:[{key:'target-format',text:'The specified marker content is alpha followed by newline',status:'supported',basis:'Read the stable expected.txt format specification',references:['expected.txt'],covers:['c1']}],artifacts:[{path:'marker.txt'}],report:{summary:'The target value is documented; marker artifact must pass the host verifier.'}}};
    else if(request.phase==='reason'){
     normalReasons++;assert(!request.repair,'artifact correction is useful native work, not output-only parameter repair');save(join(work,'marker.txt'),'alpha\n');output={decision:'complete'};
    }else throw new Error('Unexpected artifact-only fixture phase '+request.phase);
   }else if(scenario==='direct'||scenario==='negative-usage'){
    assert(request.phase==='bootstrap','short task should use Bootstrap');
    output={decision:'complete',checkpoint:{findings:[{key:'marker',text:'marker has alpha and newline',status:'supported',basis:'Read the fixture marker',references:['marker.txt'],covers:['c1']}],artifacts:[{path:'marker.txt'}],report:{summary:'Marker content verified and preserved.'}}};
   }else if(request.repair){
    repairCalls++;assert(request.phase==='reason'&&request.resume===coordinatorRef,'repair must continue the same Reason native session');
    assert(request.contextMode==='repair'&&noTools&&outputOnlyRepair,'repair must request output-only execution');
    output={decision:'continue',summary:'Corrected only the prior output shape; existing intent remains executable.'};
   }else if(request.phase==='bootstrap'){
    output={decision:'continue',checkpoint:{findings:[{key:'marker-initial',text:'Marker exists',status:'supported',basis:'Fixture read marker.txt',references:['marker.txt'],covers:[]}]},intents:[{key:'verify-marker',title:'Independently inspect marker content and preserve a proposal'}]};
   }else if(request.phase==='reason'){
    normalReasons++;
    if(normalReasons===1){
     assert(coordinatorMode==='fresh-full'?!request.resume&&request.contextMode==='full':request.resume===bootstrapRef&&request.contextMode==='delta','first Reason context policy');coordinatorRef=sessionRef;
     // Deliberately exceed the generic public schema references limit; the
     // subsequent same-session response repairs the shape without new tools.
     output={decision:'continue',checkpoint:{findings:[{key:'marker-initial',text:'Marker exists',status:'supported',basis:'Already observed',references:Array.from({length:9},(_,index)=>`reference-${index}.txt`),covers:[]}]}};
    }else{
     assert(coordinatorMode==='fresh-full'?!request.resume&&request.contextMode==='full':request.resume===coordinatorRef&&request.contextMode==='delta','later Reason context policy');
     const db=new DatabaseSync(join(work,'.cairn/state.db'),{readOnly:true});let task;try{task=JSON.parse(db.prepare('SELECT state FROM tasks WHERE id=?').get(request.taskId).state);}finally{db.close();}
     const proposal=task.claims.find(claim=>claim.status==='proposed'&&claim.text==='Marker content is alpha and newline');
     assert(proposal?.key,'Explore proposal must reach the blackboard before Reason review');
     output={decision:'complete',checkpoint:{findings:[{key:proposal.key,text:proposal.text,status:'supported',basis:'Reviewed marker.txt against submitted proposal',references:['marker.txt'],covers:['c1']}],artifacts:[{path:'marker.txt'}],report:{summary:'Reviewed the submitted marker proposal and preserved the file.'}}};
    }
   }else if(request.phase==='explore'){
    output={decision:'continue',checkpoint:{findings:[{key:'marker-observed',text:'Marker content is alpha and newline',status:'proposed',basis:'Read marker.txt in the fixture',references:['marker.txt'],covers:[]}]}};
   }else throw new Error('Unexpected fixture phase '+request.phase);
   mkdirSync(join(dir,'sessions'),{recursive:true});const name=resume?.sessionFile.split('/').at(-1)??`${sessionId}.jsonl`,file=join(dir,'sessions',name);
   if(resume)copyFileSync(resume.sessionFile,file);
   const previous=existsSync(file)?readFileSync(file,'utf8'):'';let totalInput=0,totalOutput=0,totalCached=0;
   if(host==='codex')for(const line of previous.split('\n'))try{const event=JSON.parse(line);if(event.type==='event_msg'&&event.payload?.type==='token_count'){const usage=event.payload.info.total_token_usage;totalInput=usage.input_tokens;totalOutput=usage.output_tokens;totalCached=usage.cached_input_tokens;}}catch{}
   const stamp=new Date().toISOString(),events=[];
   if(!resume)events.push(host==='pi'?{type:'session',id:sessionId,cwd:work,timestamp:stamp}:{type:'session_meta',payload:{id:sessionId,cwd:work,timestamp:stamp}});
   if(host==='pi')events.push({type:'thinking_level_change',thinkingLevel:spec.thinking},{type:'message',message:{role:'assistant',model:spec.id,stopReason:'stop',usage:{input:30,cacheRead:90,cacheWrite:0,output:10,totalTokens:130}}});
   else events.push({type:'turn_context',payload:{model:spec.id,effort:spec.thinking}},{type:'event_msg',payload:{type:'token_count',info:{total_token_usage:{input_tokens:totalInput+120,cached_input_tokens:totalCached+90,output_tokens:totalOutput+10}}}});
   save(file,previous+events.map(value=>JSON.stringify(value)).join('\n')+'\n');
   const usage={input_tokens:120,cached_input_tokens:90,cache_write_input_tokens:0,output_tokens:10};
   const accounting=scenario==='negative-usage'?resolveCodexUsage({streamUsage:usage,cumulative:{input_tokens:20,cached_input_tokens:10,output_tokens:5},baseline:{input_tokens:100,cached_input_tokens:90,output_tokens:10},resumed:true}):{usage,diagnostic:null};
   const startedAction=scenario==='repair-started-action'&&request.repair?{type:'item.started',item:{id:'pending-action',type:'file_change'}}:null;
   const repairAudit=createCodexRepairActionAudit();if(startedAction)repairAudit.observe(startedAction);
   const metrics={host,requestedModel:spec.id,requestedEffort:spec.thinking,threadId:sessionId,actualModels:[spec.id],actualEfforts:[spec.thinking],startedAt:stamp,finishedAt:stamp,wallSeconds:0,exitCode:0,turnFailed:false,finalStopReason:host==='pi'?'stop':undefined,usage:accounting.usage,accountingDiagnostic:accounting.diagnostic,usageIsLowerBound:!!accounting.diagnostic,errors:[],counts:{assistant:1},toolCalls:repairAudit.snapshot().observedNativeActions,repairActionAudit:outputOnlyRepair?repairAudit.snapshot():null,toolErrors:0,timedOut:false,budgetExceeded:false,synthetic:true};
   save(join(dir,'launch.json'),{host,requestedModel:spec.id,requestedEffort:spec.thinking,workspace:work,implementation:null,evaluationBudgets:null,noToolsRequested:noTools,outputOnlyRepair,synthetic:true});
   save(join(dir,'initial.metrics.json'),metrics);save(join(dir,'initial.tools.json'),[]);save(join(dir,'initial.jsonl'),startedAction?JSON.stringify(startedAction)+'\n':'');save(join(dir,'initial.final.md'),JSON.stringify(output));save(join(dir,'credential-cleanup.json'),{path:join(dir,'no-credentials-created'),removed:true,credentialFilesArchived:false,synthetic:true});return metrics;
  };
  const verifyCommand=[process.execPath,'--input-type=module','-e',"import{readFileSync}from'node:fs';let input='';for await(const chunk of process.stdin)input+=chunk;const task=JSON.parse(input);console.log(JSON.stringify({ok:readFileSync(task.owner.cwd+'/marker.txt','utf8')==='alpha\\n',issues:[]}));"];
  const fixturePrompt=scenario==='artifact-only-reason'?'Read the stable expected.txt target specification, correct marker.txt to match it, and pass the host artifact verifier. Criterion c1 is documenting the expected target and producing the required artifact.':'Verify marker.txt contains alpha followed by newline and preserve it. Criterion c1 is marker content unchanged.';
  const metrics=await runScheduled({spec,work,dir,implementation:join(root,'implementation'),prompt:fixturePrompt,common:'Synthetic integration fixture only. No model calls.',verifyCommand,artifacts:['marker.txt'],testOnlyNativeRunner:runner,fixture:true,coordinatorMode});
  if(scenario==='repair-started-action')assert(metrics.schedulerStatus!=='completed'&&repairCalls>=1,'a started-only repair action must cause post-hoc candidate rejection');
  else assert(metrics.schedulerStatus==='completed','fixture workflow did not complete: '+JSON.stringify(metrics.schedulerResult));
  if(scenario==='negative-usage')assert(metrics.usage===null&&metrics.usageIsLowerBound&&metrics.accountingDiagnostics.length===1&&!metrics.turnFailed&&existsSync(join(dir,'initial.metrics.json')),'negative cumulative delta must preserve terminal status/raw receipt, mark unknown, and keep the actor');
  else assert(metrics.usage.input_tokens===requests.length*120&&metrics.usage.output_tokens===requests.length*10,'pipeline phase increments not summed exactly once');
  assert(metrics.recovery.attempted===0,'normal Reason reuse/repair must not count as fault Conclude');
  assert(readFileSync(join(work,'marker.txt'),'utf8')==='alpha\n','fixture marker changed');
  if(scenario==='reason-repair-loop')assert(repairCalls===1&&normalReasons===2&&requests.some(value=>value.phase==='explore'),'repair/review/explore path was not actually exercised');
  if(scenario==='artifact-only-reason')assert(normalReasons===1&&repairCalls===0&&metrics.phaseCount===2,'artifact-only Reason correction must complete without false stale-state or unchanged-manifest rejection');
  results.push({host,scenario,coordinatorMode,ok:true,synthetic:true,requests,phaseCount:metrics.phaseCount,sessionIds:metrics.sessionIds,syntheticUsage:metrics.usage,taskStatus:metrics.schedulerStatus,markerSHA256:sha(join(work,'marker.txt'))});
 }
 return {recordedAt:new Date().toISOString(),ok:results.every(value=>value.ok),paidModelCalls:0,synthetic:true,publicActionAuditFixture:actionAudit.snapshot(),scope:'Current frozen runScheduled pipeline, scripted HostResults/session ledgers, schema-repair, post-hoc action rejection and normal coordinator identity/usage accounting. Does not establish live CLI/provider availability or replace real native-ledger audit.',modelsUnderTest:manifest.models.map(value=>value.slug),results};
}
