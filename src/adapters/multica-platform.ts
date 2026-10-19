import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,writeFileSync,realpathSync,lstatSync,renameSync} from 'node:fs';
import {dirname,join,relative,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

type Context={cwd:string;sessionManager:{getSessionId():string}};
export type PlatformSettings={cli:string;serverUrl:string;workspaceId:string;proxy?:string;artifactRoot?:string;requireAnswer?:boolean};
export type PlatformScope={cwd:string;sessionId:string;issueId:string;workspaceId:string;agentId?:string};
type Submission={report:string;answer?:Record<string,unknown>};
type Bundle={id:string;issueId:string;sessionId:string;reportSHA256:string;answerSHA256?:string;reportPath:string;answerPath?:string};
type Receipt=Bundle&{confirmed:true;commentId:string;result_ref:string;authorId:string;confirmedAt:string};
type Runner=(scope:PlatformScope,args:string[])=>Promise<any>;
export type PlatformOptions={run?:Runner;env?:NodeJS.ProcessEnv;validate?:(input:Submission,scope:PlatformScope)=>void;answerSchema?:Record<string,unknown>;requireAnswer?:boolean};
const sha=(s:string|Buffer)=>createHash('sha256').update(s).digest('hex');
const json=(p:string)=>JSON.parse(readFileSync(p,'utf8'));
const cleanId=(id:unknown)=>{if(typeof id!=='string'||!/^[a-zA-Z0-9_-]{1,200}$/.test(id))throw Error('A runtime-bound Issue ID is required');return id;};
const stable=(value:any):any=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,stable(value[k])])):value;
function writeAtomic(file:string,value:string){mkdirSync(dirname(file),{recursive:true});const temp=file+'.'+process.pid+'.tmp';writeFileSync(temp,value,{mode:0o600});renameSync(temp,file);}
function managedDirectory(cwd:string,path:string){
 let current=cwd;
 for(const part of relative(cwd,path).split('/')){
  if(part==='..')throw Error('Managed delivery path escaped the task directory');
  current=join(current,part);if(existsSync(current)&&lstatSync(current).isSymbolicLink())throw Error('Managed delivery paths cannot use symbolic links');
 }
 mkdirSync(path,{recursive:true});
}
const result=(data:unknown)=>({content:[{type:'text',text:JSON.stringify(data)}],details:data});
const schema=(properties:Record<string,unknown>,required:string[]=[])=>({type:'object',properties,required,additionalProperties:false});
export function deliveryDirectory(settings:Pick<PlatformSettings,'artifactRoot'>,scope:Pick<PlatformScope,'cwd'|'issueId'|'sessionId'>){
 return settings.artifactRoot?join(resolve(settings.artifactRoot),cleanId(scope.issueId),cleanId(scope.sessionId),'output'):join(scope.cwd,'output');
}

