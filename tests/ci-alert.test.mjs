import assert from 'node:assert/strict';
import { test } from 'node:test';
import { alertKey, decideAction, isTrackedRun, processEvent, runState, summarizeFailedJobs } from '../tools/ci-alert.mjs';
import { alertMarker, findAlertIssue } from '../tools/github-issues.mjs';

const REPO = 'B-icy/Carthagent';
const context = { repo: REPO, defaultBranch: 'main' };

function makeRun(overrides = {}) {
  return {
    id: 42,
    name: 'CI',
    run_number: 7,
    run_attempt: 1,
    event: 'push',
    head_branch: 'main',
    head_sha: 'abcdef0123456789abcdef0123456789abcdef01',
    conclusion: 'failure',
    html_url: 'https://github.com/B-icy/Carthagent/actions/runs/42',
    head_repository: { full_name: REPO },
    ...overrides,
  };
}

const jobs = [
  {
    name: 'test (ubuntu-latest, 24)',
    html_url: 'https://github.com/B-icy/Carthagent/actions/runs/42/job/1',
    conclusion: 'failure',
    steps: [
      { name: 'Set up job', conclusion: 'success' },
      { name: 'npm test', conclusion: 'failure' },
      { name: 'Post checkout', conclusion: 'skipped' },
    ],
  },
  { name: 'test (macos-latest, 22)', html_url: 'u2', conclusion: 'success', steps: [] },
  { name: 'publish', html_url: 'u3', conclusion: 'timed_out', steps: [{ name: 'Publish', conclusion: 'cancelled' }] },
];

test('classifies conclusions', () => {
  assert.equal(runState('failure'), 'failing');
  assert.equal(runState('timed_out'), 'failing');
  assert.equal(runState('success'), 'passing');
  assert.equal(runState('cancelled'), 'ignored');
  assert.equal(runState('skipped'), 'ignored');
});

test('tracks default-branch pushes and dispatches, never PRs or forks', () => {
  assert.equal(isTrackedRun(makeRun(), context), true);
  assert.equal(isTrackedRun(makeRun({ head_branch: 'feature' }), context), false);
  assert.equal(isTrackedRun(makeRun({ event: 'workflow_dispatch', head_branch: 'release/1.2' }), context), true);
  assert.equal(isTrackedRun(makeRun({ event: 'pull_request' }), context), false);
  assert.equal(isTrackedRun(makeRun({ head_repository: { full_name: 'evil/Carthagent' } }), context), false);
  assert.equal(isTrackedRun(makeRun({ event: 'workflow_dispatch', head_repository: { full_name: 'evil/Carthagent' } }), context), false);
});

test('summarizes failed jobs with their first failing steps', () => {
  assert.deepEqual(summarizeFailedJobs(jobs), [
    { name: 'test (ubuntu-latest, 24)', url: 'https://github.com/B-icy/Carthagent/actions/runs/42/job/1', conclusion: 'failure', failedSteps: ['npm test'] },
    { name: 'publish', url: 'u3', conclusion: 'timed_out', failedSteps: [] },
  ]);
});

test('opens a labeled, marker-deduplicated issue on the first failure', () => {
  const action = decideAction({ run: makeRun(), ...context, openIssue: null, failedJobs: summarizeFailedJobs(jobs) });
  assert.equal(action.type, 'create');
  assert.equal(action.issue.title, 'CI alert: CI failing on main');
  assert.deepEqual(action.issue.labels, ['source: ci-alert', 'priority: P1', 'area: ci']);
  assert.ok(action.issue.body.startsWith(alertMarker('ci:CI')));
  assert.match(action.issue.body, /abcdef0123456789abcdef0123456789abcdef01/);
  assert.match(action.issue.body, /runs\/42/);
  assert.match(action.issue.body, /`npm test`/);
});

test('comments on the open issue for repeated failures and closes it on recovery', () => {
  const openIssue = { number: 9, body: alertMarker(alertKey('CI')) };
  const again = decideAction({ run: makeRun({ conclusion: 'timed_out' }), ...context, openIssue, failedJobs: [] });
  assert.equal(again.type, 'comment');
  assert.equal(again.number, 9);
  assert.match(again.comment, /Failed again/);
  const recovered = decideAction({ run: makeRun({ conclusion: 'success' }), ...context, openIssue });
  assert.equal(recovered.type, 'close');
  assert.match(recovered.comment, /Recovered/);
  assert.equal(decideAction({ run: makeRun({ conclusion: 'success' }), ...context, openIssue: null }).type, 'none');
  assert.equal(decideAction({ run: makeRun({ head_branch: 'feature' }), ...context, openIssue }).type, 'none');
});

test('finds only open issues (not PRs) with the exact workflow marker', () => {
  const issues = [
    { number: 3, body: alertMarker('ci:CI Extra'), state: 'open' },
    { number: 4, body: alertMarker('ci:CI'), state: 'open', pull_request: {} },
    { number: 6, body: `text\n${alertMarker('ci:CI')}`, state: 'open' },
    { number: 5, body: alertMarker('ci:CI'), state: 'open' },
  ];
  assert.equal(findAlertIssue(issues, 'ci:CI').number, 5);
  assert.equal(findAlertIssue(issues, 'ci:Release'), null);
});

function fakeGitHub(openIssues) {
  const calls = [];
  const request = (method, path, body) => {
    calls.push({ method, path, body });
    if (path.includes('/issues?state=open')) return openIssues;
    if (path.includes('/jobs')) return { jobs };
    if (method === 'POST' && path.endsWith('/issues')) return { number: 11 };
    return {};
  };
  return { calls, request };
}

test('processEvent creates an issue with jobs from the run attempt', () => {
  const github = fakeGitHub([]);
  const result = processEvent(
    { workflow_run: makeRun({ run_attempt: 2 }), repository: { default_branch: 'main' } },
    { repo: REPO, request: github.request, log: () => {} },
  );
  assert.equal(result.type, 'create');
  assert.ok(github.calls.some(call => call.path === `repos/${REPO}/actions/runs/42/attempts/2/jobs?per_page=100`));
  assert.match(github.calls.find(call => call.method === 'POST').body.body, /npm test/);
});

test('processEvent closes the alert after a successful main run and ignores cancelled runs', () => {
  const github = fakeGitHub([{ number: 9, body: alertMarker('ci:CI'), state: 'open' }]);
  const result = processEvent(
    { workflow_run: makeRun({ conclusion: 'success' }), repository: { default_branch: 'main' } },
    { repo: REPO, request: github.request, log: () => {} },
  );
  assert.equal(result.type, 'close');
  assert.deepEqual(
    github.calls.filter(call => call.method !== 'GET').map(call => `${call.method} ${call.path}`),
    [`POST repos/${REPO}/issues/9/comments`, `PATCH repos/${REPO}/issues/9`],
  );
  const idle = fakeGitHub([]);
  assert.equal(processEvent({ workflow_run: makeRun({ conclusion: 'cancelled' }) }, { repo: REPO, request: idle.request, log: () => {} }).type, 'none');
  assert.equal(idle.calls.length, 0);
});
