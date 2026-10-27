#!/usr/bin/env node
// Read-only checker for an installed TeamWorkspace. Prints READY and exits 0, or lists problems and exits 1.
//   node scripts/check-distribution.mjs --team-workspace D:\mtm\FRA

import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PACK_NAME, REQUIRED_PROFILES, agentProfiles, expandCodexConfig, layoutCopies, listFiles,
  packRootFromScript, parseArgs, readPackMeta, safeWorkspace, serverPath, sha256File,
} from '../src/pack-layout.mjs';

const problems = [];
const check = (cond, msg) => { if (!cond) problems.push(msg); };

function sameBytes(a, b) {
  return existsSync(a) && existsSync(b) && readFileSync(a).equals(readFileSync(b));
}

function mcpHandshake(server) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [server], { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
    let buf = '';
    const replies = new Map();
    const timer = setTimeout(() => { child.kill(); resolve({ ok: false, error: 'timeout' }); }, 10_000);
    child.stdout.on('data', (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        try { const m = JSON.parse(line); replies.set(m.id, m); } catch { replies.set('bad', line); }
      }
      if (replies.has(2)) {
        clearTimeout(timer); child.kill();
        resolve({ ok: !replies.has('bad'), init: replies.get(1), list: replies.get(2) });
      }
    });
    const send = (m) => child.stdin.write(JSON.stringify(m) + '\n');
    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'check-distribution', version: '1' } } });
    send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  });
}

async function main() {
  const root = packRootFromScript(fileURLToPath(import.meta.url));
  const tw = safeWorkspace(parseArgs(process.argv.slice(2)).teamWorkspace);
  const runtimeDir = join(tw, PACK_NAME, 'runtime');

  const { pkg, info, errors } = readPackMeta(root);
  problems.push(...errors.map((e) => `source: ${e}`));
  check(existsSync(runtimeDir), 'runtime payload not installed');
  if (!existsSync(runtimeDir)) return;
  const installed = readPackMeta(runtimeDir);
  problems.push(...installed.errors.map((e) => `runtime: ${e}`));
  check(installed.pkg.version === pkg.version, `installed version ${installed.pkg.version} != source ${pkg.version}`);

  // Identity copies must match each other and the source.
  for (const f of ['team-pack-info.json', 'team-runtime.json']) {
    check(sameBytes(join(root, f), join(tw, '.mtm', f)), `.mtm/${f} differs from pack`);
    check(sameBytes(join(root, f), join(runtimeDir, f)), `runtime/${f} differs from pack`);
  }

  // Profiles: required names, filename/name convention, registration parity.
  const profiles = agentProfiles(root);
  for (const req of REQUIRED_PROFILES) check(profiles.some((p) => p.name === req), `missing profile ${req}`);
  for (const p of profiles) check(p.file === `${p.name.replace(/_/g, '-')}.toml`, `profile ${p.file} name ${p.name} does not match filename`);

  const { runtimeEntries, profiles: profCopies, skills, mtm } = layoutCopies(root, pkg);
  for (const [src, dest] of [...profCopies, ...skills, ...mtm, ...runtimeEntries]) {
    const s = join(root, src), d = join(tw, dest);
    if (!existsSync(d)) { problems.push(`missing installed ${dest}`); continue; }
    const sFiles = existsSync(s) ? listFilesSafe(s) : [];
    for (const f of sFiles) {
      const rel = relative(s, f);
      check(sameBytes(f, rel ? join(d, rel) : d), `installed ${dest}${rel ? '/' + rel : ''} differs from pack`);
    }
  }

  // Exact MCP registration expansion.
  const expected = expandCodexConfig(readFileSync(join(root, 'config', 'codex.toml'), 'utf8'), tw);
  const actualPath = join(tw, '.codex', 'config.toml');
  check(existsSync(actualPath) && readFileSync(actualPath, 'utf8') === expected, '.codex/config.toml is not the exact expansion of config/codex.toml');

  // Install receipt hashes.
  const receiptPath = join(runtimeDir, '.install-receipt.json');
  if (existsSync(receiptPath)) {
    const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
    check(receipt.teamId === info.teamId && receipt.version === pkg.version, 'install receipt identity mismatch');
    for (const [rel, hash] of Object.entries(receipt.files)) {
      const p = join(runtimeDir, rel);
      check(existsSync(p) && sha256File(p) === hash, `runtime file changed after install: ${rel}`);
    }
  } else problems.push('install receipt missing');

  // Progress schema loads and MCP helper answers initialize + tools/list.
  try { JSON.parse(readFileSync(join(runtimeDir, 'contracts', 'progress-event.schema.json'), 'utf8')); } catch { problems.push('progress schema unreadable'); }
  const hs = await mcpHandshake(serverPath(tw));
  check(hs.ok && hs.init?.result?.serverInfo, `MCP initialize failed (${hs.error ?? 'no result'})`);
  const tools = hs.list?.result?.tools ?? [];
  for (const t of ['configure_session', 'login_match', 'refresh_match', 'start_work', 'submit_work', 'report_progress', 'wait_for_update', 'plan_next', 'report_verification', 'update_item', 'scan_repo']) {
    const tool = tools.find((x) => x.name === t);
    check(tool && tool.inputSchema?.type === 'object', `MCP tool ${t} missing or without inputSchema`);
  }
}

// A directory lists its files; a single file lists itself.
function listFilesSafe(p) {
  try { return listFiles(p); } catch { return [p]; }
}

main().then(() => {
  if (problems.length) {
    console.log(`NOT_READY\n - ${problems.join('\n - ')}`);
    process.exit(1);
  }
  console.log('READY');
}).catch((err) => {
  console.log(`NOT_READY\n - ${err.message}`);
  process.exit(1);
});
