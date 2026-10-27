// Read-only Git queries used to verify a submission revision. No shell, bounded time.
// The orchestrator itself commits and pushes; the helper only checks the result.

import { execFile } from 'node:child_process';

function git(cwd, args, { timeoutMs = 20_000 } = {}) {
  return new Promise((resolve) => {
    execFile('git', args, { cwd, timeout: timeoutMs, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout, stderr) => resolve({ ok: !err, code: err?.code ?? 0, stdout: String(stdout), stderr: String(stderr) }));
  });
}

export async function headRevision(checkoutRoot) {
  const r = await git(checkoutRoot, ['rev-parse', 'HEAD']);
  return r.ok ? r.stdout.trim() : null;
}

export async function resolveRevision(checkoutRoot, rev) {
  const r = await git(checkoutRoot, ['rev-parse', '--verify', '--quiet', `${rev}^{commit}`]);
  return r.ok ? r.stdout.trim() : null;
}

export async function readFileAtRevision(checkoutRoot, rev, path) {
  const r = await git(checkoutRoot, ['show', `${rev}:${path}`]);
  return r.ok ? r.stdout : null;
}

export async function fileExistsAtRevision(checkoutRoot, rev, path) {
  return (await git(checkoutRoot, ['cat-file', '-e', `${rev}:${path}`])).ok;
}

export async function isPushed(checkoutRoot, rev, branch) {
  return (await git(checkoutRoot, ['merge-base', '--is-ancestor', rev, `refs/remotes/origin/${branch}`])).ok;
}

export async function originUrl(checkoutRoot) {
  const r = await git(checkoutRoot, ['config', '--get', 'remote.origin.url']);
  return r.ok ? r.stdout.trim() : null;
}

export async function currentBranch(checkoutRoot) {
  const r = await git(checkoutRoot, ['rev-parse', '--abbrev-ref', 'HEAD']);
  return r.ok ? r.stdout.trim() : null;
}
