import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,appendFileSync,existsSync,statSync,rmSync,symlinkSync,readdirSync,cpSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawn,spawnSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';

const modulePath=resolve('evaluations/public-rca/session-usage.mjs');
const cliPath=resolve('scripts/sync-evaluation-usage.mjs');
const {syncSessionUsage,publishEvaluationUsage}=await import(pathToFileURL(modulePath).href);
const stamp='2026-10-17T12:00:00.000Z';
const jsonl=(...rows:unknown[])=>rows.map(row=>JSON.stringify(row)+'\n').join('');
const header=(host:string,id:string)=>host==='codex'?{type:'session_meta',payload:{id,timestamp:stamp,cwd:'/isolated/work'}}:{type:'session',version:3,id,timestamp:stamp,cwd:'/isolated/work'};
const event=(n:number)=>({type:'message',id:`entry-${n}`,message:{role:'assistant',usage:{input:n,output:n+1,cacheRead:0,cacheWrite:0}}});
function fixture(t:any){
 const root=mkdtempSync(join(tmpdir(),'cairn-usage-test-')),home=join(root,'home'),runs=join(root,'runs');
 t.after(()=>rmSync(root,{recursive:true,force:true}));
 const source=(host:string,id:string,arm=id)=>{
  const file=join(runs,arm,'sessions',`${host}-${id}.jsonl`);mkdirSync(dirname(file),{recursive:true});writeFileSync(file,jsonl(header(host,id),event(1)));return file;
 };
 return {root,home,runs,source,sync:(write=true)=>syncSessionUsage({roots:[runs],home,write})};
}

test('dry run plans both native hosts without creating home or exposing credentials',async t=>{
 const f=fixture(t);f.source('pi','pi-one');f.source('codex','codex-one');
 writeFileSync(join(f.runs,'auth.json'),'private credential');
 const report=await f.sync(false);
 assert.equal(report.ok,true);assert.equal(report.created,2);assert.equal(existsSync(f.home),false);
 assert.equal(JSON.stringify(report).includes('private credential'),false);
});

test('copies native bytes once, deduplicates source snapshots, and repeat sync is a no-op',async t=>{
 const f=fixture(t),first=f.source('pi','one','arm-a'),second=f.source('pi','one','archive-copy');
 appendFileSync(second,jsonl(event(2)));
 const codex=f.source('codex','two');
 const report=await f.sync();
 assert.equal(report.ok,true);assert.equal(report.sourceFiles,3);assert.equal(report.created,2);
 for(const session of report.sessions){
  const source=session.host==='pi'?second:codex;
  assert.deepEqual(readFileSync(session.destination),readFileSync(source));
  assert.equal(statSync(session.destination).mode&0o777,0o600);
 }
 const before=report.sessions.map((s:any)=>statSync(s.destination));
 const again=await f.sync();assert.equal(again.created,0);assert.equal(again.appended,0);assert.equal(again.unchanged,2);
 again.sessions.forEach((s:any,i:number)=>{assert.equal(statSync(s.destination).ino,before[i]!.ino);assert.equal(statSync(s.destination).mtimeMs,before[i]!.mtimeMs);});
 assert.ok(existsSync(first));
});

test('resumed sessions append only the new tail and preserve the scanner inode and offset',async t=>{
 const f=fixture(t),file=f.source('pi','resumed');
 const initial=await f.sync(),target=initial.sessions[0].destination;
 const before=readFileSync(target),inode=statSync(target).ino;
 appendFileSync(file,jsonl(event(2),event(3)));
 const report=await f.sync();assert.equal(report.appended,1);assert.equal(report.created,0);
 assert.equal(statSync(target).ino,inode);assert.deepEqual(readFileSync(target).subarray(0,before.length),before);
 assert.deepEqual(readFileSync(target),readFileSync(file));assert.equal((await f.sync()).unchanged,1);
});

test('existing native and archived session IDs are reused even with different filenames',async t=>{
 const f=fixture(t),p=f.source('pi','known-pi'),c=f.source('codex','known-codex');
 const piTarget=join(f.home,'.pi/agent/sessions/original/old-name.jsonl'),codexTarget=join(f.home,'.codex/archived_sessions/old-name.jsonl');
 for(const [from,to] of [[p,piTarget],[c,codexTarget]]){mkdirSync(dirname(to!),{recursive:true});cpSync(from!,to!);}
 appendFileSync(p,jsonl(event(4)));
 const report=await f.sync();assert.equal(report.created,0);assert.equal(report.appended,1);assert.equal(report.unchanged,1);
 assert.deepEqual(readFileSync(piTarget),readFileSync(p));assert.equal(existsSync(join(f.home,'.codex/sessions')),false);
});

