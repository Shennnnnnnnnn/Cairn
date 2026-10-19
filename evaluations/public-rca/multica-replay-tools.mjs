import fs from 'node:fs';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';

const below=(p,dir)=>p===dir||p.startsWith(dir+path.sep);
const hash=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const walk=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):[path.join(dir,e.name)]).filter(p=>p.endsWith('.csv'));
function csv(file){
 const text=fs.readFileSync(file,'utf8'),table=[];let row=[],value='',quoted=false;
 for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){value+='"';i++;}else quoted=!quoted;}else if(!quoted&&(c===','||c==='\n')){row.push(value.replace(/\r$/,''));value='';if(c==='\n'){if(row.some(Boolean))table.push(row);row=[];}}else value+=c;}
 if(value||row.length){row.push(value);table.push(row);}const headers=table.shift()??[];
 const raw=table.map(r=>Object.fromEntries(headers.map((h,i)=>[h,r[i]??''])));
 if(headers.includes('value'))return {headers,rows:raw};
 const entity=headers.find(k=>['cmdb_id','service','entity','node','host'].includes(k));
 if(!entity||!headers.includes('timestamp'))throw Error('CSV requires timestamp and entity columns');
 const metrics=headers.filter(k=>k!==entity&&k!=='timestamp'&&raw.some(r=>r[k]!==''&&Number.isFinite(Number(r[k]))));
 return {headers,rows:raw.flatMap(r=>metrics.map(k=>({timestamp:r.timestamp,cmdb_id:r[entity],kpi_name:k,value:r[k]})))};
}
function points(rows,mode){
 const values=rows.filter(r=>String(r.timestamp??'').trim()!==''&&String(r.value??'').trim()!=='').map(r=>({t:Number(r.timestamp),v:Number(r.value)})).filter(r=>Number.isFinite(r.t)&&Number.isFinite(r.v)).sort((a,b)=>a.t-b.t);
 const missingValues=rows.length-values.length,duplicateTimestamps=values.length-new Set(values.map(x=>x.t)).size;
 if(mode!=='rate')return {values,missingValues,duplicateTimestamps,negativeIntervals:0};
 const rate=[];let negativeIntervals=0;
 for(let i=1;i<values.length;i++){const dt=values[i].t-values[i-1].t,dv=values[i].v-values[i-1].v;if(dt<=0)continue;if(dv<0){negativeIntervals++;continue;}rate.push({t:values[i].t,v:dv/dt});}
 return {values:rate,missingValues,duplicateTimestamps,negativeIntervals};
}
function stats(values){if(!values.length)return {n:0,mean:null,min:null,max:null,firstTimestamp:null,lastTimestamp:null};const v=values.map(x=>x.v).sort((a,b)=>a-b);return {n:v.length,mean:v.reduce((a,b)=>a+b,0)/v.length,min:v[0],max:v.at(-1),median:v[Math.floor(v.length/2)],firstTimestamp:values[0].t,lastTimestamp:values.at(-1).t};}
const str={type:'string'},num={type:'number'},strings={type:'array',items:str,minItems:1};
export function registerReplayTools(pi,registerPlatform,settings){
 const states=new Map();let bridge;
 const state=scope=>{
  const key=JSON.stringify([scope.cwd,scope.sessionId,scope.issueId]);if(states.has(key))return states.get(key);
  const bindings=JSON.parse(fs.readFileSync(settings.bindings,'utf8')),binding=bindings.issues[scope.issueId];
  if(!binding)throw Error('No offline data source is bound to this Issue');
  const root=fs.realpathSync(path.resolve(scope.cwd,binding.relativeCasePath));if(!below(root,scope.cwd))throw Error('Replay data must stay inside the isolated working directory');
  const evidence=fs.realpathSync(path.join(root,'evidence'));
  const canonicalRoot=settings.sourceRoot?fs.realpathSync(path.resolve(settings.sourceRoot,binding.relativeCasePath)):root;
  const output=settings.platform.artifactRoot?path.join(settings.platform.artifactRoot,scope.issueId,scope.sessionId,'output'):path.join(scope.cwd,'output');fs.mkdirSync(output,{recursive:true});const out=fs.realpathSync(output);
  const owner=path.join(out,'.data-owner.json');try{fs.writeFileSync(owner,JSON.stringify({issueId:scope.issueId}),{flag:'wx'});}catch(e){if(e.code!=='EEXIST')throw e;}
  if(JSON.parse(fs.readFileSync(owner,'utf8')).issueId!==scope.issueId)throw Error('Another Issue owns this data/output directory');
  const files=walk(evidence);for(const file of files)if(hash(file)!==hash(path.join(canonicalRoot,path.relative(root,file))))throw Error('The execution input differs from its retained original source');
  const inputHash=createHash('sha256').update(JSON.stringify(files.map(p=>[path.relative(root,p),hash(p)]))).digest('hex');
  const ledger=path.join(out,'evidence-calls.jsonl'),refs=new Map();
  if(fs.existsSync(ledger))for(const line of fs.readFileSync(ledger,'utf8').split('\n').filter(Boolean)){const r=JSON.parse(line);if(r.issueId===scope.issueId&&r.inputHash===inputHash)refs.set(r.result_ref,r);}
  const s={root,canonicalRoot,evidence,out,files,ledger,refs,inputHash,scope};states.set(key,s);return s;
 };
 const source=(s,file)=>{let p=fs.realpathSync(path.resolve(s.root,file));if(below(p,path.join(s.canonicalRoot,'evidence')))p=path.join(s.root,path.relative(s.canonicalRoot,p));if(!below(p,s.evidence)||!p.endsWith('.csv'))throw Error('Only this Issue evidence CSV is readable');return p;};
 const answerSchema={type:'object',properties:{candidates:{type:'array',minItems:1,maxItems:3,items:{type:'object',properties:{location:str,level:{enum:['pod','node','service']},service:{type:['string','null']},fault_family:{enum:['cpu','memory','disk_io','network','unknown']},confidence:{type:'number',minimum:0,maximum:1},reason:str},required:['location','level','service','fault_family','confidence','reason'],additionalProperties:false}},evidence:{type:'array',minItems:2,items:{type:'object',properties:{result_ref:str,statement:str},required:['result_ref','statement'],additionalProperties:false}}},required:['candidates','evidence'],additionalProperties:false};
 bridge=registerPlatform(pi,settings.platform,{answerSchema,requireAnswer:true,validate:(input,scope)=>{
  const s=state(scope),a=input.answer;
  if(!a||!Array.isArray(a.candidates)||!a.candidates.length||a.candidates.length>3||!Array.isArray(a.evidence)||a.evidence.length<2)throw Error('A structured answer with 1-3 candidates and at least two evidence entries is required');
  for(const e of a.evidence)if(!s.refs.has(e.result_ref)||typeof e.statement!=='string'||!e.statement.trim())throw Error('Each evidence entry requires result_ref from this Issue and a statement; use the exact returned field name');
  const mentioned=input.report.match(/replay-local:[a-f0-9-]{36}/g)??[];
  if(!mentioned.length||mentioned.some(ref=>!s.refs.has(ref)))throw Error('The report must cite actual query references from this Issue');
 }});
 pi.on('session_start',(_event,ctx)=>state(bridge.scope(ctx)));
 pi.on('before_agent_start',(_event,ctx)=>{
  const s=state(bridge.scope(ctx));
  return {message:{customType:'task-workspace',display:false,content:JSON.stringify({workspace:s.scope.cwd,taskInput:s.root,taskFile:path.join(s.root,'TASK.md'),retainedSource:s.canonicalRoot,deliverables:s.out,scope:'Only this task input/source and deliverables are readable. Do not scan the project root or sibling tasks. Use evidence_query for file and metric discovery; platform tools already have the current Issue identity.'})}};
 });
 pi.on('tool_call',(event,ctx)=>{
  if(['bash','powershell','write','edit'].includes(event.toolName))return {block:true,reason:'Only controlled reads and delivery are authorized'};
  if(!['read','grep','find','ls'].includes(event.toolName))return;
  const s=state(bridge.scope(ctx)),requested=event.input?.path??event.input?.file_path??ctx.cwd;
  try{const p=fs.realpathSync(path.resolve(ctx.cwd,requested));
   const cwd=fs.realpathSync(ctx.cwd),sourceRoot=settings.sourceRoot&&fs.realpathSync(settings.sourceRoot);
   const navigation=event.toolName==='ls'&&(below(p,cwd)&&below(s.root,p)||sourceRoot&&below(p,sourceRoot)&&below(s.canonicalRoot,p));
   const bundles=settings.platform.artifactRoot?path.join(path.dirname(s.out),'.managed/bundles'):path.join(cwd,'.multica/deliverables',s.scope.issueId,'bundles');
   const allowed=below(p,s.root)||below(p,s.canonicalRoot)||below(p,s.out)||below(p,bundles)||below(p,settings.skillRoot??path.join(settings.runtimeRoot,'skills'))||p===path.join(ctx.cwd,'AGENTS.md')||below(p,path.join(ctx.cwd,'.pi/skills'))||navigation;
   if(!allowed)return {block:true,reason:'Other Issues, answer keys, archives and configuration are outside this task scope'};
  }catch{return {block:true,reason:'This task path is unavailable'};}
 });
 pi.registerTool({name:'evidence_query',label:'Read offline evidence',description:'Read-only offline CSV query. catalog lists files and coverage compactly; compare returns per-entity/metric window statistics; series gives sampled points. file is the retained original source path; relativeFile is accepted for queries. calculate operates on numeric values selected by result_ref and JSON pointer, e.g. /items/0/after/mean, with an optional scaling constant. ratio=left/right; difference=left-right; product=left*right; percent_change=100*(left-right)/right. Use this for ratios/conversions instead of mental arithmetic. Value units and bucket semantics remain unknown unless documented; timestamps are Unix seconds. A pre-reference timestamp cannot be asserted to contain post-reference activity without bucket documentation. rate counts excluded negative intervals; a decrease alone proves neither reset nor rate. Missing stays unknown. Mixed-unit sorting is navigation, never a fault score. References are replay-local, not official competition evidence.',parameters:{type:'object',properties:{action:{enum:['catalog','compare','series','calculate']},files:strings,entities:strings,metrics:strings,metric_contains:str,mode:{enum:['gauge','rate']},before:{type:'array',items:num,minItems:2,maxItems:2},after:{type:'array',items:num,minItems:2,maxItems:2},sort_by:{enum:['abs_delta','ratio','after_max']},limit:{type:'integer',minimum:1,maximum:200},calculation:{type:'object',properties:{operation:{enum:['ratio','difference','product','percent_change']},operands:{type:'array',minItems:2,maxItems:2,items:{type:'object',properties:{result_ref:str,pointer:str,constant:num},additionalProperties:false}}},required:['operation','operands'],additionalProperties:false}},required:['action'],additionalProperties:false},execute:async(_id,input,_signal,_update,ctx)=>{
  const scope=bridge.scope(ctx),s=state(scope),files=input.files?.map(f=>source(s,f))??s.files,limit=input.limit??20;let result;
  if(input.action==='calculate'){
   const calculation=input.calculation;if(!calculation||calculation.operands.length!==2||!calculation.operands.some(x=>x.result_ref))throw Error('calculate requires two operands and at least one actual query reference');
   const values=calculation.operands.map(operand=>{
    if(operand.constant!==undefined){if(operand.result_ref||!Number.isFinite(operand.constant))throw Error('A scaling constant cannot also select a source');return operand.constant;}
    const record=s.refs.get(operand.result_ref);if(!record||typeof operand.pointer!=='string'||!operand.pointer.startsWith('/'))throw Error('Select an existing result_ref and numeric JSON pointer from this Issue');
    let value=record.result;for(const part of operand.pointer.slice(1).split('/').map(x=>x.replaceAll('~1','/').replaceAll('~0','~'))){if(['__proto__','constructor','prototype'].includes(part)||!value||typeof value!=='object'||!Object.hasOwn(value,part))throw Error('Numeric source pointer is unavailable');value=value[part];}
    if(typeof value!=='number'||!Number.isFinite(value))throw Error('The selected source is missing or nonnumeric');return value;
   });
   const [left,right]=values,op=calculation.operation;
   const value=['ratio','percent_change'].includes(op)&&right===0?null:op==='ratio'?left/right:op==='difference'?left-right:op==='product'?left*right:100*(left-right)/right;
   result={operation:op,operands:calculation.operands,inputValues:values,value,reason:value===null?'zero denominator; ratio is unknown':undefined,unit:'Arithmetic result only; physical units/causal interpretation require source documentation'};
  }else if(input.action==='catalog'){
   const entitySets={};const entries=files.map(file=>{const c=csv(file),entities=[...new Set(c.rows.map(r=>r.cmdb_id))],kind=path.basename(path.dirname(file));entitySets[kind]=[...new Set([...(entitySets[kind]??[]),...entities])];return {file:path.join(s.canonicalRoot,path.relative(s.root,file)),relativeFile:path.relative(s.root,file),rows:c.rows.length,entityCount:entities.length,...(input.files?{entities}:{}),metrics:[...new Set(c.rows.map(r=>r.kpi_name??path.basename(file,'.csv')))]};});
   result={files:entries,entities:entitySets,timestampUnit:'Unix seconds',valueUnits:'unknown unless documented',bucketSemantics:'unknown'};
  }else{
   if(input.action==='compare'&&(!input.before||!input.after||input.before[0]>input.before[1]||input.after[0]>input.after[1]))throw Error('compare requires ordered before/after Unix-second intervals');
   const items=[];
   for(const file of files){const groups=new Map();for(const row of csv(file).rows){const entity=row.cmdb_id,metric=row.kpi_name??path.basename(file,'.csv');if(input.entities&&!input.entities.includes(entity)||input.metrics&&!input.metrics.includes(metric)||input.metric_contains&&!metric.includes(input.metric_contains))continue;const key=JSON.stringify([entity,metric]);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(row);}
    for(const [key,rows] of groups){const [entity,metric]=JSON.parse(key),p=points(rows,input.mode),base={file:path.join(s.canonicalRoot,path.relative(s.root,file)),relativeFile:path.relative(s.root,file),entity,metric,mode:input.mode??'gauge',missingValues:p.missingValues,duplicateTimestamps:p.duplicateTimestamps,negativeIntervals:p.negativeIntervals};
     if(input.action==='series'){items.push({...base,points:p.values});continue;}
     const before=stats(p.values.filter(x=>x.t>=input.before[0]&&x.t<=input.before[1])),after=stats(p.values.filter(x=>x.t>=input.after[0]&&x.t<=input.after[1]));items.push({...base,before,after,delta:before.mean===null||after.mean===null?null:after.mean-before.mean,ratio:before.mean===null||after.mean===null||before.mean===0?null:after.mean/before.mean});
    }
   }
   if(input.action==='compare'){const k=input.sort_by??'abs_delta',score=x=>k==='ratio'?x.ratio===null?-Infinity:Math.abs(x.ratio-1):k==='after_max'?x.after.max??-Infinity:Math.abs(x.delta??0);items.sort((a,b)=>score(b)-score(a));}
   result={total:items.length,items:items.slice(0,limit),truncated:items.length>limit,before:input.before,after:input.after,valueUnits:'unknown unless documented',bucketSemantics:'unknown',sorting:'navigation across separate groups; mixed units are not comparable fault scores'};
  }
  const result_ref='replay-local:'+randomUUID(),record={timestamp:new Date().toISOString(),issueId:scope.issueId,sessionId:scope.sessionId,inputHash:s.inputHash,input,result_ref,result};s.refs.set(result_ref,record);fs.appendFileSync(s.ledger,JSON.stringify(record)+'\n');
  return {content:[{type:'text',text:JSON.stringify({...result,result_ref,source:'offline-public-data-replay; not official competition evidence'})}],details:record};
 }});
 return bridge;
}
