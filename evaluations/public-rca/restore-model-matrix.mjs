// Offline rehearsal on disposable copies, using each arm's own frozen runtime.
import {spawnSync} from 'node:child_process';
import {mkdtempSync,readFileSync,writeFileSync,readdirSync,existsSync,rmSync} from 'node:fs';
import {join,resolve,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash,randomUUID} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
const here=dirname(fileURLToPath(import.meta.url)),root=join(here,'runs',process.argv[2]);
if(!existsSync(join(root,'finished.json')))throw new Error('Wait for all actors and hidden grading to finish');
const manifest=JSON.parse(readFileSync(join(root,'manifest.json'),'utf8'));
const scratch=mkdtempSync(join(tmpdir(),'cairn-round5-reload-')),results=[];
const sha=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
const states=path=>{const db=new DatabaseSync(path,{readOnly:true});try{return JSON.stringify(db.prepare('SELECT id,state FROM tasks ORDER BY id').all());}finally{db.close();}};
try{
 for(const mode of ['pi-cairn-previous','pi-cairn']){
  const archive=mode==='pi-cairn-previous'?manifest.previousImplementationArchive:manifest.implementationArchive;
  const {createHarness}=await import(pathToFileURL(join(root,archive,'dist/index.js')).href);
  for(const spec of manifest.models){
   const caseName='case-03',slug=spec.slug;
   const dir=manifest.episodeLocations?.[[slug,caseName,mode].join('/')]??join(root,slug,caseName,mode);
   const snapshot=join(dir,'initial.cairn-tasks.json');
   const initial=existsSync(snapshot)?JSON.parse(readFileSync(snapshot,'utf8')).at(-1):undefined;
   if(!initial){results.push({modelSlug:slug,case:caseName,mode,passed:false,reason:'No saved task'});continue;}
   const source=join(dir,'workspace/.cairn/state.db'),copy=join(scratch,slug+'-'+caseName+'-'+mode+'.db'),sourceStates=states(source);
   const backup=spawnSync('python3',['-c','import sqlite3,sys; s=sqlite3.connect("file:"+sys.argv[1]+"?mode=ro",uri=True); d=sqlite3.connect(sys.argv[2]); s.backup(d); d.close(); s.close()',source,copy],{encoding:'utf8',timeout:10000});
   if(backup.status!==0)throw new Error(backup.stderr||'Database backup failed');
   const session={host:'pi',sessionId:'offline-reload-'+randomUUID(),cwd:initial.owner.cwd},h=createHarness({database:copy,session});
   try{
    const before=h.engine.store.get(initial.id),artifacts=(before.artifacts??[]).map(a=>({path:a.path,sha256:sha(a.path)}));
    const savedReports=(before.handoffs??[]).filter(h=>h.report).map(h=>resolve(initial.owner.cwd,h.report)).filter(path=>existsSync(path)).map(path=>({path,sha256:sha(path)}));
    const knownHandoffs=before.handoffs??[],factHandoffs=knownHandoffs.filter(h=>h.from?.length);
    if(before.status==='completed')h.engine.reopen(before.id,session,'Offline restoration rehearsal on disposable copy',{takeover:true,author:'human'});
    else h.engine.resume(before.id,session,true);
    const after=h.engine.store.get(before.id),focus=before.claims.at(-1)?.key;
    const context=await h.tools.invoke('cairn_read',{task_id:before.id,view:'context',...(focus?{focus}:{})});
    const contextBytes=Buffer.byteLength(JSON.stringify(context));
    const reports=(context.handoffs??[]).filter(v=>v.report).map(v=>({key:v.key,report:v.report,exists:existsSync(resolve(session.cwd,v.report)),sessionRef:v.sessionRef,nativeSessionExists:typeof v.sessionRef==='string'&&readdirSync(join(dir,'sessions')).some(name=>name.includes(v.sessionRef.slice(3)))}));
    const checks={goalAndOriginPreserved:after.goal===before.goal&&after.origin===before.origin,constraintsPreserved:JSON.stringify(after.constraints)===JSON.stringify(before.constraints),findingsPreserved:before.claims.every(c=>JSON.stringify(after.claims.find(v=>v.id===c.id))===JSON.stringify(c)),epochAdvanced:after.owner.epoch>before.owner.epoch,newOwner:after.owner.sessionId===session.sessionId,oldVerdictNotReused:context.verification?.current!==true,contextBounded:contextBytes<=16384,focusedSourceRetained:!focus||context.claims.some(c=>c.key===focus),savedHandoffsPreserved:knownHandoffs.every(h=>after.handoffs?.some(v=>v.id===h.id)),savedReportsImmutable:savedReports.every(r=>sha(r.path)===r.sha256),artifactBytesUnchanged:artifacts.every(a=>sha(a.path)===a.sha256),originalDatabaseUnchanged:states(source)===sourceStates};
    const handoffChecks={savedBeforeRehearsal:knownHandoffs.length>0,containedSavedFacts:factHandoffs.length>0,sourceIdentityBound:factHandoffs.length>0&&factHandoffs.every(v=>v.source?.taskId===before.id&&v.source?.state==='saved'&&v.sessionRef===`${v.source.host}:${v.source.sessionId}`&&v.source.epoch<=before.owner.epoch&&v.source.candidate?.length===64),durableDetail:factHandoffs.length>0&&factHandoffs.every(v=>typeof v.detail==='string'&&v.detail.length>0),reportAndNativeLocators:reports.length>0&&reports.every(r=>r.exists&&r.nativeSessionExists)};
    results.push({modelSlug:slug,case:caseName,mode,taskId:before.id,transition:before.status==='completed'?'explicit-reopen-completed-clone':'resume-incomplete-clone',checks,passed:Object.values(checks).every(Boolean),handoffChecks,fullSavedHandoff:Object.values(handoffChecks).every(Boolean),contextBytes,savedHandoffCount:knownHandoffs.length,factHandoffCount:factHandoffs.length,reports});
   }finally{await h.close();}
  }
 }
}finally{rmSync(scratch,{recursive:true,force:true});}
const result={kind:'Offline reload on disposable copies using each arm frozen runtime; not a model timeout-recovery experiment. Missing old handoffs are reported separately from basic graph restoration.',results,passed:results.filter(v=>v.passed).length,total:results.length};
writeFileSync(join(root,'handoff-restoration.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
if(result.passed!==result.total)process.exitCode=1;
