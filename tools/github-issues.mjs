import { spawnSync } from 'node:child_process';

export const ALERT_MARKER_PREFIX = 'carthagent-alert:';
const SIGNATURE_PREFIX = 'carthagent-alert-signature:';
const MAX_ISSUE_PAGES = 10;
const PAGE_SIZE = 100;

export function alertMarker(key) {
  return `<!-- ${ALERT_MARKER_PREFIX}${key} -->`;
}

export function signatureMarker(signature) {
  return `<!-- ${SIGNATURE_PREFIX}${signature} -->`;
}

export function readSignature(body) {
  const match = String(body || '').match(/<!-- carthagent-alert-signature:([^\s]*) -->/);
  return match ? match[1] : null;
}

export function replaceSignature(body, signature) {
  const text = String(body || '');
  const marker = signatureMarker(signature);
  if (readSignature(text) === null) return `${text}\n${marker}`;
  return text.replace(/<!-- carthagent-alert-signature:[^\s]* -->/, marker);
}

export function findAlertIssue(issues, key) {
  const marker = alertMarker(key);
  const matches = (issues || []).filter(issue => !issue.pull_request && issue.state !== 'closed' && String(issue.body || '').includes(marker));
  matches.sort((a, b) => a.number - b.number);
  return matches[0] || null;
}

export function parseGithubRepo(remoteUrl) {
  const text = String(remoteUrl || '').trim();
  const match = text.match(/[:/]([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/);
  if (!match) return null;
  return `${match[1]}/${match[2]}`;
}

export function defaultRepo({ env = process.env, spawn = spawnSync } = {}) {
  if (env.GITHUB_REPOSITORY) return env.GITHUB_REPOSITORY;
  const result = spawn('git', ['remote', 'get-url', 'origin'], { encoding: 'utf8' });
  const repo = result.status === 0 ? parseGithubRepo(result.stdout) : null;
  if (!repo) throw new Error('Cannot determine the GitHub repository; pass --repo owner/name.');
  return repo;
}

export function ghRunner({ spawn = spawnSync } = {}) {
  return (method, path, body) => {
    const args = ['api', '-X', method, '-H', 'Accept: application/vnd.github+json', path];
    if (body !== undefined) args.push('--input', '-');
    const result = spawn('gh', args, {
      encoding: 'utf8',
      input: body === undefined ? undefined : JSON.stringify(body),
      maxBuffer: 64 * 1024 * 1024,
    });
    if (result.error) throw new Error(`gh api ${method} ${path} failed to start: ${result.error.message}`);
    if (result.status !== 0) throw new Error(`gh api ${method} ${path} failed (${result.status}): ${String(result.stderr || result.stdout).trim()}`);
    const output = String(result.stdout || '').trim();
    return output ? JSON.parse(output) : null;
  };
}

export function createIssueClient({ repo, run = ghRunner() }) {
  const base = `repos/${repo}`;
  return {
    repo,
    listOpenIssues() {
      const issues = [];
      for (let page = 1; page <= MAX_ISSUE_PAGES; page++) {
        const batch = run('GET', `${base}/issues?state=open&per_page=${PAGE_SIZE}&page=${page}`);
        issues.push(...batch);
        if (batch.length < PAGE_SIZE) return issues;
      }
      return issues;
    },
    createIssue({ title, body, labels }) {
      return run('POST', `${base}/issues`, { title, body, labels });
    },
    comment(number, body) {
      return run('POST', `${base}/issues/${number}/comments`, { body });
    },
    updateBody(number, body) {
      return run('PATCH', `${base}/issues/${number}`, { body });
    },
    close(number) {
      return run('PATCH', `${base}/issues/${number}`, { state: 'closed', state_reason: 'completed' });
    },
  };
}

export function applyAlertAction(client, action) {
  switch (action.type) {
    case 'create':
      return { type: 'create', issue: client.createIssue(action.issue) };
    case 'comment':
      if (action.body !== undefined) client.updateBody(action.number, action.body);
      client.comment(action.number, action.comment);
      return { type: 'comment', number: action.number };
    case 'close':
      client.comment(action.number, action.comment);
      client.close(action.number);
      return { type: 'close', number: action.number };
    default:
      return { type: 'none', number: action.number ?? null };
  }
}
