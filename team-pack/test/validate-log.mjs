// Validate a real progress log after a practice match and print a short timeline.
//   node test/validate-log.mjs D:\mtm\FRA\team-sdlc-pack\logs\<MATCH>.progress.ndjson

import { readFileSync } from 'node:fs';
import { loadProgressSchema, validateProgressEvent } from '../src/schema.mjs';

const file = process.argv[2];
if (!file) { console.error('usage: node test/validate-log.mjs <progress.ndjson>'); process.exit(2); }
const schema = loadProgressSchema();
let bad = 0;
const lines = readFileSync(file, 'utf8').split('\n').filter((l) => l.trim());
for (const [i, line] of lines.entries()) {
  let e;
  try { e = JSON.parse(line); } catch { console.log(`#${i + 1} NOT JSON`); bad++; continue; }
  const errors = validateProgressEvent(schema, e);
  if (errors.length) { bad++; console.log(`#${i + 1} INVALID ${e.type}: ${errors.join('; ')}`); }
  const detail = e.type === 'GAME_MASTER_API' ? `${e.operation} ${e.phase} ${e.httpStatus ?? ''}`
    : e.type === 'BACKLOG_STATUS' ? `${e.backlogId} ${e.status}${e.receiptId ? ` receipt=${e.receiptId}` : ''}`
    : e.type === 'BACKLOG_TESTS' ? `${e.backlogId} ${e.status} ${e.passed}/${e.executed} (req ${e.required})`
    : e.stage ? `${e.stage} ${e.status}` : (e.status ?? '');
  console.log(`#${String(i + 1).padStart(3)} ${e.type.padEnd(22)} ${detail}  ${e.summary ?? ''}`);
}
console.log(`\n${lines.length} events, ${bad} invalid`);
process.exit(bad ? 1 : 0);
