import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { Store } from '../src/core/store.js';
import { Engine } from '../src/core/engine.js';
import { startUi } from '../src/ui/server.js';

const session={host:'codex' as const,sessionId:'human-test',cwd:'/workspace'};
test('human routes require a per-server token, same origin, JSON, bounded bodies and a current revision',async()=>{
  const store=new Store(':memory:'),engine=new Engine(store),task=engine.create(session,{origin:'user',goal:'Verify',criteria:['Verify'],evidenceMode:'curated'});
  const ui=await startUi(engine,{port:0});
  try{
    const source=await (await fetch(ui.url)).text(),token=/<meta name="cairn-csrf" content="([^"]+)"/.exec(source)![1]!;
    const path=`${ui.url}/api/tasks/${task.id}/hints`,headers={'Content-Type':'application/json','X-Cairn-CSRF':token};
    const body=JSON.stringify({revision:task.revision,text:'New input'});
    assert.equal((await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body})).status,403);
    assert.equal((await fetch(path,{method:'POST',headers:{...headers,Origin:'https://other.example'},body})).status,403);
    assert.equal((await fetch(path,{method:'POST',headers:{...headers,'Content-Type':'text/plain'},body})).status,415);
    assert.equal((await fetch(path,{method:'POST',headers,body:'invalid JSON'})).status,400);
    assert.equal((await fetch(path,{method:'POST',headers,body:JSON.stringify({revision:task.revision,text:'x'.repeat(33000)})})).status,413);
    assert.equal(store.get(task.id).revision,task.revision);
    assert.equal((await fetch(path,{method:'POST',headers,body})).status,200);
    assert.equal((await fetch(path,{method:'POST',headers,body})).status,409);
    let saved=store.get(task.id);assert.equal(saved.hints[0]?.author,'human');
    assert.equal((await fetch(`${ui.url}/api/tasks/${task.id}/suspend`,{method:'POST',headers,body:JSON.stringify({revision:saved.revision})})).status,200);
    saved=store.get(task.id);assert.equal(saved.status,'suspended');assert.equal(saved.owner.epoch,2);
    engine.resume(task.id,session);
    engine.finish(task.id,session,{outcome:'completed',summary:'Done',findings:[{text:'Verified',basis:'Measured'}]});engine.update(task.id,session,{review:{snapshot:store.graphState(task.id).seq,summary:'Reviewed operator feedback and measured evidence'}});engine.finish(task.id,session,{outcome:'completed'});saved=store.get(task.id);
    assert.equal((await fetch(`${ui.url}/api/tasks/${task.id}/reopen`,{method:'POST',headers,body:JSON.stringify({revision:saved.revision,reason:'External validation failed'})})).status,200);
    assert.equal(store.get(task.id).status,'active');assert.equal(engine.check(task.id).ok,false);
    assert.ok(store.events(task.id).some(event=>event.kind==='task.reopened'));
  }finally{await ui.close();store.close();}
});

test('human CLI hints, pause and reopen need no agent identity or temporary JSON files',()=>{
  const root=mkdtempSync(join(tmpdir(),'cairn-human-cli-')),path=join(root,'state.db'),store=new Store(path),engine=new Engine(store);
  try{
    const task=engine.create({...session,cwd:root},{origin:'user',goal:'Verify',criteria:['Verify'],evidenceMode:'curated'});
    const run=(args:string[])=>{
      const result=spawnSync(process.execPath,[resolve('dist/cairn.mjs'),...args,'--db',path,'--root',root],{encoding:'utf8',timeout:10000});
      assert.equal(result.status,0,result.stderr);return JSON.parse(result.stdout);
    };
    const hint=run(['task','hint',task.id,'优先复查超时配置','--author','human']);assert.equal(hint.text,'优先复查超时配置');
    run(['task','suspend',task.id]);assert.equal(store.get(task.id).status,'suspended');
    engine.resume(task.id,{...session,cwd:root});engine.finish(task.id,{...session,cwd:root},{outcome:'completed',summary:'Done',findings:[{key:'result',text:'Verified',basis:'Checked'}]});
    engine.update(task.id,{...session,cwd:root},{review:{snapshot:store.graphState(task.id).seq,summary:'Reviewed feedback and saved verification'}});engine.finish(task.id,{...session,cwd:root},{outcome:'completed'});
    run(['task','hint',task.id,'验证反馈']);assert.equal(store.get(task.id).status,'completed');
    const reopened=run(['task','reopen',task.id,'--reason','外部验证失败','--invalidate','result']);assert.equal(reopened.status,'active');
    assert.equal(store.get(task.id).claims.find(c=>c.key==='result')?.status,'proposed');
  }finally{store.close();rmSync(root,{recursive:true,force:true});}
});
