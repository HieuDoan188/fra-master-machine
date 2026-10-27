// Shared by scripts/install.mjs and scripts/check-distribution.mjs: pack identity rules,
// installed layout, and the exact MCP registration expansion mtm-player compares byte-for-byte.

import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, parse, resolve } from 'node:path';

export const PACK_NAME = 'team-sdlc-pack';
export const REQUIRED_PROFILES = ['team_orchestrator', 'team_repo_scout', 'team_feature_worker', 'team_quality_checker'];
export const RELATIVE_SERVER_ARG = '../team-sdlc-pack/runtime/bin/runtime-server.mjs';
const VERSION_RE = /^\d+\.\d+\.\d+$/;
const TEAM_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));

export function sha256File(p) {
  return createHash('sha256').update(readFileSync(p)).digest('hex');
}

export function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--team-workspace') out.teamWorkspace = argv[++i];
  }
  return out;
}

// Absolute, normalized, and free of symlinks/junctions along every existing component.
export function safeWorkspace(input) {
  if (!input || !isAbsolute(input)) throw new Error('TeamWorkspace must be an absolute path');
  const tw = resolve(input);
  let cur = parse(tw).root;
  for (const part of tw.slice(cur.length).split(/[\\/]/).filter(Boolean)) {
    cur = join(cur, part);
    if (!existsSync(cur)) break;
    const st = lstatSync(cur);
    if (st.isSymbolicLink()) throw new Error(`Refusing link/junction in TeamWorkspace path: ${cur}`);
    if (!st.isDirectory()) throw new Error(`Not a directory: ${cur}`);
  }
  if (existsSync(tw)) {
    const real = realpathSync.native(tw);
    const same = process.platform === 'win32' ? real.toLowerCase() === tw.toLowerCase() : real === tw;
    if (!same) throw new Error(`TeamWorkspace resolves elsewhere (${real})`);
  }
  return tw;
}

export function readPackMeta(root) {
  const pkg = readJson(join(root, 'package.json'));
  const runtime = readJson(join(root, 'team-runtime.json'));
  const info = readJson(join(root, 'team-pack-info.json'));
  const errors = [];
  if (pkg.name !== PACK_NAME) errors.push(`package.json name must be ${PACK_NAME}`);
  if (!VERSION_RE.test(pkg.version ?? '')) errors.push('package.json version must be X.Y.Z');
  if (!Array.isArray(pkg.files) || !pkg.files.length) errors.push('package.json files missing');

  const rtKeys = Object.keys(runtime).sort().join(',');
  if (rtKeys !== 'entrypoint,kind,name,protocolVersion,provider,schemaVersion,version') errors.push(`team-runtime.json fields must be exact, got ${rtKeys}`);
  if (Object.keys(runtime.entrypoint ?? {}).join(',') !== 'rootAgentType') errors.push('entrypoint must only contain rootAgentType');
  if (runtime.schemaVersion !== 1 || runtime.kind !== 'mtm-team-runtime' || runtime.name !== PACK_NAME) errors.push('team-runtime.json identity invalid');
  if (runtime.provider !== 'codex') errors.push('provider must be codex');
  if (runtime.entrypoint?.rootAgentType !== 'team_orchestrator') errors.push('rootAgentType must be team_orchestrator');

  if (Object.keys(info).sort().join(',') !== 'schemaVersion,teamId,teamName,version') errors.push('team-pack-info.json must have exactly schemaVersion, version, teamId, teamName');
  if (info.schemaVersion !== 1) errors.push('team-pack-info schemaVersion must be 1');
  if (!TEAM_ID_RE.test(info.teamId ?? '')) errors.push('teamId invalid');
  if (typeof info.teamName !== 'string' || !info.teamName || info.teamName !== info.teamName.trim() || info.teamName.length > 160 || /[\r\n\u0000]/.test(info.teamName)) errors.push('teamName invalid');
  if (['T01', 'HNKSUPER'].includes(info.teamId)) errors.push('teamId is still the guide example');
  if (pkg.version !== runtime.version || pkg.version !== info.version) errors.push('version must match across package.json, team-runtime.json, team-pack-info.json');

  for (const entry of pkg.files ?? []) if (!existsSync(join(root, entry))) errors.push(`declared file missing: ${entry}`);
  return { pkg, runtime, info, errors };
}

export function agentProfiles(root) {
  const dir = join(root, 'agents');
  return readdirSync(dir).filter((f) => f.endsWith('.toml')).map((file) => {
    const text = readFileSync(join(dir, file), 'utf8');
    const name = /^name\s*=\s*"([^"]+)"/m.exec(text)?.[1] ?? null;
    return { file, name };
  });
}

export function skillNames(root) {
  const dir = join(root, 'skills');
  return readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory() && existsSync(join(dir, d.name, 'SKILL.md'))).map((d) => d.name);
}

export function serverPath(tw) {
  return join(tw, PACK_NAME, 'runtime', 'bin', 'runtime-server.mjs').replace(/\\/g, '/');
}

export function expandCodexConfig(templateText, tw) {
  const needle = JSON.stringify(RELATIVE_SERVER_ARG);
  if (!templateText.includes(needle)) throw new Error('config/codex.toml does not contain the relative runtime-server arg');
  // Relative arg is anchored at <TeamWorkspace>/.codex; expansion is absolute, forward slashes, JSON-quoted.
  const expected = resolve(join(tw, '.codex'), RELATIVE_SERVER_ARG).replace(/\\/g, '/');
  if (expected !== serverPath(tw)) throw new Error('unexpected runtime layout');
  return templateText.split(needle).join(JSON.stringify(expected));
}

// [source relative to pack root, destination relative to TeamWorkspace]
export function layoutCopies(root, pkg) {
  const runtimeEntries = ['package.json', ...pkg.files].map((e) => [e, join(PACK_NAME, 'runtime', e)]);
  const profiles = agentProfiles(root).map(({ file }) => [join('agents', file), join('.codex', 'agents', file)]);
  const skills = skillNames(root).map((s) => [join('skills', s), join('.agents', 'skills', s)]);
  const mtm = ['team-runtime.json', 'team-pack-info.json'].map((f) => [f, join('.mtm', f)]);
  return { runtimeEntries, profiles, skills, mtm };
}

export function listFiles(dir, base = dir) {
  const out = [];
  for (const d of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, d.name);
    if (d.isSymbolicLink()) throw new Error(`Symlink not allowed in pack: ${p}`);
    if (d.isDirectory()) out.push(...listFiles(p, base));
    else out.push(p);
  }
  return out;
}

export const packRootFromScript = (scriptUrlPath) => resolve(dirname(scriptUrlPath), '..');
