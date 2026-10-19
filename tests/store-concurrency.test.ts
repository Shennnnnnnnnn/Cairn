import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';

test('fresh Claude hook and MCP processes can initialize the same database concurrently',async()=>{
 const root=mkdtempSync(join(tmpdir(),'cairn-db-race-')),path=join(root,'state.db');
 const module=new URL('../src/core/store.ts',import.meta.url).href;
 try{
  const results=await Promise.all(Array.from({length:6},()=>new Promise<{code:number|null;error:string}>((resolve,reject)=>{
   const child=spawn(process.execPath,['--import','tsx','--input-type=module','-e',`import {Store} from ${JSON.stringify(module)}; const store=new Store(${JSON.stringify(path)}); store.close();`],{stdio:['ignore','ignore','pipe']});
   let error='';child.stderr.on('data',c=>error+=c);child.once('error',reject);child.once('close',code=>resolve({code,error}));
  })));
  for(const r of results)assert.equal(r.code,0,r.error);
 }finally{rmSync(root,{recursive:true,force:true});}
});
