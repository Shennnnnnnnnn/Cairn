import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { spawnSync } from 'node:child_process';
import { CliHostExecutor } from '../src/scheduler/host.js';
import type { HostRequest } from '../src/scheduler.js';
import { Engine } from '../src/core/engine.js';
import { Store } from '../src/core/store.js';

function fixture(code: string, host: 'pi' | 'codex' = 'pi') {
  const root = mkdtempSync(join(tmpdir(), 'cairn-scheduler-host-')), script = join(root, 'native.mjs');
  writeFileSync(script, `import {writeFileSync} from 'node:fs';\nconst args=process.argv.slice(2);\nwriteFileSync(${JSON.stringify(join(root, 'argv.json'))},JSON.stringify(args));\nconst emit=value=>process.stdout.write(JSON.stringify(value)+'\\n');\n${code}`);
  const executor = new CliHostExecutor({ executor: host, model: host === 'pi' ? 'global:deepseek-v4.1-flash' : 'gpt-6.1-sol', effort: host === 'pi' ? 'high' : 'xhigh', command: process.execPath, commandArgs: [script], logDir: join(root, 'logs') });
  const request: HostRequest = { id: 'phase-1', taskId: 'task-1', cwd: root, phase: 'bootstrap', prompt: 'Return a result' };
  return { root, executor, request, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test('Pi native adapter preserves argv, returns the last public result and records usage without private thinking', async () => {
  const f = fixture(`
emit({type:'session',id:'native-id'});
emit({type:'message_update',assistantMessageEvent:{type:'thinking_delta',delta:'PRIVATE_THINKING_SENTINEL'}});
emit({type:'tool_execution_start',toolCallId:'tool-1',toolName:'bash',args:{command:'native command'}});
emit({type:'tool_execution_end',toolCallId:'tool-1',isError:false,result:{content:[{type:'text',text:'TOOL_BODY_SENTINEL'}]}});
emit({type:'message_end',message:{role:'assistant',model:'global:deepseek-v4.1-flash',provider:'configured-provider',thinkingLevel:'high',stopReason:'stop',content:[{type:'thinking',thinking:'PRIVATE_THINKING_SENTINEL'},{type:'text',text:'{"summary":"complete"}'}],usage:{input:100,cacheRead:20,cacheWrite:4,output:30}}});
`);
  try {
    const announced: string[] = [];
    f.request.prompt = '- Literal $(touch injected) and `touch injected-two`';
    f.request.onSession = reference => announced.push(reference);
    const result = await f.executor.execute(f.request);
    assert.equal(result.error, undefined);
    assert.equal(result.output, '{"summary":"complete"}');
    assert.equal(announced.length, 1);
    assert.equal(result.sessionRef, announced[0]);
    assert.ok(result.sessionRef?.endsWith('native-session.jsonl'));
    const argv = JSON.parse(readFileSync(join(f.root, 'argv.json'), 'utf8')) as string[];
    assert.equal(argv.includes('--provider'), false, 'A colon in a model ID does not identify its provider');
    assert.equal(argv[argv.indexOf('--model') + 1], 'global:deepseek-v4.1-flash');
    assert.equal(argv[argv.indexOf('--thinking') + 1], 'high');
    assert.equal(argv[argv.indexOf('--exclude-tools') + 1], 'cairn_*');
    assert.deepEqual(argv.slice(-2), ['--', f.request.prompt]);
    assert.equal(existsSync(join(f.root, 'injected')), false);
    const metrics = result.metrics!;
    assert.deepEqual(metrics.usage, { input_tokens: 124, cached_input_tokens: 20, cache_write_input_tokens: 4, output_tokens: 30 });
    assert.deepEqual(metrics.actualModels, ['global:deepseek-v4.1-flash']);
    assert.deepEqual(metrics.actualProviders, ['configured-provider']);
    assert.equal(metrics.toolCalls, 1);
    const audit = readFileSync(metrics.auditPath as string, 'utf8');
    assert.ok(!audit.includes('PRIVATE_THINKING_SENTINEL'));
    assert.ok(!audit.includes('TOOL_BODY_SENTINEL'));
    assert.ok(audit.includes('assistant.completed'));
    assert.ok((metrics.wallSeconds as number) >= 0);
  } finally { f.cleanup(); }
});

test('Pi model selectors remain opaque when an explicit provider is supplied separately', async () => {
  const f = fixture(`emit({type:'message_end',message:{role:'assistant',stopReason:'stop',content:[{type:'text',text:'{"summary":"saved"}'}],usage:{input:1,output:1}}});`);
  try {
    for (const model of ['global:deepseek-v4.1-flash', 'cn:glm-5.3', 'vendor:model:revision']) {
      const executor = new CliHostExecutor({ ...f.executor.options, model, provider: 'configured-provider' });
      const result = await executor.execute(f.request);
      assert.equal(result.error, undefined);
      const argv = JSON.parse(readFileSync(join(f.root, 'argv.json'), 'utf8')) as string[];
      assert.equal(argv[argv.indexOf('--model') + 1], model);
      assert.equal(argv[argv.indexOf('--provider') + 1], 'configured-provider');
      assert.equal(argv.filter(arg => arg === '--model').length, 1);
      assert.equal(result.metrics!.requestedModel, model);
      assert.equal(result.metrics!.requestedProvider, 'configured-provider');
    }
    assert.throws(() => new CliHostExecutor({ executor: 'codex', model: 'opaque:model', provider: 'configured-provider' }), /only supported for the Pi executor/);
    assert.throws(() => new CliHostExecutor({ executor: 'pi', model: 'opaque:model', provider: ' ' }), /must not be empty/);
  } finally { f.cleanup(); }
});

test('Pi conclude resumes exactly the supplied native session', async () => {
  const f = fixture(`writeFileSync(args[args.indexOf('--session')+1],'{"type":"session","id":"existing"}\\n');emit({type:'message_end',message:{role:'assistant',stopReason:'stop',content:[{type:'text',text:'{"summary":"saved"}'}],usage:{input:1,output:1}}});`);
  try {
    const first = await f.executor.execute(f.request), reference = first.sessionRef!;
    assert.equal(f.executor.canResume(reference, f.root), true);
    const result = await f.executor.execute({ ...f.request, phase: 'conclude', resume: reference });
    const argv = JSON.parse(readFileSync(join(f.root, 'argv.json'), 'utf8')) as string[];
    assert.equal(argv[argv.indexOf('--session') + 1], reference);
    assert.equal(result.sessionRef, reference);
    assert.equal(result.error, undefined);
  } finally { f.cleanup(); }
});

test('Pi phase repair resumes the original session with all tools disabled and records the repair policy', async () => {
  const f = fixture(`writeFileSync(args[args.indexOf('--session')+1],'{"type":"session","id":"existing"}\\n');emit({type:'message_end',message:{role:'assistant',stopReason:'stop',content:[{type:'text',text:'{"decision":"continue"}'}],usage:{input:2,output:2}}});`);
  try {
    const executor = new CliHostExecutor({ ...f.executor.options, commandArgs: [...f.executor.options.commandArgs!, '--tools', 'read,bash', '--exclude-tools', 'cairn_*'] });
    const original = await executor.execute({ ...f.request, phase: 'reason', contextMode: 'full' });
    assert.equal(original.error, undefined);
    const ordinary = JSON.parse(readFileSync(join(f.root, 'argv.json'), 'utf8')) as string[];
    assert.equal(ordinary.includes('--no-tools'), false);
    assert.equal(ordinary[ordinary.lastIndexOf('--exclude-tools') + 1], 'cairn_*');
    const repair = { of: f.request.id, attempt: 1, issues: [{ path: 'checkpoint.findings[0].text', message: 'Maximum 1600 characters.' }] };
    const fixed = await executor.execute({ ...f.request, phase: 'reason', resume: original.sessionRef, repair, contextMode: 'repair' });
    assert.equal(fixed.error, undefined);
    const argv = JSON.parse(readFileSync(join(f.root, 'argv.json'), 'utf8')) as string[];
    assert.equal(argv.filter(value => value === '--no-tools').length, 1);
    assert.equal(argv[argv.lastIndexOf('--exclude-tools') + 1], '*', 'Deny-all must override the configured --tools/exclude prefix');
    assert.equal(argv[argv.indexOf('--session') + 1], original.sessionRef);
    assert.equal(fixed.sessionRef, original.sessionRef);
    assert.equal(fixed.metrics!.repairToolPolicy, 'disabled');
    assert.equal(fixed.metrics!.toolCalls, 0);
    const events = readFileSync(fixed.metrics!.auditPath as string, 'utf8').trim().split('\n').map(line => JSON.parse(line));
    const started = events.find(event => event.type === 'host.started');
    assert.deepEqual(started.repair, repair); assert.equal(started.contextMode, 'repair');
    const missingSession = await executor.execute({ ...f.request, repair, contextMode: 'repair' });
    assert.match(missingSession.error!, /repair requires the original native session/i);
  } finally { f.cleanup(); }
});

test('Codex repair audits every public action including file changes without claiming tools are disabled', async () => {
  const f = fixture(`
emit({type:'thread.started',thread_id:'00000000-0000-4000-8000-000000000002'});
emit({type:'item.completed',item:{type:'reasoning',text:'PRIVATE_THINKING_SENTINEL'}});
emit({type:'item.completed',item:{type:'file_change',id:'patch',changes:[{path:'file',kind:'update'}],status:'completed'}});
emit({type:'item.completed',item:{type:'todo_list',id:'plan',items:[]}});
emit({type:'item.completed',item:{type:'agent_message',text:'{"decision":"continue"}'}});
emit({type:'turn.completed',usage:{input_tokens:2,output_tokens:2}});
`, 'codex');
  try {
    const original = await f.executor.execute({ ...f.request, phase: 'reason', contextMode: 'full' });
    assert.equal(original.error, undefined); assert.equal(original.metrics!.toolCalls, 0, 'Ordinary phase metrics keep their existing semantics');
    const repair = { of: f.request.id, attempt: 1, issues: [{ path: 'decision', message: 'Use an allowed value.' }] };
    const fixed = await f.executor.execute({ ...f.request, phase: 'reason', resume: original.sessionRef, repair, contextMode: 'repair' });
    assert.equal(fixed.error, undefined);
    assert.equal(fixed.metrics!.toolCalls, 2, 'file_change and plan actions cannot masquerade as zero-action repair');
    assert.equal(fixed.metrics!.repairToolPolicy, 'audited');
    const argv = JSON.parse(readFileSync(join(f.root, 'argv.json'), 'utf8')) as string[];
    assert.deepEqual(argv.slice(0, 3), ['exec', 'resume', original.sessionRef]);
    assert.ok(!argv.some(value => value.includes('bypass') || value === '--no-tools' || value.includes('approval_policy')));
    const events = readFileSync(fixed.metrics!.auditPath as string, 'utf8').trim().split('\n').map(line => JSON.parse(line));
    const started = events.find(event => event.type === 'host.started');
    assert.deepEqual(started.repair, repair); assert.equal(started.contextMode, 'repair');
    assert.ok(!JSON.stringify(events).includes('PRIVATE_THINKING_SENTINEL'));
  } finally { f.cleanup(); }
});

test('Codex repair audits started-only actions, deduplicates identified lifecycle events and counts anonymous events conservatively', async () => {
  const f = fixture(`
emit({type:'thread.started',thread_id:'00000000-0000-4000-8000-000000000003'});
emit({type:'item.started',item:{type:'command_execution',id:'unfinished-command',status:'in_progress'}});
emit({type:'item.started',item:{type:'file_change',id:'patch',status:'in_progress'}});
emit({type:'item.updated',item:{type:'file_change',id:'patch',status:'in_progress'}});
emit({type:'item.completed',item:{type:'file_change',id:'patch',status:'completed'}});
emit({type:'item.updated',item:{type:'file_change',status:'in_progress'}});
emit({type:'item.completed',item:{type:'file_change',status:'completed'}});
emit({type:'item.started',item:{type:'reasoning',id:'private',text:'PRIVATE_THINKING_SENTINEL'}});
emit({type:'item.updated',item:{type:'reasoning',id:'private',text:'PRIVATE_THINKING_SENTINEL'}});
emit({type:'item.completed',item:{type:'agent_message',text:'{"decision":"continue"}'}});
emit({type:'turn.completed',usage:{input_tokens:2,output_tokens:2}});
`, 'codex');
  try {
    const ordinary = await f.executor.execute({ ...f.request, phase: 'reason' });
    assert.equal(ordinary.error, undefined); assert.equal(ordinary.metrics!.toolCalls, 0, 'Normal phases retain their completed-known-action accounting');
    const repaired = await f.executor.execute({ ...f.request, phase: 'reason', resume: ordinary.sessionRef, repair: { of: f.request.id, attempt: 1, issues: [{ path: '$', message: 'Repair output only.' }] }, contextMode: 'repair' });
    assert.equal(repaired.error, undefined);
    assert.equal(repaired.metrics!.toolCalls, 4, 'One started-only action + one identified patch + two anonymous action events');
    assert.equal(repaired.metrics!.repairToolPolicy, 'audited', 'Codex reports observed activity; it does not prevent that activity before execution');
    const audit = readFileSync(repaired.metrics!.auditPath as string, 'utf8');
    assert.ok(audit.includes('unfinished-command')); assert.ok(!audit.includes('PRIVATE_THINKING_SENTINEL'));
  } finally { f.cleanup(); }
});

test('conclude cannot silently replace a lost original session with a fresh conversation', async () => {
  const f = fixture('');
  try {
    const missingReference = await f.executor.execute({ ...f.request, phase: 'conclude' });
    assert.match(missingReference.error!, /requires the original native session/);
    const lostFile = await f.executor.execute({ ...f.request, phase: 'conclude', resume: join(f.root, 'lost.jsonl') });
    assert.match(lostFile.error!, /refusing to create a replacement/);
    assert.equal(existsSync(join(f.root, 'argv.json')), false);
  } finally { f.cleanup(); }
});

test('Native recovery registry rejects unknown sessions and concurrent live-process resume', { timeout: 5000 }, async () => {
  const f = fixture(`
writeFileSync(args[args.indexOf('--session')+1],'{"type":"session","id":"live"}\\n');
writeFileSync('ready','yes');
setInterval(()=>{},1000);
`), controller = new AbortController();
  let reference: string | undefined;
  try {
    assert.equal(f.executor.canResume('unknown-session', f.root), false);
    const unknown = join(f.root, 'external-session.jsonl');
    writeFileSync(unknown, '{"type":"session","id":"unknown"}\n');
    const refused = await f.executor.execute({ ...f.request, phase: 'conclude', resume: unknown });
    assert.match(refused.error!, /process exit is unknown/);
    const pending = f.executor.execute({ ...f.request, onSession: value => { reference = value; } }, controller.signal);
    for (let step = 0; step < 100 && !existsSync(join(f.root, 'ready')); step++) await delay(10);
    assert.ok(existsSync(join(f.root, 'ready'))); assert.ok(reference);
    assert.equal(f.executor.canResume(reference, f.root), false);
    const live = await f.executor.execute({ ...f.request, phase: 'conclude', resume: reference });
    assert.match(live.error!, /still running/);
    controller.abort(); await pending;
    assert.equal(f.executor.canResume(reference, f.root), true);
    const registryFiles = readdirSync(join(f.root, 'logs', '.sessions'));
    assert.ok(registryFiles.some(name => /^[a-f0-9]{64}\.json$/.test(name)));
    const registry = JSON.parse(readFileSync(join(f.root, 'logs', '.sessions', registryFiles.find(name => name.endsWith('.json'))!), 'utf8'));
    assert.equal(registry.closed, true); assert.ok(registry.pid > 0); assert.equal(registry.processGroup, registry.pid);
  } finally { controller.abort(); f.cleanup(); }
});

test('Codex adapter discovers the native thread, filters reasoning and resumes it without bypassing host policy', async () => {
  const f = fixture(`
emit({type:'thread.started',thread_id:'00000000-0000-4000-8000-000000000001'});
emit({type:'item.completed',item:{type:'reasoning',text:'PRIVATE_REASONING_SENTINEL'}});
emit({type:'item.completed',item:{type:'command_execution',id:'cmd-1',command:'native-tool',aggregated_output:'TOOL_OUTPUT_SENTINEL',exit_code:0,status:'completed'}});
emit({type:'item.completed',item:{type:'agent_message',text:'{"findings":[]}'}});
emit({type:'turn.completed',usage:{input_tokens:200,cached_input_tokens:50,output_tokens:40}});
`, 'codex');
  try {
    const announced: string[] = [];
    const first = await f.executor.execute({ ...f.request, onSession: reference => announced.push(reference) });
    assert.equal(first.error, undefined);
    assert.equal(first.output, '{"findings":[]}');
    assert.equal(first.sessionRef, '00000000-0000-4000-8000-000000000001');
    assert.deepEqual(announced, [first.sessionRef]);
    assert.deepEqual(first.metrics!.usage, { input_tokens: 200, cached_input_tokens: 50, cache_write_input_tokens: 0, output_tokens: 40 });
    const audit = readFileSync(first.metrics!.auditPath as string, 'utf8');
    assert.ok(!audit.includes('PRIVATE_REASONING_SENTINEL'));
    assert.ok(!audit.includes('TOOL_OUTPUT_SENTINEL'));
    const resumed = await f.executor.execute({ ...f.request, phase: 'conclude', resume: first.sessionRef });
    const argv = JSON.parse(readFileSync(join(f.root, 'argv.json'), 'utf8')) as string[];
    assert.deepEqual(argv.slice(0, 3), ['exec', 'resume', first.sessionRef]);
    assert.ok(argv.includes('model_reasoning_effort="xhigh"'));
    assert.ok(!argv.some(value => value.includes('bypass') || value === '--sandbox' || value.includes('approval_policy')));
    assert.equal(resumed.error, undefined);
  } finally { f.cleanup(); }
});

test('native model failures remain failures even when the CLI exits zero', async () => {
  const f = fixture(`emit({type:'message_end',message:{role:'assistant',stopReason:'error',errorMessage:'503 provider unavailable',content:[]}});`);
  try {
    const result = await f.executor.execute(f.request);
    assert.match(result.error!, /503 provider unavailable/);
    assert.equal(result.metrics!.usageIsLowerBound, true);
    assert.equal(result.metrics!.usage, null);
  } finally { f.cleanup(); }
});

test('Pi preserves retry errors and cost uncertainty while accepting its successful final message', async () => {
  const f = fixture(`
emit({type:'message_end',message:{role:'assistant',stopReason:'error',errorMessage:'503 transient provider error',content:[],usage:{input:10,output:0}}});
emit({type:'message_end',message:{role:'assistant',stopReason:'stop',content:[{type:'text',text:'{"summary":"recovered"}'}],usage:{input:20,output:5}}});
`);
  try {
    const result = await f.executor.execute(f.request);
    assert.equal(result.error, undefined);
    assert.equal(result.output, '{"summary":"recovered"}');
    assert.deepEqual(result.metrics!.errors, ['503 transient provider error']);
    assert.equal(result.metrics!.usageIsLowerBound, true);
    assert.deepEqual(result.metrics!.usage, { input_tokens: 30, cached_input_tokens: 0, cache_write_input_tokens: 0, output_tokens: 5 });
  } finally { f.cleanup(); }
});

test('Codex accepts a recovered completed turn but preserves a later terminal failure', async () => {
  const f = fixture(`
emit({type:'error',message:'Reconnecting after transient service error'});
emit({type:'item.completed',item:{type:'agent_message',text:'{"summary":"recovered"}'}});
emit({type:'turn.completed',usage:{input_tokens:20,output_tokens:5}});
if(args.includes('fail-final'))emit({type:'turn.failed',error:{message:'503 final failure'}});
`, 'codex');
  try {
    const result = await f.executor.execute(f.request);
    assert.equal(result.error, undefined);
    assert.equal(result.metrics!.usageIsLowerBound, true);
    assert.deepEqual(result.metrics!.errors, ['Reconnecting after transient service error']);
    const finalFailure = await f.executor.execute({ ...f.request, prompt: 'fail-final' });
    assert.match(finalFailure.error!, /503 final failure/);
  } finally { f.cleanup(); }
});

test('launch failures and missing terminal messages are reported honestly', async () => {
  const f = fixture('');
  try {
    const empty = await f.executor.execute(f.request);
    assert.match(empty.error!, /did not return a completed assistant message/);
    const missing = new CliHostExecutor({ executor: 'codex', model: 'model', command: join(f.root, 'missing-binary'), logDir: join(f.root, 'logs') });
    const result = await missing.execute(f.request);
    assert.match(result.error!, /ENOENT/);
    assert.equal(result.metrics!.usageIsLowerBound, true);
  } finally { f.cleanup(); }
});

test('abort prevents launch and terminates an active native process group', { timeout: 8000 }, async () => {
  const f = fixture(`
const {spawn}=await import('node:child_process');
spawn(process.execPath,['-e',${JSON.stringify("setTimeout(()=>require('node:fs').writeFileSync('escaped-child','alive'),700)")}],{stdio:'ignore'});
writeFileSync('ready','yes');
setInterval(()=>{},1000);
`);
  try {
    const prior = new AbortController(); prior.abort();
    const before = await f.executor.execute(f.request, prior.signal);
    assert.equal(before.interrupted, true);
    assert.equal(existsSync(join(f.root, 'argv.json')), false);
    const controller = new AbortController(), pending = f.executor.execute(f.request, controller.signal);
    for (let step = 0; step < 100 && !existsSync(join(f.root, 'ready')); step++) await delay(10);
    assert.ok(existsSync(join(f.root, 'ready')));
    controller.abort();
    const result = await pending;
    assert.equal(result.interrupted, true);
    assert.match(result.error!, /interrupted/);
    await delay(800);
    assert.equal(existsSync(join(f.root, 'escaped-child')), false);
    assert.equal(readdirSync(join(f.root, 'logs')).filter(name => name !== '.sessions').length, 1);
  } finally { f.cleanup(); }
});

test('run CLI requires explicit takeover before changing ownership or launching the native host', () => {
  const f = fixture(''), database = join(f.root, 'state.db'), store = new Store(database);
  const owner = { host: 'mcp' as const, sessionId: 'submitted-owner', cwd: f.root };
  try {
    const task = new Engine(store).create(owner, { origin: 'CLI fixture', goal: 'Preserve owner unless explicitly authorized', criteria: ['Owner is preserved'], evidenceMode: 'curated' });
    const result = spawnSync(process.execPath, ['--import', 'tsx', join(process.cwd(), 'src/cli.ts'), 'run', task.id, '--root', f.root, '--db', database, '--executor', 'pi', '--model', 'global:model', '--executor-command', process.execPath, '--executor-arg', join(f.root, 'native.mjs')], { encoding: 'utf8', env: { ...process.env, CAIRN_HOST: 'mcp' } });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /takeover_required/);
    assert.equal(store.get(task.id).owner.sessionId, owner.sessionId);
    assert.equal(existsSync(join(f.root, 'argv.json')), false);
  } finally { store.close(); f.cleanup(); }
});

for(const host of ['pi','codex'] as const)test('run CLI defaults to one resumable '+host+' session across real child processes',()=>{
  const f=fixture(String.raw`
const {appendFileSync,readFileSync,existsSync}=await import('node:fs');
const calls=existsSync('calls.jsonl')?readFileSync('calls.jsonl','utf8').trim().split('\n').length:0;
appendFileSync('calls.jsonl',JSON.stringify(args)+'\n');
const answer=calls===0
  ?{decision:'continue',checkpoint:{findings:[{key:'seed',text:'Observed local source',status:'supported',basis:'Read source header',covers:[]}]}}
  :{decision:'complete',checkpoint:{findings:[{key:'answer',text:'Documented result',status:'supported',basis:'Checked source header',covers:['c1']}]}};
if(args.includes('--session')){
  appendFileSync(args[args.indexOf('--session')+1],JSON.stringify({type:'session',id:'fixture-session'})+'\n');
  emit({type:'message_end',message:{role:'assistant',stopReason:'stop',content:[{type:'text',text:JSON.stringify(answer)}],usage:{input:1,output:1}}});
}else{
  emit({type:'thread.started',thread_id:'fixture-thread'});
  emit({type:'item.completed',item:{type:'agent_message',text:JSON.stringify(answer)}});
  emit({type:'turn.completed',usage:{input_tokens:1,output_tokens:1}});
}
`,host);
  const database=join(f.root,'state.db'),store=new Store(database),owner={host:'mcp' as const,sessionId:'submitted-owner',cwd:f.root};
  try{
    const task=new Engine(store).create(owner,{origin:'Local source',goal:'Read a documented result',criteria:['A grounded result'],evidenceMode:'curated'});
    const result=spawnSync(process.execPath,['--import','tsx',join(process.cwd(),'src/cli.ts'),'run',task.id,'--root',f.root,'--db',database,'--executor',host,'--model','fixture-model','--takeover','--executor-command',process.execPath,'--executor-arg',join(f.root,'native.mjs')],{encoding:'utf8',env:{...process.env,CAIRN_HOST:'mcp'}});
    assert.equal(result.status,0,result.stderr);assert.equal(JSON.parse(result.stdout).status,'completed',result.stdout);
    const calls=readFileSync(join(f.root,'calls.jsonl'),'utf8').trim().split('\n').map(line=>JSON.parse(line) as string[]);
    assert.equal(calls.length,2);
    if(host==='pi')assert.equal(calls[0]![calls[0]!.indexOf('--session')+1],calls[1]![calls[1]!.indexOf('--session')+1]);
    else{assert.equal(calls[0]!.includes('resume'),false);assert.deepEqual(calls[1]!.slice(0,3),['exec','resume','fixture-thread']);}
    assert.equal(store.get(task.id).scheduler!.execution!.sessionMode,'single');
    assert.equal(store.events(task.id).filter(e=>e.kind==='scheduler.dispatched').length,2);
  }finally{store.close();f.cleanup();}
});

test('run CLI rejects contradictory session options before takeover or native execution',()=>{
  const f=fixture(''),database=join(f.root,'state.db'),store=new Store(database),owner={host:'mcp' as const,sessionId:'submitted-owner',cwd:f.root};
  try{
    const task=new Engine(store).create(owner,{origin:'Local source',goal:'Preserve owner on invalid policy',criteria:['Grounded result'],evidenceMode:'curated'});
    for(const flags of [['--session-mode','invalid'],['--parallel','2'],['--coordinator-mode','fresh-full'],['--session-mode','single','--parallel','2']]){
      const result=spawnSync(process.execPath,['--import','tsx',join(process.cwd(),'src/cli.ts'),'run',task.id,'--root',f.root,'--db',database,'--executor','pi','--model','fixture-model','--takeover',...flags,'--executor-command',process.execPath,'--executor-arg',join(f.root,'native.mjs')],{encoding:'utf8',env:{...process.env,CAIRN_HOST:'mcp'}});
      assert.equal(result.status,1);assert.match(result.stderr,/session.mode|Single-session/);
      assert.equal(store.get(task.id).owner.sessionId,owner.sessionId);assert.equal(store.get(task.id).scheduler,undefined);
      assert.equal(existsSync(join(f.root,'argv.json')),false);
    }
  }finally{store.close();f.cleanup();}
});

test('run CLI selects the initial mode and rejects invalid modes before takeover or native execution',()=>{
  const f=fixture(`emit({type:'message_end',message:{role:'assistant',stopReason:'stop',content:[{type:'text',text:JSON.stringify({decision:'complete',checkpoint:{findings:[{key:'answer',text:'Observed fixture result',status:'supported',basis:'Read the local fixture',covers:['c1']}]}})}],usage:{input:1,output:1}}});`);
  const database=join(f.root,'state.db'),store=new Store(database),engine=new Engine(store);
  const owner={host:'mcp' as const,sessionId:'submitted-owner',cwd:f.root};
  let sequence=0;
  const create=()=>engine.create({...owner,sessionId:`submitted-owner-${sequence++}`},{origin:'Local fixture',goal:'Select an initial phase',criteria:['A grounded result'],evidenceMode:'curated'});
  const run=(id:string,mode?:string)=>spawnSync(process.execPath,['--import','tsx',join(process.cwd(),'src/cli.ts'),'run',id,'--root',f.root,'--db',database,'--executor','pi','--model','global:model','--takeover',...(mode?['--start-mode',mode]:[]),'--executor-command',process.execPath,'--executor-arg',join(f.root,'native.mjs')],{encoding:'utf8',env:{...process.env,CAIRN_HOST:'mcp'}});
  try{
    const invalid=create(),prior=store.get(invalid.id),rejected=run(invalid.id,'unknown');
    assert.equal(rejected.status,1);assert.match(rejected.stderr,/--start-mode must be/);
    assert.deepEqual(store.get(invalid.id).owner,prior.owner);assert.equal(store.get(invalid.id).scheduler,undefined);
    assert.equal(existsSync(join(f.root,'argv.json')),false);
    for(const mode of [undefined,'auto','bootstrap-first','reason-first']){
      const task=create(),result=run(task.id,mode);
      assert.equal(result.status,0,result.stderr);assert.equal(JSON.parse(result.stdout).status,'completed');
      const args=JSON.parse(readFileSync(join(f.root,'argv.json'),'utf8')) as string[];
      assert.match(args.at(-1)!,new RegExp(`Execute one Cairn ${mode==='reason-first'?'reason':'bootstrap'} phase`));
      const start=store.get(task.id).scheduler!.start!;
      assert.equal(start.requested,mode??'auto');assert.equal(start.selected,mode==='reason-first'?'reason-first':'bootstrap-first');
    }
  }finally{store.close();f.cleanup();}
});

test('run CLI passes Pi provider separately and rejects it for Codex before ownership changes', () => {
  const f = fixture(`emit({type:'message_end',message:{role:'assistant',stopReason:'stop',content:[{type:'text',text:JSON.stringify({decision:'complete',checkpoint:{findings:[{key:'answer',text:'Observed fixture result',status:'supported',basis:'Read the fixture source',covers:['c1']}]}})}],usage:{input:1,output:1}}});`);
  const database = join(f.root, 'state.db'), store = new Store(database), owner = { host: 'mcp' as const, sessionId: 'submitted-owner', cwd: f.root };
  const env = { ...process.env, CAIRN_HOST: 'mcp' };
  try {
    const engine = new Engine(store);
    const first = engine.create(owner, { origin: 'CLI fixture', goal: 'Preserve opaque model IDs', criteria: ['A result is saved'], evidenceMode: 'curated' });
    const result = spawnSync(process.execPath, ['--import', 'tsx', join(process.cwd(), 'src/cli.ts'), 'run', first.id, '--root', f.root, '--db', database, '--executor', 'pi', '--model', 'provider-name:complete-model-id', '--provider', 'configured-provider', '--takeover', '--executor-command', process.execPath, '--executor-arg', join(f.root, 'native.mjs')], { encoding: 'utf8', env });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).status, 'completed');
    const argv = JSON.parse(readFileSync(join(f.root, 'argv.json'), 'utf8')) as string[];
    assert.equal(argv[argv.indexOf('--model') + 1], 'provider-name:complete-model-id');
    assert.equal(argv[argv.indexOf('--provider') + 1], 'configured-provider');
    const next = engine.create({ ...owner, sessionId: 'second-owner' }, { origin: 'CLI fixture', goal: 'Reject ambiguous provider configuration', criteria: ['Owner is preserved'], evidenceMode: 'curated' });
    const rejected = spawnSync(process.execPath, ['--import', 'tsx', join(process.cwd(), 'src/cli.ts'), 'run', next.id, '--root', f.root, '--db', database, '--executor', 'codex', '--model', 'model-id', '--provider', 'configured-provider', '--takeover'], { encoding: 'utf8', env });
    assert.equal(rejected.status, 1); assert.match(rejected.stderr, /--provider is only supported with --executor pi/);
    assert.equal(store.get(next.id).owner.sessionId, 'second-owner');
  } finally { store.close(); f.cleanup(); }
});
