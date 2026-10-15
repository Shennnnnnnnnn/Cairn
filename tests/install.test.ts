import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,mkdirSync,existsSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {install,uninstall,location,type Target} from '../src/install.js';
const bundles=resolve('dist/plugins');
for(const target of ['pi','claude','codex'] as Target[])test(`${target}: isolated project and user installation updates and uninstalls without damaging other settings`,()=>{
 for(const scope of ['project','user'] as const){
  const root=mkdtempSync(join(tmpdir(),`cairn-${target}-`));
  const path=join(root,target==='pi'?(scope==='user'?'.pi/agent/settings.json':'.pi/settings.json'):target==='claude'?'.claude/settings.json':'.codex/config.toml');mkdirSync(resolve(path,'..'),{recursive:true});
  writeFileSync(path,target==='codex'?'# custom comment\nmodel = "existing-model"\n':JSON.stringify({model:'existing-model',...(target==='pi'?{packages:['existing-plugin']}:{} )}));
  const result=install(target,scope,root,bundles);assert.ok(existsSync(join(result.plugin,'runtime/cairn.mjs')));
  install(target,scope,root,bundles);
  if(target==='codex'){
   const content=readFileSync(path,'utf8');assert.equal(content.split('# BEGIN CAIRN MANAGED').length,2);assert.ok(content.includes('# custom comment'));
  }else{const content=JSON.parse(readFileSync(path,'utf8'));assert.equal(content.model,'existing-model');if(target==='pi')assert.deepEqual(content.packages,['existing-plugin',result.plugin]);}
  const data=join(root,'.cairn','state.db');writeFileSync(data,'data stays');
  assert.equal(uninstall(target,scope,root).removed,true);assert.ok(existsSync(data));assert.ok(!existsSync(location(target,scope,root).receipt));
  if(target==='codex')assert.ok(readFileSync(path,'utf8').includes('model = "existing-model"'));else assert.equal(JSON.parse(readFileSync(path,'utf8')).model,'existing-model');
  rmSync(root,{recursive:true});
 }
});
test('uninstall retains a registration changed by the user and its executable',()=>{
 const root=mkdtempSync(join(tmpdir(),'cairn-edit-')),result=install('claude','project',root,bundles),file=join(root,'.claude/settings.json');
 const data=JSON.parse(readFileSync(file,'utf8'));data.enabledPlugins['cairn@cairn-local']=false;writeFileSync(file,JSON.stringify(data));
 const removed=uninstall('claude','project',root);assert.equal(removed.removed,false);assert.ok(existsSync(join(result.plugin,'runtime/cairn.mjs')));rmSync(root,{recursive:true});
});
test('installer preflights conflicts before replacing an unrelated registration',()=>{
 const root=mkdtempSync(join(tmpdir(),'cairn-conflict-')),file=join(root,'.claude/settings.json');mkdirSync(resolve(file,'..'),{recursive:true});
 writeFileSync(file,JSON.stringify({enabledPlugins:{'cairn@cairn-local':false}}));
 assert.throws(()=>install('claude','project',root,bundles),/Existing registration/);assert.equal(existsSync(join(root,'.cairn/installations/claude/plugin')),false);rmSync(root,{recursive:true});
});
test('Codex update replaces the previously owned hook definition while preserving another plugin',()=>{
 const root=mkdtempSync(join(tmpdir(),'cairn-hook-update-'));install('codex','project',root,bundles);
 const receiptPath=location('codex','project',root).receipt,receipt=JSON.parse(readFileSync(receiptPath,'utf8'));
 const change=receipt.changes.find((c:any)=>c.kind==='array'&&c.keys[1]==='PreToolUse');
 const hooks=JSON.parse(readFileSync(change.file,'utf8')),external={hooks:[{type:'command',command:'echo other-plugin'}]};
 change.value.hooks[0].timeout=99;hooks.hooks.PreToolUse=[change.value,external];
 writeFileSync(change.file,JSON.stringify(hooks));writeFileSync(receiptPath,JSON.stringify(receipt));
 install('codex','project',root,bundles);const updated=JSON.parse(readFileSync(change.file,'utf8')).hooks.PreToolUse;
 assert.equal(updated.length,2);assert.deepEqual(updated[0],external);assert.equal(updated[1].hooks[0].timeout,5);
 uninstall('codex','project',root);assert.deepEqual(JSON.parse(readFileSync(change.file,'utf8')).hooks.PreToolUse,[external]);rmSync(root,{recursive:true});
});
