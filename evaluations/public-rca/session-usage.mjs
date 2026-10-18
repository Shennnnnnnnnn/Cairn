// Publish native logs after an isolated evaluation. Never copy credentials or write CC Switch's DB.
import {openSync,closeSync,readSync,readFileSync,writeFileSync,readdirSync,lstatSync,mkdirSync,linkSync,unlinkSync,appendFileSync,copyFileSync,existsSync,constants} from 'node:fs';
import {join,dirname,basename,resolve,relative,sep} from 'node:path';
import {homedir} from 'node:os';
import {createHash,randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';

const excluded=new Set(['node_modules','.git','.tmp','workspace','workspaces','cases','implementation','implementation-before','implementation-after','implementation-previous','implementations']);
const sha=data=>createHash('sha256').update(data).digest('hex');
const prefix=(short,long)=>short.length<=long.length&&long.subarray(0,short.length).equals(short);

function filesUnder(root){
 if(!existsSync(root))return [];
 const stat=lstatSync(root);
 if(stat.isSymbolicLink())return [];
 if(stat.isFile())return root.endsWith('.jsonl')?[root]:[];
 if(!stat.isDirectory())return [];
 return readdirSync(root,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name)).flatMap(entry=>{
  if(entry.isSymbolicLink()||excluded.has(entry.name))return [];
  const path=join(root,entry.name);
  return entry.isDirectory()?filesUnder(path):entry.isFile()&&entry.name.endsWith('.jsonl')?[path]:[];
 });
}

export function evaluationSessionFiles(roots){
 return [...new Set(roots.flatMap(root=>filesUnder(resolve(root))).filter(path=>basename(dirname(path))==='sessions'))].sort();
}

function identity(header){
 const host=header.type==='session_meta'?'codex':header.type==='session'?'pi':undefined;
 const meta=host==='codex'?header.payload:header;
 if(!host)return undefined;
 if(!meta||typeof meta.id!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(meta.id))throw new Error('Invalid native session ID');
 if(typeof meta.timestamp!=='string'||!/^\d{4}-\d{2}-\d{2}T/.test(meta.timestamp)||!Number.isFinite(Date.parse(meta.timestamp)))throw new Error('Invalid native session timestamp');
 return {host,sessionId:meta.id,timestamp:meta.timestamp};
}

function headerOf(path){
 const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{
  const first=Buffer.alloc(65536),length=readSync(fd,first,0,first.length,0),line=first.subarray(0,length).toString('utf8').split('\n',1)[0];
  return identity(JSON.parse(line));
 }finally{closeSync(fd);}
}

function snapshot(path){
 const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);
 let data;
 try{data=readFileSync(fd);}finally{closeSync(fd);}
 // A running host may be in the middle of its last write. Only publish complete records.
 const end=data.lastIndexOf(10)+1,tail=data.length-end;
 data=data.subarray(0,end);
 if(!data.length)throw new Error('No complete JSONL records');
 let meta;
 for(const [i,line] of data.toString('utf8').split('\n').entries()){
  if(!line.trim())continue;
  let entry;try{entry=JSON.parse(line);}catch{throw new Error(`Invalid JSONL record at line ${i+1}`);}
  if(i===0)meta=identity(entry);
 }
 if(!meta)return undefined;
 return {...meta,path,data,sha256:sha(data),deferredBytes:tail};
}

function sessionRoots(home){return {codex:[join(home,'.codex/sessions'),join(home,'.codex/archived_sessions')],pi:[join(home,'.pi/agent/sessions')]};}
function existingSessions(home){
 const index=new Map();
 for(const [host,roots] of Object.entries(sessionRoots(home)))for(const path of roots.filter(root=>!hasDirectorySymlink(home,root)).flatMap(filesUnder)){
  let meta;try{meta=headerOf(path);}catch{continue;}
  if(meta?.host!==host)continue;
  const key=`${host}:${meta.sessionId}`;
  index.set(key,[...(index.get(key)??[]),path]);
 }
 return index;
}

function destination(home,session){
 const stamp=new Date(session.timestamp).toISOString(),day=stamp.slice(0,10),clock=stamp.slice(0,19).replaceAll(':','-');
 return session.host==='codex'?join(home,'.codex/sessions',...day.split('-'),`rollout-${clock}-${session.sessionId}.jsonl`):join(home,'.pi/agent/sessions/--cairn-evaluations--',`${stamp.replaceAll(':','-')}_${session.sessionId}.jsonl`);
}

function privateDirectory(path){
 if(existsSync(path)){
  const stat=lstatSync(path);
  if(stat.isSymbolicLink()||!stat.isDirectory())throw new Error(`Destination is not a regular directory: ${path}`);
  return;
 }
 const parent=dirname(path);if(parent!==path)privateDirectory(parent);
 try{mkdirSync(path,{mode:0o700});}catch(error){if(error.code!=='EEXIST')throw error;privateDirectory(path);}
}

function hasDirectorySymlink(home,path){
 const parts=relative(home,path).split(sep).filter(Boolean);
 if(parts[0]==='..')throw new Error('Destination escapes the statistics home');
 let current=home;
 for(const part of parts){current=join(current,part);if(existsSync(current)&&lstatSync(current).isSymbolicLink())return true;}
 return false;
}
function checkedDirectory(home,path){
 if(hasDirectorySymlink(home,path))throw new Error(`Destination contains a directory symlink: ${path}`);
 privateDirectory(path);
}

