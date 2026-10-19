import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import type { EngineOptions } from '../core/engine.js';
import { CairnError, type VerificationResult } from '../core/types.js';

/** Trusted host configuration only; never interpreted from model input or task files. */
export function hostOptions(env:NodeJS.ProcessEnv=process.env):EngineOptions {
  env={...env}; // One run's trusted verifier environment cannot drift with a later session.
  const options:EngineOptions={};
  const deadline=env.CAIRN_DEADLINE,reserve=env.CAIRN_SUBMIT_RESERVE_MS;
  if(deadline&&!Number.isFinite(Date.parse(deadline)))throw new CairnError('invalid_budget','Invalid CAIRN_DEADLINE');
  if(reserve!==undefined&&(!/^\d+$/.test(reserve)||Number(reserve)>1800000))throw new CairnError('invalid_budget','Invalid CAIRN_SUBMIT_RESERVE_MS');
  if(deadline||reserve!==undefined)options.hostBudget={deadline,submitReserveMs:reserve===undefined?30000:Number(reserve)};
  if(env.CAIRN_VERIFY_COMMAND){
    let command:unknown;
    try{command=JSON.parse(env.CAIRN_VERIFY_COMMAND);}catch{throw new CairnError('invalid_verifier','CAIRN_VERIFY_COMMAND must be a JSON argv array');}
    if(!Array.isArray(command)||!command.length||command.some(v=>typeof v!=='string'||!v.trim()))throw new CairnError('invalid_verifier','CAIRN_VERIFY_COMMAND must contain nonempty argv strings');
    const argv=command as string[],timeout=Number(env.CAIRN_VERIFY_TIMEOUT_MS??10000);
    if(!Number.isInteger(timeout)||timeout<1||timeout>120000)throw new CairnError('invalid_verifier','Invalid CAIRN_VERIFY_TIMEOUT_MS');
    let artifacts:string[]|undefined;
    if(env.CAIRN_VERIFY_ARTIFACTS){
      try{artifacts=JSON.parse(env.CAIRN_VERIFY_ARTIFACTS);}catch{throw new CairnError('invalid_verifier','CAIRN_VERIFY_ARTIFACTS must be a JSON array of file paths');}
      if(!Array.isArray(artifacts)||!artifacts.length||artifacts.length>16||artifacts.some(p=>typeof p!=='string'||!p.trim()))throw new CairnError('invalid_verifier','Invalid CAIRN_VERIFY_ARTIFACTS');
    }
    options.completionVerifier={artifacts,id:`command:${createHash('sha256').update(JSON.stringify({argv,artifacts})).digest('hex')}`,verify:(task,signal)=>new Promise<VerificationResult>((resolve,reject)=>{
      const grouped=process.platform!=='win32';
      const child=spawn(argv[0]!,argv.slice(1),{cwd:task.owner.cwd,env,stdio:['pipe','pipe','pipe'],shell:false,detached:grouped});
      let stdout='',stderr='',settled=false;
      const terminate=()=>{try{if(grouped&&child.pid)process.kill(-child.pid,'SIGKILL');else child.kill('SIGKILL');}catch{try{child.kill('SIGKILL');}catch{}}};
      const fail=(error:Error)=>{
        if(settled)return;settled=true;cleanup();terminate();
        child.stdin.destroy();child.stdout.destroy();child.stderr.destroy();reject(error);
      };
      const aborted=()=>fail(new Error('Verifier aborted'));
      const timer=setTimeout(()=>fail(new Error(`Verifier timed out after ${timeout} ms`)),timeout);
      const cleanup=()=>{clearTimeout(timer);signal?.removeEventListener('abort',aborted);};
      child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
      child.stdout.on('data',(chunk:string)=>{if(settled)return;if(Buffer.byteLength(stdout)+Buffer.byteLength(chunk)>65536)fail(new Error('Verifier output exceeded 64 KiB'));else stdout+=chunk;});
      child.stderr.on('data',(chunk:string)=>{stderr=(stderr+chunk).slice(0,1000);});
      child.on('error',fail);child.stdin.on('error',fail);
      child.on('close',(code,exitSignal)=>{
        if(settled)return;
        if(code!==0)return fail(new Error(`Verifier exited ${code??exitSignal}: ${stderr}`));
        let result:VerificationResult;
        try{result=JSON.parse(stdout);}catch{return fail(new Error('Verifier must return one JSON result on stdout'));}
        settled=true;cleanup();resolve(result);
      });
      if(signal?.aborted){aborted();return;}
      signal?.addEventListener('abort',aborted,{once:true});
      child.stdin.end(JSON.stringify(task));
    })};
  }
  return options;
}
