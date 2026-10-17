#!/usr/bin/env node
// Read-only reconciliation of published native logs against CC Switch's imported records.
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {homedir} from 'node:os';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';

const sha=value=>createHash('sha256').update(value).digest('hex');
function nativeUsage(data,host){
 let requests=0,totals=[0,0,0,0],last=[0,0];
 for(const line of data.toString('utf8').split('\n')){
  if(!line.trim())continue;
  const entry=JSON.parse(line);
  if(host==='pi'&&entry.type==='message'&&entry.message?.role==='assistant'){
   requests++;const usage=entry.message.usage??{};
   totals=totals.map((n,i)=>n+(usage[['input','output','cacheRead','cacheWrite'][i]]??0));
  }
  if(host==='codex'&&entry.type==='event_msg'&&entry.payload?.type==='token_count'){
   const usage=entry.payload.info?.total_token_usage;
   if(!usage)continue;
   const current=[usage.input_tokens??0,usage.output_tokens??0];
   if(current.some((n,i)=>n>last[i]))requests++;
   last=current;totals=[...current,usage.cached_input_tokens??0,0];
  }
 }
 return {requests,totals};
}

export function verifyUsage({report,dbPath=join(homedir(),'.cc-switch/cc-switch.db'),baseline}={}){
 const db=new DatabaseSync(dbPath,{readOnly:true,timeout:5000});
 try{
  const result={version:1,verifiedAt:new Date().toISOString(),ok:true,sessions:[],byHost:{},errors:[]};
  const query=db.prepare('SELECT request_id,input_tokens,output_tokens,cache_read_tokens,cache_creation_tokens FROM proxy_request_logs WHERE app_type=? AND session_id=? ORDER BY request_id');
  const synced=db.prepare('SELECT 1 FROM session_log_sync WHERE file_path=?');
  for(const session of report.sessions){
   if(session.action==='conflict'){result.errors.push({sessionId:session.sessionId,error:'Source synchronization conflict'});continue;}
   const data=readFileSync(session.destination),native=nativeUsage(data,session.host);
   const rows=query.all(session.host,session.sessionId);
   const actual={requests:rows.length,totals:['input_tokens','output_tokens','cache_read_tokens','cache_creation_tokens'].map(key=>rows.reduce((n,r)=>n+r[key],0))};
   const row={host:session.host,sessionId:session.sessionId,nativeBytes:data.length,nativeSha256:sha(data),databaseFingerprint:sha(JSON.stringify(rows)),native,actual,scanned:!!synced.get(session.destination),ok:true};
   if(sha(data.subarray(0,session.bytes))!==session.sha256){row.ok=false;row.error='Published native prefix differs from synchronization receipt';}
   if(native.requests!==actual.requests||native.totals.some((n,i)=>n!==actual.totals[i])){row.ok=false;row.error='Request count or token totals differ from native log';}
   if(!row.scanned){row.ok=false;row.error='CC Switch has not scanned the destination';}
   const prior=baseline?.sessions.find(s=>s.host===row.host&&s.sessionId===row.sessionId);
   if(prior&&prior.nativeSha256===row.nativeSha256&&prior.databaseFingerprint!==row.databaseFingerprint){row.ok=false;row.error='Database records changed after rescan of unchanged native log';}
   if(!row.ok)result.errors.push({host:row.host,sessionId:row.sessionId,error:row.error});
   result.sessions.push(row);
   const summary=result.byHost[row.host]??={sessions:0,requests:0,recordedTokens:0};
   summary.sessions++;summary.requests+=actual.requests;
   // Codex input already includes cache; Pi input does not.
   summary.recordedTokens+=actual.totals[0]+actual.totals[1]+(row.host==='pi'?actual.totals[2]+actual.totals[3]:0);
  }
  result.ok=report.ok&&result.errors.length===0;
  return result;
 }finally{db.close();}
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args={};
 for(let i=2;i<process.argv.length;i++){
  const key=process.argv[i];if(!['--report','--db','--baseline','--out'].includes(key))throw new Error(`Unknown option: ${key}`);
  const value=process.argv[++i];if(!value||value.startsWith('--'))throw new Error(`Missing value for ${key}`);args[key]=resolve(value);
 }
 if(!args['--report'])throw new Error('Usage: node scripts/verify-evaluation-usage.mjs --report sync.json [--baseline previous-audit.json] [--out audit.json]');
 const load=path=>JSON.parse(readFileSync(path,'utf8'));
 const result=verifyUsage({report:load(args['--report']),dbPath:args['--db'],baseline:args['--baseline']?load(args['--baseline']):undefined});
 if(args['--out']){mkdirSync(dirname(args['--out']),{recursive:true,mode:0o700});writeFileSync(args['--out'],JSON.stringify(result,null,2)+'\n',{mode:0o600});}
 const {sessions,...summary}=result;console.log(JSON.stringify({...summary,verifiedSessions:sessions.length},null,2));if(!result.ok)process.exitCode=1;
}