test('divergent snapshots and divergent existing history are reported without overwrite',async t=>{
 const f=fixture(t),a=f.source('pi','same','a'),b=f.source('pi','same','b');
 appendFileSync(a,jsonl(event(3)));appendFileSync(b,jsonl(event(4)));
 const first=await f.sync();assert.equal(first.ok,false);assert.equal(first.conflicts,1);assert.equal(first.created,0);
 rmSync(dirname(dirname(b)),{recursive:true});
 const good=await f.sync(),target=good.sessions[0].destination,before=readFileSync(target);
 writeFileSync(a,jsonl(header('pi','same'),event(9)));
 const conflict=await f.sync();assert.equal(conflict.conflicts,1);assert.deepEqual(readFileSync(target),before);
});

test('two pre-existing copies of one ID prevent creating a third statistics entry',async t=>{
 const f=fixture(t),source=f.source('codex','duplicated');
 for(const root of ['sessions','archived_sessions']){const p=join(f.home,'.codex',root,'duplicate.jsonl');mkdirSync(dirname(p),{recursive:true});cpSync(source,p);}
 const report=await f.sync();assert.equal(report.created,0);assert.equal(report.conflicts,1);
});

test('live partial writes are deferred and imported exactly once after the record completes',async t=>{
 const f=fixture(t),source=f.source('pi','partial'),line=JSON.stringify(event(2));
 appendFileSync(source,line.slice(0,12));
 const first=await f.sync();assert.equal(first.deferredBytes,12);assert.equal(first.created,1);
 appendFileSync(source,line.slice(12)+'\n');
 const next=await f.sync();assert.equal(next.deferredBytes,0);assert.equal(next.appended,1);
 assert.deepEqual(readFileSync(next.sessions[0].destination),readFileSync(source));
});

test('malformed logs and unsafe IDs are rejected; stdout, credentials, and symlinks are excluded',async t=>{
 const f=fixture(t),bad=f.source('pi','bad');appendFileSync(bad,'{invalid}\n');
 const traversal=f.source('pi','safe');writeFileSync(traversal,jsonl(header('pi','../../escape')));
 const ignored=join(f.runs,'actor','initial.jsonl');mkdirSync(dirname(ignored),{recursive:true});writeFileSync(ignored,jsonl(header('pi','stdout')));
 const linked=join(f.runs,'linked','sessions');mkdirSync(dirname(linked),{recursive:true});symlinkSync(dirname(bad),linked);
 const report=await f.sync();assert.equal(report.ok,false);assert.equal(report.errors.length,2);assert.equal(report.created,0);assert.equal(report.sourceFiles,2);
});

test('a destination session directory symlink is rejected without writing through it',async t=>{
 const f=fixture(t);f.source('pi','safe');
 const outside=join(f.root,'outside');mkdirSync(outside);mkdirSync(join(f.home,'.pi/agent'),{recursive:true});symlinkSync(outside,join(f.home,'.pi/agent/sessions'));
 const report=await f.sync();assert.equal(report.conflicts,1);assert.deepEqual(readdirSync(outside),[]);
});

test('cross-process synchronization serializes duplicate publishers',async t=>{
 const f=fixture(t);f.source('pi','parallel');
 const invoke=()=>new Promise<any>((resolve,reject)=>{
  const p=spawn(process.execPath,[cliPath,'--root',f.runs,'--home',f.home,'--write'],{stdio:['ignore','pipe','pipe']});let out='',err='';
  p.stdout.on('data',d=>out+=d);p.stderr.on('data',d=>err+=d);p.on('error',reject);p.on('close',code=>code===0?resolve(JSON.parse(out)):reject(new Error(out+err)));
 });
 const results=await Promise.all([invoke(),invoke(),invoke()]);
 assert.equal(results.reduce((n,r)=>n+r.created,0),1);assert.equal(results.reduce((n,r)=>n+r.unchanged,0),2);
 assert.equal((await f.sync()).unchanged,1);
});

test('post-exit publisher archives only native logs and keeps isolated config untouched',async t=>{
 const f=fixture(t),native=join(f.root,'private/sessions/2026/10/17');mkdirSync(native,{recursive:true});
 const source=join(native,'rollout.jsonl');writeFileSync(source,jsonl(header('codex','archived'),event(1)));
 const auth=join(f.root,'private/auth.json');writeFileSync(auth,'private credential');
 const sessionDir=join(f.runs,'actor/sessions');mkdirSync(dirname(sessionDir),{recursive:true});
 const report=await publishEvaluationUsage(sessionDir,{nativeRoot:join(f.root,'private/sessions'),home:f.home});
 assert.equal(report.ok,true);assert.equal(report.created,1);assert.equal(readFileSync(auth,'utf8'),'private credential');
 assert.deepEqual(readFileSync(join(sessionDir,'rollout.jsonl')),readFileSync(source));
 assert.deepEqual(readdirSync(sessionDir),['rollout.jsonl']);assert.ok(existsSync(join(dirname(sessionDir),'cc-switch-usage-sync.json')));
});

