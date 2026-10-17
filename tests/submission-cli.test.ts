import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';

test('submission CLI exposes persistent host-managed task, status, hints and timeline without a daemon',()=>{
 const cwd=mkdtempSync(join(tmpdir(),'cairn-submit-cli-')),entry=resolve('dist/cairn.mjs');
 const call=(args:string[])=>{
  const result=spawnSync(process.execPath,[entry,...args],{cwd,encoding:'utf8',env:{...process.env,CAIRN_DB:join(cwd,'state.db'),CAIRN_VERIFY_COMMAND:'',CAIRN_DEADLINE:'',CAIRN_SUBMIT_RESERVE_MS:'30000'}});
  assert.equal(result.status,0,result.stderr);return JSON.parse(result.stdout);
 };
 try{
  const submitted=call(['submit','--title','Reproduce','--origin','Input is immutable','--goal','Deliver exact result','--criterion','Result exists','--criterion','Replay passed','--constraint','Do not modify source']);
  assert.equal(submitted.title,'Reproduce');assert.equal(submitted.executionMode,'host-managed');assert.equal(submitted.criteria.length,2);assert.deepEqual(submitted.constraints,['Do not modify source']);
  call(['hint',submitted.taskId,'Check target environment']);
  const status=call(['status',submitted.taskId]);assert.equal(status.hints[0].text,'Check target environment');assert.equal(status.status,'active');
  const timeline=call(['graph',submitted.taskId,'--format','timeline']);assert.equal(timeline.taskId,submitted.taskId);assert.ok(timeline.events.some((event:any)=>event.kind==='hint.added'));
  const graph=call(['graph',submitted.taskId]);assert.equal(graph.goal,'Deliver exact result');
 }finally{rmSync(cwd,{recursive:true,force:true});}
});
