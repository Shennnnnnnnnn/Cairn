import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Task } from './types.js';

/** Existence is a diagnostic, never a claim that a file supports a conclusion. */
export function localReferenceIssue(reference: string, task: Task): string | undefined {
  let path = reference.replace(/(?::\d+){1,2}$/, '').replace(/#L\d+(?:-L\d+)?$/, '');
  if (/^[a-z][a-z\d+.-]*:/i.test(path) && !/^file:/i.test(path)) return;
  try { if (/^file:/i.test(path)) path = fileURLToPath(path); }
  catch { return `Invalid local file reference: ${reference}`; }
  return existsSync(resolve(task.owner.cwd, path)) ? undefined : `Local reference does not exist in ${task.owner.cwd}: ${reference}`;
}
