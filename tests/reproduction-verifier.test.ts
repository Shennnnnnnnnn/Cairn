import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync,mkdirSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';

test('independent numeric verifier replays means and rates, rejects fabricated numbers and counter resets',()=>{
 const cwd=mkdtempSync(join(tmpdir(),'cairn-replay-test-'));
 const run=()=>{const result=spawnSync('python3',[resolve('evaluations/public-rca/verify-reproduction.py')],{input:JSON.stringify({owner:{cwd}}),encoding:'utf8'});assert.equal(result.status,0,result.stderr);return JSON.parse(result.stdout);};
 const checks=[{evidenceIndex:0,file:'metric.csv',entity:'pod',metric:'memory',operation:'mean',before:{start:0,end:2,value:2},after:{start:2,end:4,value:6}},{evidenceIndex:1,file:'metric.csv',entity:'pod',metric:'container_fs_writes./dev/vda',operation:'rate',before:{start:1,end:2,value:2},after:{start:2,end:4,value:4}}];
 const save=()=>writeFileSync(join(cwd,'checks.json'),JSON.stringify({checks}));
 try{
  writeFileSync(join(cwd,'metric.csv'),'timestamp,cmdb_id,kpi_name,value\n0,pod,memory,1\n1,pod,memory,3\n2,pod,memory,5\n3,pod,memory,7\n0,pod,container_fs_writes./dev/vda,10\n1,pod,container_fs_writes./dev/vda,12\n2,pod,container_fs_writes./dev/vda,15\n3,pod,container_fs_writes./dev/vda,20\n');
  writeFileSync(join(cwd,'answer.json'),JSON.stringify({evidence:checks.map(({file,entity,metric})=>({file,entity,metric}))}));save();
  assert.equal(run().ok,true);
  checks[0]!.after.value=600;save();assert.equal(run().ok,false);checks[0]!.after.value=6;
  checks[1]!.operation='mean';save();assert.equal(run().ok,false);checks[1]!.before.value=12;checks[1]!.after.value=17.5;save();assert.equal(run().ok,true);checks[1]!.operation='rate';checks[1]!.before.value=2;checks[1]!.after.value=4;save();
  writeFileSync(join(cwd,'metric.csv'),'timestamp,cmdb_id,kpi_name,value\n0,pod,container_fs_writes./dev/vda,10\n1,pod,container_fs_writes./dev/vda,12\n2,pod,container_fs_writes./dev/vda,1\n3,pod,container_fs_writes./dev/vda,3\n');assert.match(JSON.stringify(run()),/counter decreases/);
 }finally{rmSync(cwd,{recursive:true,force:true});}
});


test('numeric replay only accepts source files from the frozen original evidence manifest',()=>{
 const cwd=mkdtempSync(join(tmpdir(),'cairn-replay-source-'));
 try{
  mkdirSync(join(cwd,'evidence'));
  const csv='timestamp,cmdb_id,kpi_name,value\n0,pod,memory,1\n1,pod,memory,3\n2,pod,memory,5\n3,pod,memory,7\n0,pod,cpu,1\n1,pod,cpu,3\n2,pod,cpu,5\n3,pod,cpu,7\n';
  writeFileSync(join(cwd,'evidence/original.csv'),csv);writeFileSync(join(cwd,'evidence/fabricated.csv'),csv);
  const manifest=join(cwd,'input-hashes.json');writeFileSync(manifest,JSON.stringify({'evidence/original.csv':createHash('sha256').update(csv).digest('hex')}));
  const checks=['memory','cpu'].map((metric,i)=>({evidenceIndex:i,file:'evidence/fabricated.csv',entity:'pod',metric,operation:'mean',before:{start:0,end:2,value:2},after:{start:2,end:4,value:6}}));
  const run=()=>{writeFileSync(join(cwd,'checks.json'),JSON.stringify({checks}));writeFileSync(join(cwd,'answer.json'),JSON.stringify({evidence:checks.map(({file,entity,metric})=>({file,entity,metric}))}));const result=spawnSync('python3',[resolve('evaluations/public-rca/verify-reproduction.py'),manifest],{input:JSON.stringify({owner:{cwd}}),encoding:'utf8'});assert.equal(result.status,0,result.stderr);return JSON.parse(result.stdout);};
  assert.match(JSON.stringify(run()),/not a frozen original evidence file/);
  checks.forEach(c=>c.file='evidence/original.csv');assert.equal(run().ok,true);
  writeFileSync(join(cwd,'evidence/original.csv'),readFileSync(join(cwd,'evidence/original.csv'),'utf8')+'4,pod,memory,8\n');assert.match(JSON.stringify(run()),/original evidence changed/);
 }finally{rmSync(cwd,{recursive:true,force:true});}
});

test('replay counts unique normalized source series, not operations or windows',()=>{
 const cwd=mkdtempSync(join(tmpdir(),'cairn-replay-unique-'));
 try{
  mkdirSync(join(cwd,'evidence'));
  writeFileSync(join(cwd,'evidence/original.csv'),'timestamp,cmdb_id,kpi_name,value\n0,pod,memory,1\n1,pod,memory,3\n2,pod,memory,5\n3,pod,memory,7\n0,pod,cpu,1\n1,pod,cpu,3\n2,pod,cpu,5\n3,pod,cpu,7\n');
  const checks=[{evidenceIndex:0,file:'evidence/original.csv',entity:'pod',metric:'memory',operation:'mean',before:{start:0,end:2,value:2},after:{start:2,end:4,value:6}},
   {evidenceIndex:1,file:'evidence/original.csv',entity:'pod',metric:'cpu',operation:'mean',before:{start:0,end:2,value:2},after:{start:2,end:4,value:6}}];
  const run=()=>{
   writeFileSync(join(cwd,'checks.json'),JSON.stringify({checks}));
   writeFileSync(join(cwd,'answer.json'),JSON.stringify({evidence:checks.map(({file,entity,metric})=>({file,entity,metric}))}));
   const result=spawnSync('python3',[resolve('evaluations/public-rca/verify-reproduction.py')],{input:JSON.stringify({owner:{cwd}}),encoding:'utf8'});
   assert.equal(result.status,0,result.stderr);return JSON.parse(result.stdout);
  };
  assert.equal(run().ok,true);
  checks[1]!.metric='memory';checks[1]!.operation='max';checks[1]!.before.value=3;checks[1]!.after.value=7;
  assert.match(JSON.stringify(run()),/distinct source series/i);
  checks[1]!.file='evidence/../evidence/original.csv';
  checks[1]!.before={start:0,end:1,value:1};checks[1]!.after={start:1,end:3,value:5};
  assert.match(JSON.stringify(run()),/distinct source series/i);
  checks[1]!.metric='cpu';assert.equal(run().ok,true);
 }finally{rmSync(cwd,{recursive:true,force:true});}
});
