import {createHash} from 'node:crypto';
import {openSync,closeSync,readSync,fstatSync,constants} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {CairnError,type ArtifactInput,type Artifact,type Task,type Claim} from './types.js';

const MAX_BYTES=64*1024*1024;
/** Only explicitly submitted regular files are read. No globbing, commands or remote fetching. */
export function snapshotArtifacts(cwd:string,inputs:ArtifactInput[],maximumBytes=MAX_BYTES):Artifact[] {
  if(!Array.isArray(inputs)||inputs.length>16)throw new CairnError('invalid_artifact','Submit at most 16 artifact files');
  let total=0;const paths=new Set<string>();
  return inputs.map(input=>{
    if(!input||typeof input.path!=='string'||!input.path.trim()||input.path.includes('\0')||input.description!==undefined&&(typeof input.description!=='string'||input.description.length>2000))throw new CairnError('invalid_artifact','Artifacts need a local file path and optional description');
    const path=resolve(cwd,input.path);
    if(paths.has(path))throw new CairnError('invalid_artifact',`Repeated artifact ${path}`);paths.add(path);
    let fd:number|undefined;
    try{
      fd=openSync(path,constants.O_RDONLY|constants.O_NONBLOCK);const before=fstatSync(fd);
      if(!before.isFile())throw new Error('not a regular file');
      total+=before.size;if(total>Math.min(MAX_BYTES,maximumBytes))throw new Error('submitted files exceed the 64 MiB aggregate limit or remaining reference allowance; submit a smaller reproducible artifact');
      const hash=createHash('sha256'),buffer=Buffer.allocUnsafe(65536);let bytes=0;
      for(;;){const n=readSync(fd,buffer,0,buffer.length,null);if(!n)break;bytes+=n;if(bytes>before.size||bytes>MAX_BYTES)throw new Error('file changed while hashing');hash.update(buffer.subarray(0,n));}
      const after=fstatSync(fd);
      if(bytes!==before.size||after.size!==before.size||after.mtimeMs!==before.mtimeMs||after.ctimeMs!==before.ctimeMs)throw new Error('file changed while hashing');
      return {path,...(input.description===undefined?{}:{description:input.description}),sha256:hash.digest('hex'),bytes};
    }catch(error){throw new CairnError('invalid_artifact',`Cannot snapshot artifact ${path}: ${(error as Error).message}`);}
    finally{if(fd!==undefined)closeSync(fd);}
  });
}
/** Missing, changed, or unsubmitted required files invalidate the submission, even after a pass. */
export function artifactIssues(task:Task):string[] {
  const issues:string[]=[],submitted=task.artifacts??[];
  for(const path of task.artifactRequirements??[])if(!submitted.some(a=>a.path===resolve(task.owner.cwd,path)))issues.push(`Required artifact ${path} has not been submitted; save artifacts:[{path:...}] with the checkpoint or finish`);
  if(!submitted.length)return issues;
  try{
    const current=snapshotArtifacts(task.owner.cwd,submitted);
    for(const artifact of current){const previous=submitted.find(a=>a.path===artifact.path)!;if(artifact.sha256!==previous.sha256||artifact.bytes!==previous.bytes)issues.push(`Submitted artifact changed: ${artifact.path}; resubmit it and run verification again`);}
  }catch(error){issues.push((error as Error).message);}
  return issues;
}

function localPath(cwd:string,reference:string):string|undefined {
  let path=reference.replace(/(?::\d+){1,2}$/, '').replace(/#L\d+(?:-L\d+)?$/, '');
  if(/^[a-z][a-z\d+.-]*:/i.test(path)&&!/^file:/i.test(path))return;
  try {if(/^file:/i.test(path))path=fileURLToPath(path);return resolve(cwd,path);}catch{return;}
}
const declaredPaths=(task:Task,extra:ArtifactInput[]=[])=>new Set([...(task.artifacts??[]),...extra,...(task.artifactRequirements??[]).map(path=>({path}))].map(a=>resolve(task.owner.cwd,a.path)));
/** Bind only this explicit finding. Artifact-only saves never refresh older facts. */
export function snapshotClaimReferences(task:Task,references:string[]|undefined,extra:ArtifactInput[]=[]):Claim['referenceArtifacts'] {
  const allowed=declaredPaths(task,extra),paths=[...new Set((references??[]).map(ref=>localPath(task.owner.cwd,ref)).filter((path):path is string=>!!path&&allowed.has(path)))].sort();
  return paths.length?snapshotArtifacts(task.owner.cwd,paths.map(path=>({path}))).map(({path,sha256,bytes})=>({path,sha256,bytes})):undefined;
}
type ReferenceCache=Map<string,{artifact?:Artifact;issue?:string}>;
/** A bounded current-file cache shared by the findings checked in one projection. */
export function claimReferenceIssues(task:Task,claim:Claim,cache:ReferenceCache=new Map()):string[] {
  const allowed=declaredPaths(task),issues:string[]=[];
  for(const saved of claim.referenceArtifacts??[]){
    let current=cache.get(saved.path);
    if(!current){
      try{
        if(!allowed.has(saved.path))throw new Error('file is no longer a declared artifact');
        if(cache.size>=16)throw new Error('reference check exceeds the 16-file bound');
        const remaining=MAX_BYTES-[...cache.values()].reduce((sum,value)=>sum+(value.artifact?.bytes??0),0);
        const artifact=snapshotArtifacts(task.owner.cwd,[{path:saved.path}],remaining)[0]!;
        current={artifact};
      }catch(error){current={issue:(error as Error).message};}
      cache.set(saved.path,current);
    }
    if(current.issue||current.artifact?.sha256!==saved.sha256||current.artifact?.bytes!==saved.bytes)issues.push(`Finding ${claim.key??claim.id} has a stale artifact reference: ${saved.path}${current.issue?` (${current.issue})`:''}; review and explicitly resave this finding`);
  }
  return issues;
}
/** Only findings consumed by coverage or the saved report block acceptance. */
export function referenceIssues(task:Task):string[] {
  const used=new Set([...task.criteria.flatMap(c=>c.claimIds),...(task.report?.curatedReferences??[]).map(c=>c.claimId)]),cache:ReferenceCache=new Map();
  return task.claims.filter(c=>used.has(c.id)).flatMap(c=>claimReferenceIssues(task,c,cache));
}
