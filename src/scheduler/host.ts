import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { appendFileSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { CairnError } from '../core/types.js';
import type { HostExecutor, HostRequest, HostResult } from '../scheduler.js';
import { NativeSessionRegistry, type NativeSessionLease } from './host-registry.js';

export interface CliHostOptions {
  executor: 'pi' | 'codex';
  /** Opaque native model selector; never split provider or thinking from its ID. */
  model: string;
  /** Optional Pi provider; forwarded separately without rewriting model. */
  provider?: string;
  effort?: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  /** Trusted executable and argv prefix; no shell is used. */
  command?: string;
  commandArgs?: string[];
  env?: NodeJS.ProcessEnv;
  logDir?: string;
}

const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
const errorText = (value: unknown) => typeof value === 'string' ? value : value && typeof value === 'object' && 'message' in value ? String(value.message) : 'Native host failed';

/** A small native CLI adapter. The host retains credentials, tools and its permission policy. */
export class CliHostExecutor implements HostExecutor {
  constructor(readonly options: CliHostOptions) {
    if (!['pi', 'codex'].includes(options.executor)) throw new CairnError('invalid_input', 'Executor must be pi or codex');
    if (!options.model?.trim()) throw new CairnError('invalid_input', 'A native host model is required');
    if (options.provider !== undefined && options.executor !== 'pi') throw new CairnError('invalid_input', 'An explicit provider is only supported for the Pi executor');
    if (options.provider !== undefined && !options.provider.trim()) throw new CairnError('invalid_input', 'Pi provider must not be empty');
    if (options.command !== undefined && !options.command.trim()) throw new CairnError('invalid_input', 'Host executable must not be empty');
    if (options.commandArgs?.some(arg => typeof arg !== 'string')) throw new CairnError('invalid_input', 'Host executable arguments must be strings');
    if (options.effort && !['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].includes(options.effort)) throw new CairnError('invalid_input', 'Invalid host reasoning effort');
  }

  canResume(sessionRef: string, cwd: string): boolean {
    return new NativeSessionRegistry(this.options.logDir ?? join(cwd, '.cairn', 'scheduler'), this.options.executor).canResume(sessionRef, cwd);
  }

  async execute(request: HostRequest, signal?: AbortSignal): Promise<HostResult> {
    if (signal?.aborted) return { output: '', interrupted: true, error: 'Host execution aborted before launch' };
    if (request.repair && !request.resume) return { output: '', error: 'Phase repair requires the original native session; refusing a replacement session' };
    if (request.phase === 'conclude' && !request.resume) return { output: '', error: 'Conclude requires the original native session; a new session cannot recover its unsaved context' };
    if (this.options.executor === 'pi' && request.resume) {
      try { if (!statSync(resolve(request.cwd, request.resume)).isFile()) throw new Error('Not a regular file'); }
      catch { return { output: '', sessionRef: request.resume, error: 'Original Pi session file is unavailable; refusing to create a replacement session' }; }
    }
    const options = this.options, startedAt = new Date().toISOString(), begin = performance.now();
    const root = resolve(options.logDir ?? join(request.cwd, '.cairn', 'scheduler'));
    const registry = new NativeSessionRegistry(root, options.executor);
    let nativePid: number | undefined, nativeLease: NativeSessionLease | undefined;
    // Model/task values never become path segments. Each invocation has an independent private log.
    const directory = join(root, randomUUID());
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const auditPath = join(directory, 'events.jsonl'), promptPath = join(directory, 'prompt.txt'), metricsPath = join(directory, 'metrics.json');
    const record = (event: unknown) => appendFileSync(auditPath, JSON.stringify(event) + '\n', { mode: 0o600 });
    writeFileSync(promptPath, request.prompt, { mode: 0o600 });
    let sessionRef = request.resume, output = '', lastStop: string | undefined, adapterFailure = false;
    let terminalState: 'completed' | 'failed' | undefined;
    const models = new Set<string>(), providers = new Set<string>(), efforts = new Set<string>();
    const usage = { input_tokens: 0, cached_input_tokens: 0, cache_write_input_tokens: 0, output_tokens: 0 };
    const repairActions = new Set<string>();
    let usageEvents = 0, missingUsage = false, assistantTurns = 0, completedTurns = 0, toolCalls = 0, stderr = '', stderrBytes = 0;
    const errors: string[] = [];
    const announce = (reference: string) => {
      if (request.resume && reference !== request.resume) throw new CairnError('native_session_mismatch', 'Native host returned a different session while restoring the original');
      if (!nativeLease) {
        nativeLease = registry.claim(reference, request.cwd, !!request.resume);
        if (nativePid) nativeLease.started(nativePid);
      } else if (reference !== sessionRef) throw new CairnError('native_session_mismatch', 'Native host changed sessions during one execution');
      sessionRef = reference;
      request.onSession?.(reference);
    };
    const args = [...options.commandArgs ?? []];
    try {
    if (options.executor === 'pi') {
      // Pi's --no-tools changes defaults; an explicit prefix --tools can
      // re-enable them. The final deny-all matcher also fences that prefix.
      args.push('--mode', 'json', '-p', '--exclude-tools', request.repair ? '*' : 'cairn_*');
      if (request.repair) args.push('--no-tools');
      if (options.provider !== undefined) args.push('--provider', options.provider);
      args.push('--model', options.model);
      if (options.effort) args.push('--thinking', options.effort);
      // Pi's explicit --session path also works for a new file, and remains resumable after interruption.
      const sessionPath = request.resume ?? join(directory, 'native-session.jsonl');
      args.push('--session', sessionPath, '--', request.prompt);
      announce(sessionPath);
    } else {
      if (request.resume) announce(request.resume);
      args.push('exec');
      if (request.resume) args.push('resume', request.resume);
      args.push('--json', '--model', options.model);
      if (options.effort) args.push('-c', `model_reasoning_effort=${JSON.stringify(options.effort)}`);
      args.push('--', request.prompt);
    }
    } catch (error) {
      nativeLease?.settled();
      const reason = errorText(error);
      record({ type: 'host.refused', requestId: request.id, phase: request.phase, error: reason });
      return { output: '', sessionRef, error: reason };
    }
    record({ type: 'host.started', requestId: request.id, taskId: request.taskId, phase: request.phase, host: options.executor, requestedModel: options.model, requestedProvider: options.provider, requestedEffort: options.effort, startedAt, resumed: !!request.resume, sessionRef, repair: request.repair, contextMode: request.contextMode, sessionMode: request.sessionMode });
    const consume = (line: string) => {
      let event: any;
      try { event = JSON.parse(line); } catch { record({ type: 'host.unparsed', bytes: Buffer.byteLength(line) }); return; }
      if (options.executor === 'pi') {
        if (event.type === 'session') record({ type: 'session', id: event.id, cwd: event.cwd });
        if (event.type === 'thinking_level_change' && typeof event.thinkingLevel === 'string') efforts.add(event.thinkingLevel);
        if (event.type === 'message_end' && event.message?.role === 'assistant') {
          const message = event.message;
          assistantTurns++;
          if (typeof message.model === 'string') models.add(message.model);
          if (typeof message.provider === 'string') providers.add(message.provider);
          if (typeof message.thinkingLevel === 'string') efforts.add(message.thinkingLevel);
          if (message.usage) {
            usageEvents++;
            usage.input_tokens += number(message.usage.input) + number(message.usage.cacheRead) + number(message.usage.cacheWrite);
            usage.cached_input_tokens += number(message.usage.cacheRead);
            usage.cache_write_input_tokens += number(message.usage.cacheWrite);
            usage.output_tokens += number(message.usage.output);
          } else missingUsage = true;
          lastStop = message.stopReason;
          terminalState = lastStop === 'stop' ? 'completed' : lastStop === 'error' || lastStop === 'aborted' ? 'failed' : undefined;
          const text = (Array.isArray(message.content) ? message.content : []).filter((part: any) => part.type === 'text' && typeof part.text === 'string').map((part: any) => part.text).join('\n');
          if (lastStop === 'stop' || lastStop === 'error' || lastStop === 'aborted') output = text;
          if (lastStop === 'error' || lastStop === 'aborted') errors.push(message.errorMessage ? errorText(message.errorMessage) : `Pi stopped: ${lastStop}`);
          record({ type: 'assistant.completed', text, provider: message.provider, model: message.model, thinkingLevel: message.thinkingLevel, usage: message.usage, stopReason: lastStop });
        }
        if (event.type === 'tool_execution_start') { toolCalls++; record({ type: 'tool.started', id: event.toolCallId, name: event.toolName }); }
        if (event.type === 'tool_execution_end') record({ type: 'tool.completed', id: event.toolCallId, isError: !!event.isError });
        if (event.type === 'error') { terminalState = 'failed'; errors.push(errorText(event.error ?? event.message)); }
      } else {
        if (event.type === 'thread.started' && typeof event.thread_id === 'string') { announce(event.thread_id); record({ type: event.type, thread_id: event.thread_id }); }
        if (event.type === 'turn.completed') {
          terminalState = 'completed';
          completedTurns++;
          if (event.usage) {
            usageEvents++;
            for (const key of ['input_tokens', 'cached_input_tokens', 'output_tokens'] as const) usage[key] += number(event.usage[key]);
          } else missingUsage = true;
          record({ type: event.type, usage: event.usage });
        }
        if (event.type === 'turn.failed' || event.type === 'error') { terminalState = 'failed'; errors.push(errorText(event.error ?? event.message)); record({ type: event.type, error: errors.at(-1) }); }
        const item = event.item;
        if (request.repair && item && ['item.started', 'item.updated', 'item.completed'].includes(event.type) && !['reasoning', 'agent_message', 'error'].includes(item.type)) {
          // This is post-execution auditing, not a Codex tool prohibition. A
          // started action matters even if no completion arrives. Anonymous
          // lifecycle events cannot be safely correlated and count separately.
          const identity = typeof item.id === 'string' && item.id || typeof item.id === 'number' && Number.isFinite(item.id) ? `${typeof item.id}:${item.id}` : undefined;
          if (identity === undefined || !repairActions.has(identity)) { toolCalls++; if (identity !== undefined) repairActions.add(identity); }
          record({ type: `tool.${event.type.slice('item.'.length)}`, id: item.id, toolType: item.type, name: item.tool, status: item.status, exitCode: item.exit_code });
        }
        if (event.type === 'item.completed' && item) {
          if (item.type === 'agent_message') { assistantTurns++; output = typeof item.text === 'string' ? item.text : ''; record({ type: 'assistant.completed', text: output }); }
          else if (!request.repair && ['command_execution', 'mcp_tool_call', 'web_search'].includes(item.type)) { toolCalls++; record({ type: 'tool.completed', id: item.id, toolType: item.type, name: item.tool, status: item.status, exitCode: item.exit_code }); }
          // Private reasoning items are deliberately not copied into Cairn's audit or result.
        }
      }
    };
    let spawnError: string | undefined, abortTimer: ReturnType<typeof setTimeout> | undefined, buffer = '';
    const grouped = process.platform !== 'win32';
    const launch = () => spawn(options.command ?? options.executor, args, { cwd: request.cwd, env: options.env ?? process.env, stdio: ['ignore', 'pipe', 'pipe'], shell: false, detached: grouped });
    let child: ReturnType<typeof launch>;
    try { child = launch(); }
    catch (error) { nativeLease?.settled(); return { output: '', sessionRef, error: errorText(error) }; }
    nativePid = child.pid;
    const terminate = (name: NodeJS.Signals) => {
      try { if (grouped && child.pid) process.kill(-child.pid, name); else child.kill(name); } catch { try { child.kill(name); } catch {} }
    };
    let aborting = false;
    const aborted = () => {
      if (aborting) return;
      aborting = true;
      terminate('SIGTERM');
      abortTimer = setTimeout(() => terminate('SIGKILL'), 2000);
      abortTimer.unref();
    };
    const consumeSafely = (line: string) => {
      try { consume(line); }
      catch (error) { adapterFailure = true; errors.push(`Host event handling failed: ${errorText(error)}`); terminate('SIGTERM'); }
    };
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      buffer += chunk;
      let newline: number;
      while ((newline = buffer.indexOf('\n')) !== -1) { const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1); consumeSafely(line); }
    });
    // Retain a bounded terminal diagnostic, never echo or archive unfiltered host output.
    child.stderr.on('data', (chunk: string) => { stderrBytes += Buffer.byteLength(chunk); stderr = (stderr + chunk).slice(-4000); });
    child.once('error', error => { spawnError = error.message; });
    signal?.addEventListener('abort', aborted, { once: true });
    if (signal?.aborted) aborted();
    try { nativeLease?.started(nativePid); }
    catch (error) { adapterFailure = true; errors.push(`Native session registry failed: ${errorText(error)}`); terminate('SIGTERM'); }
    let ended: { exitCode: number | null; exitSignal: NodeJS.Signals | null };
    try { ended = await new Promise(resolveClose => child.once('close', (exitCode, exitSignal) => resolveClose({ exitCode, exitSignal }))); }
    finally { signal?.removeEventListener('abort', aborted); clearTimeout(abortTimer); }
    if (buffer.trim()) consumeSafely(buffer);
    try { nativeLease?.settled(); }
    catch (error) { adapterFailure = true; errors.push(`Native session registry failed: ${errorText(error)}`); }
    if (spawnError) errors.push(spawnError);
    if (ended.exitCode !== 0 && !signal?.aborted) errors.push(`Native ${options.executor} exited ${ended.exitCode ?? ended.exitSignal}${stderr.trim() ? `: ${stderr.trim()}` : ''}`);
    const missingTerminal = options.executor === 'pi' ? lastStop !== 'stop' : !completedTurns || !assistantTurns;
    if (missingTerminal && terminalState !== 'failed' && !signal?.aborted) errors.push(options.executor === 'pi' ? 'Pi did not return a completed assistant message' : 'Codex did not return a completed turn and assistant message');
    const failed = adapterFailure || !!spawnError || ended.exitCode !== 0 || terminalState !== 'completed' || missingTerminal;
    const metrics = { host: options.executor, requestedModel: options.model, requestedProvider: options.provider, requestedEffort: options.effort, actualModels: [...models], actualProviders: [...providers], actualEfforts: [...efforts], startedAt, finishedAt: new Date().toISOString(), wallSeconds: (performance.now() - begin) / 1000, ...ended, sessionRef, usage: usageEvents ? usage : null, usageIsLowerBound: failed || !!signal?.aborted || missingUsage || usageEvents === 0 || errors.length > 0, assistantTurns, toolCalls, stderrBytes, errors, auditPath, promptPath, metricsPath, contextMode: request.contextMode, repairToolPolicy: request.repair ? options.executor === 'pi' ? 'disabled' : 'audited' : undefined };
    record({ type: 'host.finished', ...metrics });
    writeFileSync(metricsPath, JSON.stringify(metrics, null, 2) + '\n', { mode: 0o600 });
    return { output, sessionRef, interrupted: !!signal?.aborted, error: signal?.aborted ? 'Host execution interrupted' : failed ? errors.join('\n') : undefined, metrics };
  }
}

export const createHostExecutor = (options: CliHostOptions): HostExecutor => new CliHostExecutor(options);
