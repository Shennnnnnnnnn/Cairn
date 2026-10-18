// Host-supplied example verifier for this task's output contract, not an RCA oracle.
// Reads only stdin task metadata and artifacts/evidence under task.owner.cwd.
import {readFileSync,existsSync,realpathSync} from 'node:fs';
import {resolve,relative,isAbsolute} from 'node:path';
let raw='';for await(const chunk of process.stdin)raw+=chunk;
const task=JSON.parse(raw),root=realpathSync(task.owner.cwd),issues=[];
const issue=message=>issues.push({message});
const local=path=>{const absolute=resolve(root,path),rel=relative(root,absolute);if(rel.startsWith('..')||isAbsolute(rel))throw new Error('Artifact path escapes task workspace');if(!existsSync(absolute))throw new Error(`Missing ${path}`);const real=realpathSync(absolute),r=relative(root,real);if(r.startsWith('..')||isAbsolute(r))throw new Error('Artifact symlink escapes task workspace');return real;};
let answer,report;
try{
 answer=JSON.parse(readFileSync(local('answer.json'),'utf8'));
 if(!answer||typeof answer!=='object'||Array.isArray(answer)){answer=undefined;issue('answer.json must contain an object');}
}catch(error){issue(`answer.json: ${error.message}`);}
try{report=readFileSync(local('REPORT.md'),'utf8');if(!report.trim())issue('REPORT.md must contain a final report');}catch(error){issue(error.message);}
if(answer){
 const candidates=answer.candidates;
 if(!Array.isArray(candidates)||candidates.length<1||candidates.length>3)issue('Submit one to three candidates');
 else for(const c of candidates){
  if(!c||typeof c.location!=='string'||!c.location.trim()||!['pod','node','service'].includes(c.level)||!['cpu','memory','disk_io','network','unknown'].includes(c.fault_family)||typeof c.confidence!=='number'||!Number.isFinite(c.confidence)||c.confidence<0||c.confidence>1||typeof c.reason!=='string'||!c.reason.trim())issue('Each candidate needs a location, level, resource family, confidence in [0,1], and reason');
 }
 if(!Array.isArray(answer.evidence)||answer.evidence.length<2)issue('Provide at least two quantitative evidence entries');
 else for(const e of answer.evidence){
  if(!e||['file','metric','entity','before','after'].some(k=>typeof e[k]!=='string'||!e[k].trim())){issue('Evidence needs file/metric/entity and before/after descriptions');continue;}
  // A description may cite several CSV files; check the first explicit path.
  const path=e.file.match(/(?:evidence\/)?(?:container|node|service)\/[A-Za-z0-9_.-]+\.csv/)?.[0];
  if(path)try{local(path.startsWith('evidence/')?path:`evidence/${path}`);}catch(error){issue(error.message);}
  else issue(`Evidence must identify an actual CSV path: ${e.file.slice(0,160)}`);
 }
 for(const key of ['alternatives','limitations','mitigation','verification'])if(!Array.isArray(answer[key])||!answer[key].length||answer[key].some(v=>typeof v!=='string'||!v.trim()))issue(`answer.json needs nonempty ${key} statements`);
 const top=candidates?.[0];
 if(report&&top?.location){const canonical=top.location.replace(/^node-\d+\./,'').replace(/-(grpc|http)$/,'');if(!report.includes(top.location)&&!report.includes(canonical))issue('REPORT.md must mention the first candidate from answer.json');}
}
console.log(JSON.stringify({ok:issues.length===0,issues}));
