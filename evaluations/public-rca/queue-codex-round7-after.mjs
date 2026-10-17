// Keep at most three actors active. The optimized arm was frozen before any starts.
import {existsSync,watch,writeFileSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
const here=dirname(fileURLToPath(import.meta.url)),root=join(here,'runs/2026-10-17-codex-sol-xhigh-round7b');
const arms=['codex','codex-cairn-previous','codex-cairn-before'],after=join(root,'codex-cairn-after');
if(existsSync(after))throw new Error('Never rerun or replace an existing actor');
writeFileSync(join(root,'after-queue.json'),JSON.stringify({queuedAt:new Date().toISOString(),pid:process.pid,startWhen:'first baseline actor-finished sentinel',maximumActors:3,allVersionsFrozenBeforeFirstActor:true},null,2)+'\n',{flag:'wx'});
const watchers=[];let releasedBy;
try{
 releasedBy=await Promise.race(arms.map(arm=>new Promise(resolve=>{
  const done=join(root,arm,'actor-finished.json');
  if(existsSync(done)){resolve(arm);return;}
  const watcher=watch(join(root,arm),()=>{if(existsSync(done))resolve(arm);});watchers.push(watcher);
  if(existsSync(done))resolve(arm);
 })));
}finally{for(const watcher of watchers)watcher.close();}
writeFileSync(join(root,'after-dispatched.json'),JSON.stringify({releasedBy,dispatchedAt:new Date().toISOString()},null,2)+'\n');
const child=spawn(process.execPath,[join(here,'run-codex-round7.mjs'),'codex-cairn-after'],{stdio:'inherit'});
const result=await new Promise(resolve=>{child.on('error',error=>resolve({error:error.message,exitCode:1}));child.on('close',(exitCode,signal)=>resolve({exitCode,signal}));});
if(result.error)throw new Error(result.error);process.exitCode=result.exitCode??1;
