import {spawnSync} from 'node:child_process';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {gzipSync} from 'node:zlib';
import {randomUUID,createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {publicEvent} from './public-event.mjs';
import {runScheduled,participationControl} from './scheduler-driver.mjs';

const save=(p,v)=>writeFileSync(p,typeof v==='string'?v:JSON.stringify(v,null,2)+'\n');
export async function fixture({root,manifest}){
 assert.equal(publicEvent({type:'message_end',message:{role:'user',content:'native string'}}).message.content,'native string');
 assert.deepEqual(publicEvent({type:'message_end',message:{role:'assistant',content:[{type:'thinking',thinking:'fixture only'},{type:'text',text:'public'}]}}).message.content,[{type:'text',text:'public'}]);
 assert.equal(publicEvent({type:'message_update',assistantMessageEvent:{type:'thinking_delta'}}),undefined);
 const dir=join(root,'integration-fixture'),work=join(dir,'workspace');mkdirSync(join(work,'evidence'),{recursive:true});
 save(join(work,'TASK.md'),'Fixture: verify tiny multi-source evidence, no model execution.');save(join(work,'DATA.md'),'Synthetic fixture data.');save(join(work,'incident.json'),{incident_time:20});
 save(join(work,'evidence/metrics.csv'),'time,a_cpu,a_nullable\n10,1,\n11,3,\n20,5,4\n21,7,6\n');
 writeFileSync(join(work,'evidence/logs.csv.gz'),gzipSync('timestamp,container_name,message\n10,a,ERROR old\n20,b,INFO\n21,a,ERROR new\n'));
 writeFileSync(join(work,'evidence/traces.csv.gz'),gzipSync('startTimeMillis,serviceName,operationName,duration\n10000,a,query,10\n11000,a,query,30\n20000,a,query,50\n21000,a,query,70\n'));
 const inputNames=['TASK.md','DATA.md','incident.json','evidence/metrics.csv','evidence/logs.csv.gz','evidence/traces.csv.gz'];
 save(join(dir,'input-hashes.json'),Object.fromEntries(inputNames.map(n=>[n,createHash('sha256').update(readFileSync(join(work,n))).digest('hex')])));
 const answer={root_cause_service:'a',fault_family:'application',mechanism:'Fixture only',confidence:0.5,alternatives:[{hypothesis:'x',verdict:'rejected',basis:'fixture'},{hypothesis:'y',verdict:'unknown',basis:'fixture'}]};
 const checks={checks:[
  {key:'metric',kind:'metric_mean',file:'evidence/metrics.csv',column:'a_cpu',purpose:'fixture',expected:{before_count:2,after_count:2,before_mean:2,after_mean:6}},
  {key:'nullable',kind:'metric_mean',file:'evidence/metrics.csv',column:'a_nullable',purpose:'missing stays unknown',expected:{before_count:0,after_count:2,before_mean:null,after_mean:5}},
  {key:'logs',kind:'log_count',file:'evidence/logs.csv.gz',service:'a',contains:'ERROR',purpose:'fixture',expected:{before_count:1,after_count:1}},
  {key:'traces',kind:'trace_summary',file:'evidence/traces.csv.gz',service:'a',purpose:'fixture',expected:{before_count:2,after_count:2,before_duration_median:20,after_duration_median:60}},
 ]};
 const verifyCommand=['/usr/local/bin/python3',join(root,'verify.py'),join(dir,'input-hashes.json')];
 const submit=()=>{save(join(work,'answer.json'),answer);save(join(work,'checks.json'),checks);save(join(work,'REPORT.md'),'Root service a. Tiny synthetic fixture; not a scored diagnostic result.');};submit();
 const verify=()=>{const p=spawnSync(verifyCommand[0],verifyCommand.slice(1),{cwd:work,input:JSON.stringify({owner:{cwd:work}}),encoding:'utf8'});assert.equal(p.status,0);return JSON.parse(p.stdout);};
 assert.equal(verify().ok,true);checks.checks[0].expected.before_mean=999;save(join(work,'checks.json'),checks);assert.equal(verify().ok,false);checks.checks[0].expected.before_mean=2;submit();
 const {Store}=await import(pathToFileURL(join(root,'implementation/dist/index.js')).href);
 let calls=0;
 const runner=async args=>{
  calls++;const request=args.schedulerRequest,id=randomUUID();mkdirSync(join(args.dir,'sessions'));save(join(args.dir,'sessions',id+'.jsonl'),JSON.stringify({type:'session',id,cwd:work})+'\n');args.onSession(id);
  if(calls===1)assert.equal(args.noTools,true,'Initial planning must not perform the investigation itself');
  let output;
  if(request.phase==='explore'){
   const relative='.branches/'+request.branch.key+'/measurement.txt';mkdirSync(join(work,'.branches',request.branch.key),{recursive:true});save(join(work,relative),'Synthetic observed result.');
   await new Promise(resolve=>setTimeout(resolve,100));
   output={decision:'continue',checkpoint:{findings:[{key:'measurement',text:'Synthetic measured evidence '+request.branch.key,basis:'Fixture computation only',references:[relative]}]}};
  }else{
   const store=new Store(join(work,'.cairn/state.db'));let task;try{task=store.get(request.taskId);}finally{store.close();}
   if(!task.claims.length)output={decision:'continue',checkpoint:{questions:['Await the two independent fixture results.']}};
   else {submit();output={decision:'complete',checkpoint:{findings:task.claims.map(c=>({key:c.key,text:c.text,status:'supported',covers:[task.criteria[0].id],basis:c.basis,references:c.references})),artifacts:['answer.json','REPORT.md','checks.json'].map(path=>({path})),report:{summary:'Fixture independently measured and reviewed.'}},...(task.review&&task.review.generation>task.review.acknowledged?{review:{snapshot:task.revision,summary:'Reviewed all returned fixture evidence.'}}:{})};}
  }
  save(join(args.dir,'initial.final.md'),output);save(join(args.dir,'credential-cleanup.json'),{removed:true,fixture:true});save(join(args.dir,'initial.tools.json'),[{name:'read',synthetic:true}]);
  return {threadId:id,exitCode:0,turnFailed:false,finalStopReason:'stop',toolCalls:request.phase==='explore'?1:0,toolErrors:0,actualModels:[],actualEfforts:[],wallSeconds:0.1,usage:{input_tokens:0,cached_input_tokens:0,cache_write_input_tokens:0,output_tokens:0},usageIsLowerBound:false};
 };
 const result=await runScheduled({spec:manifest.model,work,dir,implementation:join(root,'implementation'),prompt:'Read synthetic fixture evidence and review both independent investigations.',common:'No-model pipeline fixture.',verifyCommand,artifacts:['answer.json','REPORT.md','checks.json'],fixture:true,testOnlyNativeRunner:runner});
 assert.equal(result.schedulerStatus,'completed',JSON.stringify(result));
 const explores=result.phases.filter(p=>p.phase==='explore');assert.equal(explores.length,2);assert.notEqual(explores[0].sessionRef,explores[1].sessionRef);assert.ok(Math.max(explores[0].startTime,explores[1].startTime)<Math.min(explores[0].endTime,explores[1].endTime));assert.equal(result.maxConcurrentNative,2);
 const task=JSON.parse(readFileSync(join(dir,'initial.cairn-tasks.json')))[0];assert.ok(task.claims.filter(c=>c.key.startsWith('branch:')&&c.status==='supported').length===2);
 assert.equal(participationControl({progress:[{key:'metric-evidence',branchStatus:'open'},{key:'trace-log-evidence',branchStatus:'open'}]},[]),false);
 const replacementTask={progress:[{key:'old',delegated:true,branchStatus:'open'},{key:'replacement-a',delegated:true,branchStatus:'merged'},{key:'replacement-b',delegated:true,branchStatus:'merged'}],claims:[{branchKey:'replacement-a',basis:'observed a'},{branchKey:'replacement-b',references:['evidence.csv']}]};
 const replacementPhases=[{phase:'reason',sessionRef:'owner'},{phase:'explore',branch:{key:'replacement-a'},sessionRef:'worker-a',metrics:{toolCalls:1}},{phase:'explore',branch:{key:'replacement-b'},sessionRef:'worker-b',metrics:{toolCalls:1}}];
 assert.equal(participationControl(replacementTask,replacementPhases),true,'Successful replacements must count');
 assert.equal(participationControl(replacementTask,replacementPhases.map(p=>p.phase==='explore'?{...p,sessionRef:'same-worker'}:p)),false,'Two branches sharing one native session are not independent');
 assert.equal(participationControl({...replacementTask,claims:[]},replacementPhases),false,'Empty branch results do not count');
 return {passed:true,successfulReplacementBranchesAccepted:true,sameSessionCannotFakeIndependence:true,emptyProposalsCannotPass:true,unstartedDelegationsCannotPass:true,initialPlannerToolsDisabled:true,nativeStringEventVerified:true,privateThinkingExcludedFromPublicAudit:true,numericReplay:true,wrongValueRejected:true,nullNotZero:true,independentExploreSessions:2,parallelExplore:true,ownerPromotedBranchFindings:2,phases:result.phases.map(p=>p.phase),syntheticNativeCalls:calls,paidModelCalls:0};
}
