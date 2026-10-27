#!/usr/bin/env node
// Installs the team pack into <TeamWorkspace>. Idempotent; replaces only pack-owned files and
// never touches matches/ or team-sdlc-pack/logs/.
//   node scripts/install.mjs --team-workspace D:\mtm\FRA

import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PACK_NAME, REQUIRED_PROFILES, agentProfiles, expandCodexConfig, layoutCopies, listFiles,
  packRootFromScript, parseArgs, readPackMeta, safeWorkspace, sha256File,
} from '../src/pack-layout.mjs';

function main() {
  const root = packRootFromScript(fileURLToPath(import.meta.url));
  const { teamWorkspace } = parseArgs(process.argv.slice(2));
  const tw = safeWorkspace(teamWorkspace);

  const { pkg, info, errors } = readPackMeta(root);
  const names = agentProfiles(root).map((p) => p.name);
  for (const req of REQUIRED_PROFILES) if (!names.includes(req)) errors.push(`missing agent profile ${req}`);
  if (errors.length) throw new Error(`Pack invalid:\n - ${errors.join('\n - ')}`);

  for (const d of ['matches', join(PACK_NAME, 'runtime'), join(PACK_NAME, 'logs'), '.mtm', join('.codex', 'agents'), join('.agents', 'skills')]) {
    mkdirSync(join(tw, d), { recursive: true });
  }

  const { runtimeEntries, profiles, skills, mtm } = layoutCopies(root, pkg);
  const copy = (src, dest) => {
    const from = join(root, src);
    const to = join(tw, dest);
    if (lstatSync(from).isSymbolicLink()) throw new Error(`Symlink not allowed in pack: ${src}`);
    if (statSync(from).isDirectory()) listFiles(from); // throws on nested links
    if (existsSync(to)) rmSync(to, { recursive: true, force: true });
    mkdirSync(dirname(to), { recursive: true });
    cpSync(from, to, { recursive: true, dereference: false });
  };
  for (const [src, dest] of [...runtimeEntries, ...profiles, ...skills, ...mtm]) copy(src, dest);

  const config = expandCodexConfig(readFileSync(join(root, 'config', 'codex.toml'), 'utf8'), tw);
  writeFileSync(join(tw, '.codex', 'config.toml'), config, 'utf8');

  const runtimeDir = join(tw, PACK_NAME, 'runtime');
  const files = {};
  for (const f of listFiles(runtimeDir)) {
    const rel = relative(runtimeDir, f).replace(/\\/g, '/');
    if (rel === '.install-receipt.json') continue;
    files[rel] = sha256File(f);
  }
  writeFileSync(join(runtimeDir, '.install-receipt.json'), JSON.stringify({ version: pkg.version, teamId: info.teamId, files }, null, 2) + '\n');

  console.log(`Installed ${PACK_NAME} ${pkg.version} for ${info.teamId} (${info.teamName}) into ${tw}`);
  console.log(`Next: node "${join(root, 'scripts', 'check-distribution.mjs')}" --team-workspace "${tw}"`);
}

try {
  main();
} catch (err) {
  console.error(`TEAM_PACK_INSTALL_FAILED: ${err.message}`);
  process.exit(1);
}
