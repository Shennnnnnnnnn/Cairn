// Offline reload check on copies of real case databases. No model calls or timeout-rate claim.
import {createHarness} from '../../dist/index.js';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,readFileSync,writeFileSync,readdirSync,existsSync,rmSync} from 'node:fs';
import {join,resolve,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash,randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
const here=dirname(fileURLToPath(import.meta.url)),root=join(here,'runs',process.argv[2]??'2026-10-17-aiops2022-round3c');
if(!['case-01','case-02','case-03','case-04'].every(name=>existsSync(join(root,name,'pi-cairn/episode.metrics.json'))))throw new Error('Wait for all four Cairn episodes to finish; do not inspect a live database');
const scratch=mkdtempSync(join(tmpdir(),'cairn-real-handoff-reload-')),results=[];
const sha=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
const states=path=>{const db=new DatabaseSync(path,{readOnly:true});try{return JSON.stringify(db.prepare('SELECT id,state FROM tasks ORDER BY id').all());}finally{db.close();}};
try{
 for(const caseName of ['case-01','case-02','case-03','case-04']){
  const dir=join(root,caseName,'pi-cairn'),tasks=JSON.parse(readFileSync(join(dir,'initial.cairn-tasks.json'),'utf8')),initial=tasks.at(-1);
  if(!initial){results.push({case:caseName,passed:false,reason:'Actor did not create a task'});continue;}
  const source=join(dir,'workspace/.cairn/state.db'),copy=join(scratch,caseName+'.db');
  const sourceStates=states(source);
  const backup=spawnSync('python3',['-c','import sqlite3,sys; s=sqlite3.connect("file:"+sys.argv[1]+"?mode=ro",uri=True); d=sqlite3.connect(sys.argv[2]); s.backup(d); d.close(); s.close()',source,copy],{encoding:'utf8',timeout:10000});
  if(backup.status!==0)throw new Error(backup.stderr||'Database backup failed');
  const session={host:'pi',sessionId:'offline-reload-'+randomUUID(),cwd:initial.owner.cwd},h=createHarness({database:copy,session});
  try{
   const before=h.engine.store.get(initial.id),expectedArtifacts=(before.artifacts??[]).map(a=>({path:a.path,sha256:sha(a.path)}));
   const mode=before.status==='completed'?'explicit-reopen-of-completed-clone':'resume-incomplete-clone';
   if(before.status==='completed')h.engine.reopen(before.id,session,'Offline restoration rehearsal on a disposable database copy',{takeover:true,author:'human'});
   else h.engine.resume(before.id,session,true);
   const after=h.engine.store.get(before.id),focus=before.handoffs?.at(-1)?.from?.[0];
   const context=await h.tools.invoke('cairn_read',{task_id:before.id,view:'context',...(focus?{focus}:{})});
   const contextBytes=Buffer.byteLength(JSON.stringify(context));
   const handoffs=context.handoffs??[],reports=handoffs.filter(v=>v.report).map(v=>({key:v.key,report:v.report,exists:existsSync(resolve(session.cwd,v.report)),sessionRef:v.sessionRef,nativeSessionExists:(readdirSync(join(dir,'sessions')).some(name=>name.includes(v.sessionRef?.slice(3))))}));
   const checks={goalAndOriginPreserved:after.goal===before.goal&&after.origin===before.origin,constraintsPreserved:JSON.stringify(after.constraints)===JSON.stringify(before.constraints),epochAdvanced:after.owner.epoch>before.owner.epoch,newOwner:after.owner.sessionId===session.sessionId,oldVerdictNotReused:context.verification?.current!==true,contextBounded:contextBytes<=16384,focusedSourceRetained:!focus||context.claims.some(c=>'claim:'+c.id===focus),handoffAvailable:handoffs.length>0,reportAndNativeLocatorsAvailable:reports.length>0&&reports.every(r=>r.exists&&r.nativeSessionExists),artifactBytesUnchanged:expectedArtifacts.every(a=>sha(a.path)===a.sha256),originalDatabaseUnchanged:states(source)===sourceStates};
   results.push({case:caseName,mode,taskId:before.id,checks,passed:Object.values(checks).every(Boolean),contextBytes,reports});
  }finally{await h.close();}
 }
}finally{rmSync(scratch,{recursive:true,force:true});}
const result={kind:'Offline reload of real persisted graphs on disposable database copies; not a model timeout-recovery experiment',results,passed:results.filter(v=>v.passed).length,total:results.length};
writeFileSync(join(root,'handoff-restoration.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
if(result.passed!==result.total)process.exitCode=1;
