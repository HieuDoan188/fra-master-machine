// Append-only NDJSON progress writer. One schema-valid JSON object per line, UTF-8,
// never overwriting. Failed appends are queued (bounded) and retried in order.

import { appendFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { loadProgressSchema, validateProgressEvent } from './schema.mjs';

const MAX_QUEUE = 500;

export class ProgressLog {
  constructor() {
    this.schema = loadProgressSchema();
    this.file = null;
    this.playerSessionId = null;
    this.queue = [];
    this.unavailable = false;
  }

  bind(file, playerSessionId) {
    this.file = file;
    this.playerSessionId = playerSessionId;
    mkdirSync(dirname(file), { recursive: true });
  }

  // Events already in the file (for resume reconciliation). Invalid lines are skipped.
  readExisting() {
    if (!this.file || !existsSync(this.file)) return [];
    const out = [];
    for (const line of readFileSync(this.file, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try { out.push(JSON.parse(line)); } catch { /* foreign/partial line */ }
    }
    return out;
  }

  // body = event without envelope. Returns { ok, errors?, queued? }.
  append(body) {
    if (!this.file || !this.playerSessionId) return { ok: false, errors: ['progress log not configured'] };
    const event = { schemaVersion: 1, playerSessionId: this.playerSessionId, ...body };
    const errors = validateProgressEvent(this.schema, event);
    if (errors.length) return { ok: false, errors };
    this.queue.push(JSON.stringify(event) + '\n');
    if (this.queue.length > MAX_QUEUE) this.queue.shift();
    return this.flush();
  }

  flush() {
    while (this.queue.length) {
      try {
        appendFileSync(this.file, this.queue[0], { encoding: 'utf8' });
        this.queue.shift();
        this.unavailable = false;
      } catch (err) {
        this.unavailable = true;
        return { ok: false, queued: this.queue.length, errors: [`PROGRESS_LOG_UNAVAILABLE: ${err.code ?? 'append failed'}`] };
      }
    }
    return { ok: true };
  }
}
