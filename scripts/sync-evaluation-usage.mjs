#!/usr/bin/env node
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {mkdirSync,writeFileSync} from 'node:fs';
import {syncSessionUsage} from '../evaluations/public-rca/session-usage.mjs';

const repo=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const options={roots:[],write:false};let reportPath;
for(let i=2;i<process.argv.length;i++){
 const arg=process.argv[i];
 if(arg==='--write')options.write=true;
 else if(arg==='--dry-run')options.write=false;
 else if(['--root','--home','--report'].includes(arg)){
  const value=process.argv[++i];if(!value||value.startsWith('--'))throw new Error(`Missing value for ${arg}`);
  if(arg==='--root')options.roots.push(resolve(value));
  if(arg==='--home')options.home=resolve(value);
  if(arg==='--report')reportPath=resolve(value);
 }else throw new Error(`Unknown option: ${arg}`);
}
if(!options.roots.length)options.roots=[join(repo,'evaluations/pi-ab/runs'),join(repo,'evaluations/public-rca/runs')];
const report=await syncSessionUsage(options);
if(reportPath){mkdirSync(dirname(reportPath),{recursive:true,mode:0o700});writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n',{mode:0o600});}
const {sessions,errors,...summary}=report;
console.log(JSON.stringify({...summary,byHost:Object.fromEntries(['codex','pi'].map(host=>[host,sessions.filter(s=>s.host===host).reduce((out,s)=>{out[s.action]=(out[s.action]??0)+1;return out;},{})])),errors,conflictDetails:sessions.filter(s=>s.action==='conflict'),reportPath:reportPath??null},null,2));
if(!report.ok)process.exitCode=1;
