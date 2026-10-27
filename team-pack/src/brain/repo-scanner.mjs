// Repository intelligence, ported from legacy knowledge/scanner.py + memory/repository_memory/store.py.
// "Understand the target repo in 30 seconds": stack, build/test commands, folders, entry points,
// import graph, and an impact query (which files are affected when X changes).

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative, dirname, resolve } from 'node:path';

const SKIP_DIRS = new Set(['.git', 'node_modules', '__pycache__', '.venv', 'venv', 'dist', 'build', '.next', 'vendor', 'target', 'coverage', '.turbo']);
const CODE_EXT = new Set(['.py', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.go', '.java', '.prisma']);
const MAX_FILES = 20_000;
const MAX_FILE_BYTES = 512 * 1024;

const FRAMEWORK_HINTS = {
  next: 'Next.js', react: 'React', vue: 'Vue', express: 'Express', '@trpc/server': 'tRPC', '@prisma/client': 'Prisma',
  'next-auth': 'NextAuth', fastapi: 'FastAPI', flask: 'Flask', django: 'Django', spring: 'Spring Boot', gin: 'Gin',
};

const STACK_MARKERS = [
  ['package.json', 'javascript/typescript'], ['pyproject.toml', 'python'], ['requirements.txt', 'python'],
  ['setup.py', 'python'], ['go.mod', 'go'], ['pom.xml', 'java'], ['build.gradle', 'java'], ['Cargo.toml', 'rust'],
];

function readJson(p) {
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; }
}

// Find the project roots (folders with a manifest) at most two levels below root.
function projectRoots(root) {
  const out = [];
  const visit = (dir, depth) => {
    if (STACK_MARKERS.some(([m]) => existsSync(join(dir, m)))) out.push(dir);
    if (depth >= 2) return;
    for (const d of readdirSync(dir, { withFileTypes: true })) {
      if (d.isDirectory() && !SKIP_DIRS.has(d.name) && !d.name.startsWith('.')) visit(join(dir, d.name), depth + 1);
    }
  };
  visit(root, 0);
  return out;
}

function describeProject(dir, root) {
  const rel = relative(root, dir).replace(/\\/g, '/') || '.';
  const lang = STACK_MARKERS.find(([m]) => existsSync(join(dir, m)))?.[1] ?? 'unknown';
  const info = { path: rel, language: lang, frameworks: [], buildSystem: 'unknown', testSystem: 'unknown', scripts: {}, testCommand: null, entryPoints: [] };
  const pkg = readJson(join(dir, 'package.json'));
  if (pkg) {
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    info.frameworks = Object.entries(FRAMEWORK_HINTS).filter(([d]) => d in deps).map(([, n]) => n);
    info.buildSystem = existsSync(join(dir, 'pnpm-lock.yaml')) ? 'pnpm' : existsSync(join(dir, 'yarn.lock')) ? 'yarn' : 'npm';
    info.testSystem = 'vitest' in deps ? 'vitest' : 'jest' in deps ? 'jest' : '@playwright/test' in deps ? 'playwright' : 'unknown';
    info.scripts = pkg.scripts ?? {};
    if (info.scripts.test) info.testCommand = `${info.buildSystem} test`;
    for (const c of ['src/app', 'app', 'pages', 'src/pages', 'src/server', 'prisma/schema', 'prisma/schema.prisma', 'server.ts', 'index.ts', 'src/index.ts']) {
      if (existsSync(join(dir, c))) info.entryPoints.push(c);
    }
  } else if (lang === 'python') {
    info.buildSystem = existsSync(join(dir, 'pyproject.toml')) ? 'poetry/pip' : 'pip';
    if (['pytest.ini', 'tox.ini', 'conftest.py'].some((f) => existsSync(join(dir, f)))) { info.testSystem = 'pytest'; info.testCommand = 'pytest'; }
    for (const c of ['main.py', 'app.py', 'server.py', 'manage.py', 'wsgi.py', 'asgi.py']) if (existsSync(join(dir, c))) info.entryPoints.push(c);
  }
  return info;
}

const IMPORT_RE = /(?:import\s[^'"]*?from\s*|import\s*\(\s*|require\s*\(\s*|^\s*import\s+)['"]([^'"]+)['"]/gm;
const PY_IMPORT_RE = /^\s*(?:from\s+([\w.]+)\s+import|import\s+([\w.]+))/gm;

function resolveLocal(fromFile, spec, root, aliases) {
  let base;
  if (spec.startsWith('.')) base = resolve(dirname(fromFile), spec);
  else {
    const alias = aliases.find(([prefix]) => spec.startsWith(prefix));
    if (!alias) return null;
    base = resolve(alias[1], spec.slice(alias[0].length));
  }
  for (const cand of [base, ...['.ts', '.tsx', '.js', '.jsx', '.mjs'].map((e) => base + e), ...['index.ts', 'index.tsx', 'index.js'].map((i) => join(base, i))]) {
    if (existsSync(cand) && statSync(cand).isFile()) return relative(root, cand).replace(/\\/g, '/');
  }
  return null;
}

export function scanRepo(root) {
  const k = { root, projects: [], folders: [], fileCount: 0, lineCount: 0, truncated: false, importGraph: {} };
  for (const dir of projectRoots(root)) k.projects.push(describeProject(dir, root));

  // tsconfig "@/..." style aliases per project
  const aliases = [];
  for (const p of k.projects) {
    const ts = readJson(join(root, p.path, 'tsconfig.json'));
    for (const [key, targets] of Object.entries(ts?.compilerOptions?.paths ?? {})) {
      if (key.endsWith('/*') && targets?.[0]?.endsWith('/*')) aliases.push([key.slice(0, -1), resolve(root, p.path, ts.compilerOptions.baseUrl ?? '.', targets[0].slice(0, -1))]);
    }
  }

  const walk = (dir, depth) => {
    for (const d of readdirSync(dir, { withFileTypes: true })) {
      if (k.fileCount >= MAX_FILES) { k.truncated = true; return; }
      const p = join(dir, d.name);
      if (d.isSymbolicLink()) continue;
      if (d.isDirectory()) {
        if (SKIP_DIRS.has(d.name)) continue;
        if (depth < 3) k.folders.push(relative(root, p).replace(/\\/g, '/'));
        walk(p, depth + 1);
        continue;
      }
      k.fileCount++;
      if (!CODE_EXT.has(extname(d.name))) continue;
      const st = statSync(p);
      if (st.size > MAX_FILE_BYTES) continue;
      const text = readFileSync(p, 'utf8');
      k.lineCount += text.split('\n').length;
      const rel = relative(root, p).replace(/\\/g, '/');
      const deps = new Set();
      const re = extname(d.name) === '.py' ? PY_IMPORT_RE : IMPORT_RE;
      re.lastIndex = 0;
      for (const m of text.matchAll(re)) {
        const spec = m[1] ?? m[2];
        if (!spec) continue;
        deps.add(resolveLocal(p, spec, root, aliases) ?? spec);
      }
      k.importGraph[rel] = [...deps].slice(0, 80);
    }
  };
  walk(root, 0);
  return k;
}

// legacy RepositoryMemory.impacted_files, extended with reverse-import traversal:
// files whose path or imports mention `symbol`, then their importers up to `depth` hops.
export function impactedFiles(knowledge, symbol, depth = 2) {
  const s = symbol.toLowerCase();
  const direct = Object.entries(knowledge.importGraph)
    .filter(([file, imports]) => file.toLowerCase().includes(s) || imports.some((i) => i.toLowerCase().includes(s)))
    .map(([file]) => file);
  const importers = new Map();
  for (const [file, imports] of Object.entries(knowledge.importGraph)) {
    for (const i of imports) {
      if (!importers.has(i)) importers.set(i, []);
      importers.get(i).push(file);
    }
  }
  const seen = new Set(direct);
  let frontier = direct;
  for (let d = 0; d < depth; d++) {
    const next = [];
    for (const f of frontier) for (const imp of importers.get(f) ?? []) if (!seen.has(imp)) { seen.add(imp); next.push(imp); }
    frontier = next;
  }
  return { direct, transitive: [...seen].filter((f) => !direct.includes(f)) };
}

export function summarize(k) {
  return {
    projects: k.projects,
    folders: k.folders.slice(0, 120),
    fileCount: k.fileCount,
    lineCount: k.lineCount,
    truncated: k.truncated,
    testFiles: Object.keys(k.importGraph).filter((f) => /(^|\/)(tests?|__tests__)\/|\.(test|spec)\.[jt]sx?$|(^|\/)test_[^/]+\.py$/.test(f)).slice(0, 200),
  };
}