test('CLI dry-run and write reports are usable from another working directory',t=>{
 const f=fixture(t);f.source('pi','cli');const report=join(f.root,'report.json');
 for(const flag of ['--dry-run','--write','--write']){
  const result=spawnSync(process.execPath,[cliPath,'--root',f.runs,'--home',f.home,flag,'--report',report],{cwd:f.root,encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);assert.equal(JSON.parse(readFileSync(report,'utf8')).ok,true);
  if(flag==='--dry-run')assert.equal(existsSync(f.home),false);
 }
 assert.equal(JSON.parse(readFileSync(report,'utf8')).unchanged,1);
});

test('destination ancestor symlinks cannot redirect or append a statistics copy',async t=>{
 const f=fixture(t),source=f.source('pi','ancestor');
 const outside=join(f.root,'outside'),existing=join(outside,'agent/sessions/project/existing.jsonl');
 mkdirSync(dirname(existing),{recursive:true});cpSync(source,existing);const before=readFileSync(existing);
 mkdirSync(f.home);symlinkSync(outside,join(f.home,'.pi'));appendFileSync(source,jsonl(event(2)));
 const report=await f.sync();assert.equal(report.conflicts,1);assert.deepEqual(readFileSync(existing),before);
});

test('publication errors leave the evaluation result and private configuration intact',async t=>{
 const f=fixture(t),source=f.source('pi','failure');mkdirSync(f.home);writeFileSync(join(f.home,'.cairn'),'blocked directory');
 const before=readFileSync(source);
 const result=await publishEvaluationUsage(dirname(source),{home:f.home});
 assert.equal(result.ok,false);assert.deepEqual(readFileSync(source),before);
 assert.equal(JSON.parse(readFileSync(join(dirname(dirname(source)),'cc-switch-usage-sync.json'),'utf8')).ok,false);
});

test('frozen drivers remain importable with their colocated usage helper',t=>{
 const f=fixture(t);mkdirSync(join(f.root,'frozen'));cpSync(modulePath,join(f.root,'frozen/session-usage.mjs'));
 for(const name of ['codex-driver.mjs','pi-driver-round9.mjs','pi-driver-round10.mjs']){
  const target=join(f.root,'frozen',name);cpSync(resolve('evaluations/public-rca',name),target);
  const code=`const m=await import(${JSON.stringify(pathToFileURL(target).href)});if(typeof (m.runCodex??m.runPi)!=='function')process.exit(1);`;
  const r=spawnSync(process.execPath,['--input-type=module','-e',code],{cwd:f.root,encoding:'utf8'});assert.equal(r.status,0,r.stderr);
 }
});

test('database reconciliation catches duplicate requests and altered records on repeat scan',async t=>{
 const f=fixture(t);f.source('pi','audited');const report=await f.sync(),dbPath=join(f.root,'usage.db');
 const db=new DatabaseSync(dbPath);
 db.exec('CREATE TABLE proxy_request_logs(request_id TEXT PRIMARY KEY,app_type TEXT,session_id TEXT,input_tokens INTEGER,output_tokens INTEGER,cache_read_tokens INTEGER,cache_creation_tokens INTEGER); CREATE TABLE session_log_sync(file_path TEXT PRIMARY KEY);');
 db.prepare('INSERT INTO proxy_request_logs VALUES(?,?,?,?,?,?,?)').run('request-one','pi','audited',1,2,0,0);
 db.prepare('INSERT INTO session_log_sync VALUES(?)').run(report.sessions[0].destination);
 const {verifyUsage}=await import(pathToFileURL(resolve('scripts/verify-evaluation-usage.mjs')).href);
 const baseline=verifyUsage({report,dbPath});assert.equal(baseline.ok,true);
 assert.equal(verifyUsage({report,dbPath,baseline}).ok,true);
 db.prepare('INSERT INTO proxy_request_logs VALUES(?,?,?,?,?,?,?)').run('duplicate','pi','audited',1,2,0,0);
 assert.equal(verifyUsage({report,dbPath,baseline}).ok,false);
 db.prepare('DELETE FROM proxy_request_logs WHERE request_id=?').run('duplicate');
 db.prepare('UPDATE proxy_request_logs SET request_id=?').run('changed-request-id');
 assert.equal(verifyUsage({report,dbPath,baseline}).ok,false);db.close();
});