/** Optional application integration. It owns delivery, not Cairn's reasoning or data access. */
export class MulticaPlatform {
 private readonly scopes=new Map<string,PlatformScope>();
 private readonly submitting=new Map<string,Promise<unknown>>();
 private readonly env:NodeJS.ProcessEnv;
 private readonly run:Runner;
 constructor(readonly settings:PlatformSettings,readonly options:PlatformOptions={}){
  this.env=options.env??process.env;
  this.run=options.run??(async(scope,args)=>{
   const env={...this.env};
   if(settings.proxy)for(const k of ['HTTP_PROXY','HTTPS_PROXY','http_proxy','https_proxy'])env[k]=settings.proxy;
   for(const k of ['NO_PROXY','no_proxy'])env[k]='localhost,127.0.0.1,::1';
   const {stdout}=await promisify(execFile)(settings.cli,['--server-url',settings.serverUrl,'--workspace-id',scope.workspaceId,...args,'--output','json'],{cwd:scope.cwd,env,shell:false,timeout:30000,maxBuffer:8*1024*1024});
   return JSON.parse(stdout);
  });
 }
 scope(ctx:Context,input:{issue_id?:string}={}):PlatformScope {
  const sessionId=ctx.sessionManager.getSessionId(),cwd=realpathSync(ctx.cwd);
  if(!sessionId)throw Error('Native session identity is required');
  let bound=this.scopes.get(sessionId);
  if(!bound){
   const file=join(cwd,'.multica/daemon_task_context.json');
   const meta=existsSync(file)?json(file):{};
   const issueId=cleanId(this.env.MULTICA_ISSUE_ID??meta.issue_id);
   bound={cwd,sessionId,issueId,workspaceId:this.env.MULTICA_WORKSPACE_ID??meta.workspace_id??this.settings.workspaceId,agentId:this.env.MULTICA_AGENT_ID??meta.agent_id};
   this.scopes.set(sessionId,bound);
  }
  if(cwd!==bound.cwd)throw Error('This native session changed its working directory; start a separate task session');
  if(input.issue_id&&input.issue_id!==bound.issueId)throw Error('This tool may only operate on its runtime-bound Issue');
  return {...bound};
 }
 private base(scope:PlatformScope){const base=this.settings.artifactRoot?resolve(this.settings.artifactRoot):scope.cwd;mkdirSync(base,{recursive:true});return base;}
 private root(scope:PlatformScope){return this.settings.artifactRoot?join(dirname(deliveryDirectory(this.settings,scope)),'.managed'):join(scope.cwd,'.multica/deliverables',scope.issueId);}
 prepare(ctx:Context){
  const scope=this.scope(ctx);
  if(this.settings.artifactRoot){
   const output=this.output(scope),required=['REPORT.md','receipt.json'];
   if(this.options.requireAnswer??this.settings.requireAnswer)required.push('answer.json');
   process.env.CAIRN_VERIFY_ARTIFACTS=JSON.stringify(required.map(name=>join(output,name)));
   process.env.CAIRN_MULTICA_ISSUE_ID=scope.issueId;process.env.CAIRN_MULTICA_SESSION_ID=scope.sessionId;
   process.env.MULTICA_ARTIFACT_ROOT=resolve(this.settings.artifactRoot);
  }
  return scope;
 }
 private output(scope:PlatformScope){
  const dir=deliveryDirectory(this.settings,scope);managedDirectory(this.base(scope),dir);
  const ownership=join(dir,'.issue-owner.json');
  try{writeFileSync(ownership,JSON.stringify({issueId:scope.issueId}),{flag:'wx',mode:0o600});}
  catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;}
  if(lstatSync(ownership).isSymbolicLink()||json(ownership).issueId!==scope.issueId)throw Error('This output directory belongs to another Issue. Use a separate working directory');
  return dir;
 }
 save(ctx:Context,input:Submission){
  const scope=this.scope(ctx);if(!input.report?.trim())throw Error('report must be a nonempty Markdown document');
  if((this.options.requireAnswer??this.settings.requireAnswer)&&!input.answer)throw Error('A structured answer is required for this application');
  this.options.validate?.(input,scope);
  const answer=input.answer===undefined?undefined:JSON.stringify(stable(input.answer),null,2)+'\n';
  const reportSHA256=sha(input.report),answerSHA256=answer===undefined?undefined:sha(answer);
  const id=sha(JSON.stringify([scope.issueId,reportSHA256,answerSHA256??null]));
  const output=this.output(scope),dir=join(this.root(scope),'bundles',id);managedDirectory(this.base(scope),dir);
  const reportPath=join(dir,'REPORT.md'),answerPath=answer===undefined?undefined:join(dir,'answer.json');
  const bundle:Bundle={id,issueId:scope.issueId,sessionId:scope.sessionId,reportSHA256,answerSHA256,reportPath,answerPath};
  for(const [file,content] of [[reportPath,input.report],...(answerPath?[[answerPath,answer!]]:[])] as [string,string][]){
   if(existsSync(file)){if(lstatSync(file).isSymbolicLink()||readFileSync(file,'utf8')!==content)throw Error('An immutable deliverable bundle was modified');}
   else writeFileSync(file,content,{flag:'wx',mode:0o600});
  }
  const manifest=join(dir,'bundle.json');if(!existsSync(manifest))writeFileSync(manifest,JSON.stringify(bundle,null,2),{flag:'wx',mode:0o600});
  writeAtomic(join(output,'REPORT.md'),input.report);if(answer!==undefined)writeAtomic(join(output,'answer.json'),answer);
  const previous=join(output,'receipt.json');
  if(!existsSync(previous)||json(previous).id!==id)writeAtomic(previous,JSON.stringify({id,issueId:scope.issueId,confirmed:false}));
  return {bundle_id:id,report_path:join(output,'REPORT.md'),answer_path:answer===undefined?undefined:join(output,'answer.json'),receipt_path:previous,reportSHA256,answerSHA256,next:'Call platform_report_submit with this bundle_id. Do not regenerate the report or answer.'};
 }
 private bundle(scope:PlatformScope,id:string):Bundle {
  if(!/^[a-f0-9]{64}$/.test(id))throw Error('bundle_id must be the value returned by platform_report_save');
  const dir=join(this.root(scope),'bundles',id);managedDirectory(this.base(scope),dir);
  const bundle:Bundle=json(join(dir,'bundle.json'));
  if(bundle.id!==id||bundle.issueId!==scope.issueId||bundle.sessionId!==scope.sessionId||bundle.reportPath!==join(dir,'REPORT.md')||bundle.answerPath!==undefined&&bundle.answerPath!==join(dir,'answer.json'))throw Error('The deliverable bundle belongs to another task or was modified');
  for(const [file,hash] of [[bundle.reportPath,bundle.reportSHA256],...(bundle.answerPath?[[bundle.answerPath,bundle.answerSHA256!]]:[])] as [string,string][]){
   if(lstatSync(file).isSymbolicLink()||sha(readFileSync(file))!==hash)throw Error('The saved deliverable changed; save and validate a new bundle before publishing');
  }
  return bundle;
 }
 private async comments(scope:PlatformScope){
  const response=await this.run(scope,['issue','comment','list',scope.issueId,'--recent','100','--compact']);
  const rows=Array.isArray(response)?response:response.comments??response.items??[];
  const flatten=(items:any[]):any[]=>items.flatMap(x=>[x,...flatten(x.replies??x.children??[])]);
  return flatten(rows);
 }
 private async readback(scope:PlatformScope,bundle:Bundle,required=false){
  const marker=`<!-- multica-delivery:${bundle.id} -->`,expected=readFileSync(bundle.reportPath,'utf8').trim();
  const comment=(await this.comments(scope)).find(c=>typeof c.content==='string'&&c.content.includes(marker));
  if(!comment){if(required)throw Error('Platform readback has not confirmed this delivery. Retry the same bundle_id; do not regenerate artifacts');return undefined;}
  if(comment.author_type!=='agent'||scope.agentId&&comment.author_id!==scope.agentId)throw Error('Delivery author does not match the runtime agent');
  if(comment.content.replace(marker,'').trim()!==expected)throw Error('The platform report differs from the saved bundle');
  const expectedFiles=[['REPORT.md',readFileSync(bundle.reportPath).byteLength],...(bundle.answerPath?[['answer.json',readFileSync(bundle.answerPath).byteLength]]:[])];
  for(const [name,bytes] of expectedFiles)if(!comment.attachments?.some((a:any)=>a.filename===name&&a.size_bytes===bytes&&a.uploader_type==='agent'&&a.uploader_id===comment.author_id))throw Error(`Platform attachment ${name} is missing or has the wrong uploader/size`);
  return comment;
 }
 async submit(ctx:Context,id:string):Promise<unknown>{
  const scope=this.scope(ctx),key=JSON.stringify([scope.cwd,scope.issueId,id]);
  let pending=this.submitting.get(key);if(pending)return pending;
  pending=this.publish(scope,id);this.submitting.set(key,pending);
  try{return await pending;}finally{this.submitting.delete(key);}
 }
 private async publish(scope:PlatformScope,id:string){
  const bundle=this.bundle(scope,id),output=this.output(scope),marker=`<!-- multica-delivery:${id} -->`;
  const current=()=>{if(json(join(output,'receipt.json')).id!==id)throw Error('A newer report bundle is active. Submit its bundle_id instead');};
  current();
  // Read before posting, including on a retry whose previous response was lost.
  let comment=await this.readback(scope,bundle);
  if(!comment){
   const content=join(dirname(bundle.reportPath),'COMMENT.md');writeAtomic(content,readFileSync(bundle.reportPath,'utf8').trim()+'\n\n'+marker);
   const args=['issue','comment','add',scope.issueId,'--content-file',content,'--attachment',bundle.reportPath];
   if(bundle.answerPath)args.push('--attachment',bundle.answerPath);
   if(this.settings.artifactRoot)args.push('--allow-external-file'); // Only validated, host-owned bundle paths can reach this flag.
   current();
   try{await this.run(scope,args);}catch(error){
    comment=await this.readback(scope,bundle);
    if(!comment)throw Error(`Delivery response was not confirmed. Retry platform_report_submit with the same bundle_id: ${(error as Error).message}`);
   }
   comment??=await this.readback(scope,bundle,true);
  }
  const receipt:Receipt={...bundle,confirmed:true,commentId:comment.id,result_ref:'multica-comment:'+comment.id,authorId:comment.author_id,confirmedAt:new Date().toISOString()};
  current();
  const receiptPath=join(output,'receipt.json');
  writeAtomic(join(dirname(bundle.reportPath),'receipt.json'),JSON.stringify(receipt,null,2));writeAtomic(receiptPath,JSON.stringify(receipt,null,2));
  await this.run(scope,['issue','status',scope.issueId,'in_review','--no-start']);
  return {...receipt,receipt_path:receiptPath,status:'delivered_pending_review',correctness:'not independently assessed'};
 }
 async receipt(ctx:Context){
  const scope=this.scope(ctx),file=join(deliveryDirectory(this.settings,scope),'receipt.json');
  if(!existsSync(file)||!json(file).confirmed)return {confirmed:false,status:'not_submitted',issueId:scope.issueId};
  const receipt:Receipt=json(file),bundle=this.bundle(scope,receipt.id);
  await this.readback(scope,bundle,true);
  return {...receipt,receipt_path:file,correctness:'not independently assessed'};
 }
 async read(ctx:Context){const scope=this.scope(ctx);return this.run(scope,['issue','get',scope.issueId]);}
 async status(ctx:Context,status:string){
  const scope=this.scope(ctx);if(!['in_progress','in_review','blocked'].includes(status))throw Error('Unsupported Issue status');
  if(status==='in_review'&&!(await this.receipt(ctx)).confirmed)throw Error('Deliver and confirm a report before marking the Issue in_review');
  return this.run(scope,['issue','status',scope.issueId,status,'--no-start']);
 }
}

