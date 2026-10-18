// Import completed experiment states and posthoc reference grades into a UI COPY only.
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {join,resolve,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {Engine,Store} from '../../dist/index.js';
const here=dirname(fileURLToPath(import.meta.url));
const runId=process.argv[2]??'2026-10-17-aiops2022-round5';
if(!/^[A-Za-z0-9_-]+$/.test(runId))throw new Error('Use a run ID, not a filesystem path');
const run=join(here,'runs',runId),review=join(here,'runs/ui-review-2026-10-17');
if(!existsSync(join(run,'finished.json')))throw new Error('All actors must end before importing independent grades');
const summary=JSON.parse(readFileSync(join(run,'summary.json'),'utf8'));
if(!summary.finished||summary.results.length!==12||summary.audit.failures.length)throw new Error('Finish and audit the twelve episodes first');
const manifest=JSON.parse(readFileSync(join(review,'manifest.json'),'utf8'));
const store=new Store(join(review,'state.db')),engine=new Engine(store);
let added=0,assessed=0;
try{
 for(const row of summary.results.filter(row=>row.mode!=='pi')){
  const source=join(run,row.case,row.mode,'workspace/.cairn/state.db');
  if(!existsSync(source))continue;
  const sql=new DatabaseSync(source,{readOnly:true});
  try{
   const rows=sql.prepare('SELECT id,state FROM tasks ORDER BY rowid').all();
   for(const entry of rows){
    const task=JSON.parse(entry.state),initial=row.tasks.some(t=>t.id===task.id);
    const grade=initial?row.reviewedGrade:row.recovery?.grade;
    if(!store.db.prepare('SELECT id FROM tasks WHERE id=?').get(task.id)){
     store.transaction(()=>{
      store.db.prepare('INSERT INTO tasks VALUES (?,?)').run(task.id,entry.state);
      for(const e of sql.prepare('SELECT kind,payload,at FROM events WHERE task_id=? ORDER BY seq').all(task.id))store.db.prepare('INSERT INTO events(task_id,kind,payload,at) VALUES (?,?,?,?)').run(task.id,e.kind,e.payload,e.at);
     });added++;
    }
    if(!manifest.tasks.some(t=>t.taskId===task.id))manifest.tasks.push({round:row.mode==='pi-cairn'?'同模型新版':'同模型旧版',mode:row.mode,run:runId,case:row.case,phase:initial?'initial':'recovery',taskId:task.id,status:task.status,source:resolve(source),stateSha256:createHash('sha256').update(entry.state).digest('hex'),url:`http://127.0.0.1:8012/?run=${runId}&case=${row.case}#${task.id}`});
    if(grade&&store.get(task.id).report){
     const status=!grade.validAnswer?'inconclusive':grade.jointTop1?'passed':'failed';
     const before=engine.assessmentStatus(store.get(task.id));
     if(!before||before.status!==status||store.get(task.id).assessment?.reviewer!=='host:offline-public-case-reference'){
      engine.assess(task.id,{status,summary:!grade.validAnswer?'本阶段未保存有效答案，无法评定根因结论':grade.jointTop1?'首选对象与故障大类均命中独立参考标签':'首选对象或故障大类未命中独立参考标签',scope:!grade.validAnswer?'未保存可评分的阶段答案；缺少交付不等于根因错误，不对中间假设补评分':'仅阶段答案的首选对象＋故障大类，采用冻结的服务协议后缀政策；不评价全文因果、指标语义或实际修复效果',reviewer:'host:offline-public-case-reference'});assessed++;
     }
    }
   }
  }finally{sql.close();}
 }
 const names={'2026-10-16-aiops2022':'首次','2026-10-16-aiops2022-round2b':'第二次','2026-10-17-aiops2022-round3c':'上轮', '2026-10-17-aiops2022-round4b':'第四轮', [runId]:'第五轮'};
 for(const entry of manifest.tasks){
  const task=store.get(entry.taskId),prefix=`${entry.run===runId?entry.round:(names[entry.run]??entry.run)} / ${entry.case}${entry.phase==='recovery'?' / 恢复':''}`;
  if(!task.title?.startsWith(prefix)&&entry.run===runId){
   task.title=`${prefix} · ${task.title??'公开案例排障'}`;task.revision++;
   store.save(task,'ui.review_labeled',{summary:'复盘副本显示轮次／案例标签；原目标与原始数据库未改'},new Date().toISOString());
  }
 }
 manifest.scope='Review copy of original task states and per-task audit history. Source goals/findings stay unchanged. Copy-only titles identify round/case; independent outcome assessments are appended after all actors end. Global event seq is reassigned. No source DB is modified.';
 manifest.updatedAt=new Date().toISOString();writeFileSync(join(review,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
 console.log(JSON.stringify({database:join(review,'state.db'),tasks:store.list().length,added,assessed,sourceDatabasesUntouched:true}));
}finally{store.close();}
