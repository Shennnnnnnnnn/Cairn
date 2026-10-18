import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {Store} from '../src/core/store.js';
import {Engine} from '../src/core/engine.js';
import {ToolRuntime,coreCatalog} from '../src/tools.js';
import {gatewaySchema} from '../src/gateway.js';

test('an actual local defect can be reproduced, paused, fixed and verified through the six-tool workflow',async()=>{
 const root=mkdtempSync(join(tmpdir(),'cairn-practical-')),source=join(root,'price.mjs'),verification=join(root,'verification.md');
 writeFileSync(source,'export const yuan = cents => cents;\n');
 const calculate=()=>{const result=spawnSync(process.execPath,['--input-type=module','-e',`import {yuan} from ${JSON.stringify(pathToFileURL(source).href)}; console.log(JSON.stringify([1640,0,125].map(yuan)));`],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);return JSON.parse(result.stdout) as number[];};
 const store=new Store(':memory:'),engine=new Engine(store),first=new ToolRuntime(engine,{host:'codex',sessionId:'inspect',cwd:root}),second=new ToolRuntime(engine,{host:'claude',sessionId:'repair',cwd:root});
 try{
  const started:any=await first.invoke('cairn_start',{goal:'修复价格单位换算并验证输出',criteria:['复现错误','修复并通过回归'],scope:{project:'price-library',environment:'local'},progress:[{key:'inspect',title:'复现价格错误',status:'running'},{key:'repair',title:'修复并验证',status:'pending'}]});
  assert.deepEqual(calculate(),[1640,0,125]);
  await first.invoke('cairn_checkpoint',{summary:'已复现分被直接当成元，保留文件供新会话继续。',findings:[{key:'repro',text:'1640分错误显示为1640元',basis:'读取实现并实际运行输入，输出为1640；约定结果应为16.4。',references:[source],covers:['c1']}],progress:[{key:'inspect',title:'复现价格错误',status:'completed'}],questions:['修复后的其他输入是否正确？'],next:'按分/100换算，再验证1640、0和125三个输入。'});
  await first.invoke('cairn_finish',{outcome:'suspended'});
  await second.invoke('cairn_resume',{task_id:started.taskId,takeover:true});
  assert.match(readFileSync(source,'utf8'),/=> cents;/);
  writeFileSync(source,'export const yuan = cents => cents / 100;\n');
  const output=calculate();assert.deepEqual(output,[16.4,0,1.25]);
  writeFileSync(verification,`# 实际回归结果\n\n输入（分）：1640、0、125\n输出（元）：${output.join('、')}\n`);
  const finished:any=await second.invoke('cairn_finish',{summary:'已修复单位换算。实际回归输出为16.4、0、1.25，检查文件已保存。验证仅覆盖本地样例。',findings:[{key:'verified',text:'换算实现已修复且三个实际输入通过',basis:'已修改实现并重新运行独立Node进程核对输出。',references:[source,verification],covers:['c2']}],progress:[{key:'repair',title:'修复并验证',status:'completed'}],questions:[]});
  assert.equal(finished.phase,'completed');assert.equal(finished.validation.ok,true);
  const task=store.get(started.taskId);assert.deepEqual(task.calls,{});assert.deepEqual(task.observations,[]);assert.equal(task.owner.epoch,2);assert.equal(task.budget.deadline,undefined);
  assert.ok(task.report?.summary.includes('实际回归'));assert.equal(task.report?.curatedReferences?.length,2);
 }finally{await first.close();await second.close();store.close();rmSync(root,{recursive:true,force:true});}
});

test('the public interface contains only goal and evidence checks and rejects retired input fields',async()=>{
 const catalog=coreCatalog(),start=catalog.find(tool=>tool.name==='cairn_start')!.inputSchema as any,finish=catalog.find(tool=>tool.name==='cairn_finish')!.inputSchema as any;
 assert.ok(!('profile' in start.properties));assert.ok(!('submitReserveMs' in start.properties.budget.properties));
 assert.deepEqual(Object.keys(finish.properties),['outcome','summary']);
 const store=new Store(':memory:'),engine=new Engine(store),session={host:'codex' as const,sessionId:'normal',cwd:'/workspace'},runtime=new ToolRuntime(engine,session);
 try{
  await assert.rejects(runtime.invoke('cairn_start',{goal:'Work',profile:'emergency'}));
  await assert.rejects(runtime.invoke('cairn_start',{goal:'Work',budget:{submitReserveMs:30000}}));
  assert.equal(store.list().length,0);
  const base={servers:{service:{command:process.execPath}},tools:[{name:'lookup',server:'service',upstream:'lookup'}]};
  assert.equal(gatewaySchema.safeParse({...base,tools:[{...base.tools[0],role:'submit',receiptPath:'receipt',reportPath:'report'}]}).success,false);
  assert.equal(store.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='matches'").get(),undefined);
  const task=engine.create(session,{origin:'Local request',goal:'Check a file',criteria:['File checked']});
  engine.observe(task.id,session,{callId:'read',tool:'read_file',input:{path:'file.txt'},output:'verified',source:'hook',status:'success'});
  const result=engine.finish(task.id,session,{outcome:'completed',summary:'File checked',findings:[{text:'The file contains the expected marker',evidence:['E1']}]});
  assert.equal(result.phase,'completed');assert.equal(result.status,'completed');
 }finally{await runtime.close();store.close();}
});
