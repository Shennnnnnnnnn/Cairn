import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Engine} from '../src/core/engine.js';
import {Store} from '../src/core/store.js';
import {Scheduler,type HostRequest} from '../src/scheduler.js';
import {parsePhaseOutput,phaseContract} from '../src/scheduler/protocol.js';

for(const mode of ['fresh-full','reuse-delta'] as const)test(`Coordinator ${mode} retains the entire fact graph without sharing Explore sessions`,async()=>{
  const cwd=mkdtempSync(join(tmpdir(),'cairn-context-policy-')),store=new Store(join(cwd,'state.db')),engine=new Engine(store);
  const owner={host:'mcp' as const,sessionId:'owner',cwd},task=engine.create(owner,{origin:'Local documents',goal:'Compare two documented versions',criteria:['Resolve the version difference'],evidenceMode:'curated'});
  const requests:HostRequest[]=[];let reasons=0;
  try{
    const result=await new Scheduler(engine,owner,{canResume:()=>true,async execute(request){
      requests.push(request);const sessionRef=request.resume??`native:${requests.length}`;
      const reply=(data:unknown)=>({output:JSON.stringify(data),sessionRef,metrics:{toolCalls:0}});
      if(request.phase==='bootstrap')return reply({decision:'continue',checkpoint:{findings:[{key:'version',text:'Document A is version one',status:'supported',basis:'A header',covers:[]}]}});
      if(request.phase==='explore'){
        assert.equal(request.resume,undefined);
        return reply({decision:'continue',checkpoint:{findings:[{key:'difference',text:'Document B is version two',basis:'B header'}]}});
      }
      reasons++;
      const board=JSON.parse(request.prompt.split('Saved blackboard:\n').at(-1)!);
      assert.equal(request.contextMode,mode==='fresh-full'?'full':'delta');
      assert.equal(request.resume,mode==='fresh-full'?undefined:'native:1');
      const full=board.fullSnapshot?JSON.parse(readFileSync(board.fullSnapshot.path,'utf8')):board;
      assert.ok(full.findings.some((f:any)=>f.key==='version'));
      if(reasons===1)return reply({decision:'continue',intents:[{key:'compare',title:'Read the other version to resolve the difference',from:['version']}]});
      const proposal=full.findings.find((f:any)=>f.key.startsWith('branch:'));
      assert.equal(proposal.status,'proposed');assert.deepEqual(proposal.covers,[]);
      return reply({decision:'complete',checkpoint:{findings:[{key:proposal.key,text:'The versions differ as documented',status:'supported',basis:'Compared both original headers',covers:['c1']}]}});
    }},{coordinatorMode:mode}).run(task.id);
    assert.equal(result.status,'completed',result.reason);assert.equal(reasons,2);
    assert.deepEqual(requests.map(r=>r.phase),['bootstrap','reason','explore','reason']);
  }finally{store.close();rmSync(cwd,{recursive:true,force:true});}
});

test('Explore may omit host-owned proposal status and coverage, but cannot override them',()=>{
  const raw=JSON.stringify({decision:'continue',checkpoint:{findings:[{key:'observed',text:'The source contains a version header'}]}});
  const finding=parsePhaseOutput(raw,true).checkpoint!.findings![0]!;
  assert.equal(finding.status,'proposed');assert.deepEqual(finding.covers,[]);
  assert.throws(()=>parsePhaseOutput(raw.replace('"text":','"covers":["c1"],"text":'),true));
  assert.throws(()=>parsePhaseOutput(raw.replace('"text":','"status":"supported","text":'),true));
  const shape=phaseContract(true).split('\n')[1]!;
  assert.ok(!shape.includes('status:'));assert.ok(!shape.includes('covers:'));
});

test('A next-step list is transported verbatim as lines without another model call',()=>{
  const parsed=parsePhaseOutput(JSON.stringify({decision:'continue',checkpoint:{next:['Inspect source A','Compare source B']}}),false);
  assert.equal(parsed.checkpoint!.next,'Inspect source A\nCompare source B');
  for(const next of [[1],['ok',{}],['x'.repeat(4001)]])assert.throws(()=>parsePhaseOutput(JSON.stringify({decision:'continue',checkpoint:{next}}),false));
});

test('Completion and new exploration cannot be requested together',()=>{
  assert.throws(()=>parsePhaseOutput(JSON.stringify({decision:'complete',intents:[{key:'gap',title:'Resolve a required evidence gap'}]}),false));
});

for(const mode of ['fresh-full','reuse-delta'] as const)test(`Direct completion needs no extra review in ${mode}`,async()=>{
  const cwd=mkdtempSync(join(tmpdir(),'cairn-direct-policy-')),store=new Store(join(cwd,'state.db')),engine=new Engine(store);
  const owner={host:'mcp' as const,sessionId:'owner',cwd},task=engine.create(owner,{origin:'Documented source',goal:'Read the documented version',criteria:['The version is documented'],evidenceMode:'curated'});
  let calls=0;
  try{
    const result=await new Scheduler(engine,owner,{async execute(request){calls++;assert.equal(request.phase,'bootstrap');return {output:JSON.stringify({decision:'complete',checkpoint:{findings:[{key:'version',text:'Version one',status:'supported',basis:'Read the source header',covers:['c1']}]}})};}},{coordinatorMode:mode}).run(task.id);
    assert.equal(result.status,'completed',result.reason);assert.equal(calls,1);
  }finally{store.close();rmSync(cwd,{recursive:true,force:true});}
});