export function registerMulticaPlatform(pi:any,settings:PlatformSettings,options:PlatformOptions={}){
 const requireAnswer=options.requireAnswer??settings.requireAnswer??false,bridge=new MulticaPlatform(settings,{...options,requireAnswer}),str={type:'string'};
 const add=(name:string,description:string,parameters:unknown,execute:(ctx:Context,input:any)=>unknown)=>pi.registerTool({name,label:name,description,parameters,execute:async(_id:string,input:any,_signal:any,_update:any,ctx:Context)=>result(await execute(ctx,input))});
 // Load this optional extension before Cairn so trusted per-run artifact paths
 // are configured before the native engine opens its shared blackboard.
 pi.on('session_start',(_e:unknown,ctx:Context)=>{bridge.prepare(ctx);});
 add('platform_issue_read','Read only the current runtime-bound Issue.',schema({}),(ctx)=>bridge.read(ctx));
 add('platform_issue_update','Update the current Issue without spawning a run. in_review requires confirmed report delivery; report submission sets it automatically.',schema({status:{enum:['in_progress','in_review','blocked']}},['status']),(ctx,input)=>bridge.status(ctx,input.status));
 add('platform_report_save',`Save one immutable report and ${requireAnswer?'required':'optional'} structured answer. Returns bundle_id and durable artifact paths. Then submit only that bundle_id; never regenerate the same content for submission.`,schema({report:str,answer:options.answerSchema??{type:'object',additionalProperties:true}},requireAnswer?['report','answer']:['report']),(ctx,input)=>bridge.save(ctx,input));
 add('platform_report_submit','Publish the saved bundle to this Issue as the current agent, verify its actual report and attachments, and mark it in_review. Retry the same bundle_id after a lost response. Delivery does not establish root-cause correctness.',schema({bundle_id:str},['bundle_id']),(ctx,input)=>bridge.submit(ctx,input.bundle_id));
 add('platform_report_receipt','Read the actual platform report and attachments back. Returns confirmed:false before delivery.',schema({}),(ctx)=>bridge.receipt(ctx));
 return bridge;
}

