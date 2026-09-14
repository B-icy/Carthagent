import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { formatGuidance, loadGuidanceProfiles, routeGuidance } from '../lib/guidance.mjs';
import { planD2 } from '../lib/delivery.mjs';

function project(t, dependencies = {}) {
  const cwd = mkdtempSync(join(tmpdir(), 'pi2 guidance '));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  writeFileSync(join(cwd, 'package.json'), JSON.stringify({ dependencies }));
  return cwd;
}

const plan = {
  goal: 'Build a page', assumptions: [], artifacts: ['.'], steps: ['Implement'],
  acceptance: [{ requirement: 'Works', checks: ['test'] }],
  checks: [{ id: 'test', kind: 'test', argv: ['npm', 'test'], timeoutSeconds: 60 }]
};

test('router activates the web foundation from project dependencies', t => {
  const profiles = routeGuidance('Fix the navigation spacing', { cwd: project(t, { next: '15.1.7' }) });
  assert.deepEqual(profiles.map(profile => profile.id), ['web-application']);
});

test('router composes request-specific web, auth, transactional, provider, and chart profiles', t => {
  const request = 'Build an authenticated dashboard with portfolio trades, a third-party API integration, and a time series chart';
  const profiles = routeGuidance(request, { cwd: project(t, { next: '15.1.7' }) });
  assert.deepEqual(profiles.map(profile => profile.id), [
    'web-application', 'authenticated-web', 'transactional-data', 'external-api', 'data-visualization'
  ]);
  const guidance = formatGuidance(profiles);
  assert.match(guidance, /client-supplied prices/i);
  assert.match(guidance, /authenticated-but-not-authorized/i);
  assert.match(guidance, /stale responses/i);
});

test('routing stays out of the plan contract and generated D2 source', t => {
  const routed = routeGuidance('Add a chart component', { cwd: project(t, { react: '19' }) });
  assert.deepEqual(routed.map(profile => profile.id), ['web-application', 'data-visualization']);
  const d2 = planD2(plan);
  assert.doesNotMatch(d2, /guidance|profile/i);
  assert.match(d2, /^direction: down\n/);
  assert.equal(plan.guidanceProfiles, undefined);
});

test('new profile files extend routing without router code changes', t => {
  const cwd = project(t);
  const dir = join(cwd, 'profiles');
  mkdirSync(dir);
  writeFileSync(join(dir, 'jobs.json'), JSON.stringify({
    id: 'background-jobs', title: 'Background jobs', priority: 5,
    match: { keywords: ['queue worker'] },
    planning: ['Define retries.'], checks: ['Test retries.'], review: ['Review idempotency.']
  }));
  const profiles = loadGuidanceProfiles(dir);
  assert.deepEqual(routeGuidance('Add a queue worker', { cwd, profiles }).map(profile => profile.id), ['background-jobs']);
});
