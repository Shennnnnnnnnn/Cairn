// Uniform post-run adapter diagnosis. No actor rerun, DB write, grade or promotion.
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {hostOptions} from '../../src/adapters/host-options.ts';
const root=resolve('evaluations/public-rca/runs/2026-10-18-five-model-round11'),load=p=>JSON.parse(readFileSync(p,'utf8'));
const sha=p=>createHash('sha256').update(readFileSync(p)).digest('hex'),manifest=load(join(root,'manifest.json'));
const relative='src/adapters/host-options.ts';if(sha(resolve(relative))!==manifest.implementation[relative])throw new Error('Host IPC source differs from frozen runtime');
const output=join(root,'generic-verifier-replay.json');if(existsSync(output))throw new Error('Never replace an experiment replay');
const records=[];
for(const row of manifest.schedule.filter(r=>r.kind==='generic')){
 const dir=join(root,row.id);if(!existsSync(join(dir,'actor-finished.json')))throw new Error('Every generic actor must end first');
 const task=load(join(dir,'initial.cairn-tasks.json'))[0],results={};
 for(const [kind,path] of [['original',join(root,'verify-generic-round11.py')],['stdinDrained',resolve('evaluations/public-rca/verify-generic-round11.py')]]){
  const verifier=hostOptions({PATH:'/usr/bin:/bin',CAIRN_VERIFY_COMMAND:JSON.stringify(['/usr/bin/python3',path,row.case,join(dir,'workspace')]),CAIRN_VERIFY_TIMEOUT_MS:'10000'}).completionVerifier;
  try{results[kind]={...await verifier.verify(task),error:null};}catch(e){results[kind]={ok:false,error:e.message};}
 }
 records.push({id:row.id,payloadBytes:Buffer.byteLength(JSON.stringify(task)),originalTaskStatus:task.status,...results});
}
const record={createdAt:new Date().toISOString(),method:'Replay the exact frozen host IPC source with each of all ten completed generic Task snapshots. Compare original verifier with identical verifier draining stdin before checking files. No model call, original task state/result/grade changed.',hostSourceSHA256:sha(resolve(relative)),originalSHA256:sha(join(root,'verify-generic-round11.py')),fixedSHA256:sha(resolve('evaluations/public-rca/verify-generic-round11.py')),rows:records};
writeFileSync(output,JSON.stringify(record,null,2)+'\n',{mode:0o600,flag:'wx'});
console.log(JSON.stringify({rows:records.length,originalFailures:records.filter(r=>!r.original.ok).map(r=>({id:r.id,bytes:r.payloadBytes,error:r.original.error})),fixedPassed:records.filter(r=>r.stdinDrained.ok).length}));
if(records.some(r=>!r.stdinDrained.ok))process.exitCode=1;