async function lock(home){
 const path=join(home,'.cairn/session-usage.lock');checkedDirectory(home,dirname(path));
 for(let attempt=0;attempt<300;attempt++){
  let fd;
  try{fd=openSync(path,'wx',0o600);}catch(error){if(error.code!=='EEXIST')throw error;}
  if(fd!==undefined){writeFileSync(fd,JSON.stringify({pid:process.pid}));closeSync(fd);return ()=>unlinkSync(path);}
  // Do not steal stale locks: reclaiming them races with another publisher.
  try{
   const {pid}=JSON.parse(readFileSync(path,'utf8'));
   if(Number.isInteger(pid)&&pid>0)try{process.kill(pid,0);}catch(error){if(error.code==='ESRCH')throw new Error(`Stale session usage lock from exited process ${pid}: ${path}`);}
  }catch(error){if(error.code==='ENOENT')continue;if(error.message.startsWith('Stale session usage lock'))throw error;}
  await delay(100);
 }
 throw new Error('Timed out waiting for the session usage sync lock');
}

export async function syncSessionUsage({roots=[],files,home=homedir(),write=false}={}){
 home=resolve(home);
 const release=write?await lock(home):()=>{};
 try{
  const report={version:1,createdAt:new Date().toISOString(),write,home,sourceFiles:0,created:0,appended:0,unchanged:0,conflicts:0,ignored:0,deferredBytes:0,sessions:[],errors:[]};
  const groups=new Map();
  for(const path of [...new Set(files??evaluationSessionFiles(roots))].sort()){
   report.sourceFiles++;
   let session;
   try{session=snapshot(path);}catch(error){report.errors.push({source:path,error:error.message});continue;}
   if(!session){report.ignored++;continue;}
   report.deferredBytes+=session.deferredBytes;
   const key=`${session.host}:${session.sessionId}`;
   groups.set(key,[...(groups.get(key)??[]),session]);
  }
  const existing=existingSessions(home);
  for(const [key,copies] of groups){
   const session=copies.reduce((a,b)=>a.data.length>=b.data.length?a:b);
   const row={host:session.host,sessionId:session.sessionId,sources:copies.map(s=>s.path),bytes:session.data.length,sha256:session.sha256};
   const targets=existing.get(key)??[];
   try{
    if(copies.some(s=>!prefix(s.data,session.data)))throw new Error('Different source histories share the same session ID');
    if(targets.length>1)throw new Error('Multiple existing statistics files share the same session ID');
    row.destination=targets[0]??destination(home,session);
    let old;
    if(targets.length){
     // Never replace or truncate a file already being scanned by CC Switch.
     const fd=openSync(row.destination,constants.O_RDONLY|constants.O_NOFOLLOW);
     try{old=readFileSync(fd);}finally{closeSync(fd);}
     if(prefix(session.data,old)){row.action='unchanged';}
     else if(prefix(old,session.data))row.action='appended';
     else throw new Error('Source and existing session histories diverge; refusing to overwrite');
    }else row.action='created';
    if(write&&row.action==='created'){
     checkedDirectory(home,dirname(row.destination));
     const temporary=join(dirname(row.destination),`.cairn-${randomUUID()}.tmp`);
     try{writeFileSync(temporary,session.data,{mode:0o600,flag:'wx'});linkSync(temporary,row.destination);}finally{if(existsSync(temporary))unlinkSync(temporary);}
    }
    if(write&&row.action==='appended'){
     // Recheck after planning: native writers are not participants in our lock.
     const fd=openSync(row.destination,constants.O_RDWR|constants.O_APPEND|constants.O_NOFOLLOW);
     try{if(!readFileSync(fd).equals(old))throw new Error('Existing session changed during synchronization');appendFileSync(fd,session.data.subarray(old.length));}finally{closeSync(fd);}
    }
    report[row.action]++;
   }catch(error){row.action='conflict';row.error=error.message;report.conflicts++;}
   report.sessions.push(row);
  }
  report.ok=report.conflicts===0&&report.errors.length===0;
  return report;
 }finally{release();}
}

// Called only by the trusted host after the actor exits; a stats failure never changes its grade.
export async function publishEvaluationUsage(sessionDir,{nativeRoot,home=homedir()}={}){
 if(process.env.CAIRN_USAGE_SYNC==='0')return {disabled:true};
 let report;
 try{
  if(nativeRoot)for(const path of filesUnder(nativeRoot)){
   if(headerOf(path)?.host!=='codex')continue;
   mkdirSync(sessionDir,{recursive:true,mode:0o700});copyFileSync(path,join(sessionDir,basename(path)));
  }
  report=await syncSessionUsage({roots:[sessionDir],home,write:true});
 }catch(error){report={ok:false,error:error.message};}
 try{if(existsSync(dirname(sessionDir)))writeFileSync(join(dirname(sessionDir),'cc-switch-usage-sync.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});}catch{report.ok=false;report.reportWriteFailed=true;}
 if(!report.ok)process.stderr.write('[cairn-usage] Statistics sync needs attention; retry with npm run usage:sync -- --write.\n');
 return report;
}