export function verifyMulticaDelivery(cwd:string,options:{artifactRoot?:string;issueId?:string;sessionId?:string}={}){
 try{
  const artifactRoot=options.artifactRoot??process.env.MULTICA_ARTIFACT_ROOT;
  const meta=options.issueId||process.env.CAIRN_MULTICA_ISSUE_ID?{}:json(join(cwd,'.multica/daemon_task_context.json'));
  const issueId=options.issueId??process.env.CAIRN_MULTICA_ISSUE_ID??meta.issue_id,sessionId=options.sessionId??process.env.CAIRN_MULTICA_SESSION_ID??'';
  const output=deliveryDirectory({artifactRoot},{cwd,issueId,sessionId}),receipt:Receipt=json(join(output,'receipt.json'));
  if(!receipt.confirmed||receipt.issueId!==issueId||artifactRoot&&receipt.sessionId!==sessionId)throw Error('The current Issue has no confirmed delivery');
  if(sha(readFileSync(join(output,'REPORT.md')))!==receipt.reportSHA256)throw Error('REPORT.md differs from the confirmed delivery');
  if(receipt.answerSHA256&&sha(readFileSync(join(output,'answer.json')))!==receipt.answerSHA256)throw Error('answer.json differs from the confirmed delivery');
  return {status:'passed',summary:'Current Issue report and artifacts match the confirmed platform delivery. Root-cause correctness is not independently assessed.'};
 }catch(error){return {status:'failed',summary:(error as Error).message};}
}

export default function extension(pi:any){
 const file=process.env.MULTICA_PLATFORM_CONFIG??join(dirname(fileURLToPath(import.meta.url)),'multica-platform.json');
 registerMulticaPlatform(pi,json(file));
}
