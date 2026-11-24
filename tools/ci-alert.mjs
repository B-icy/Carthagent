import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { alertMarker, applyAlertAction, createIssueClient, findAlertIssue, ghRunner } from './github-issues.mjs';

export const CI_ALERT_LABELS = ['source: ci-alert', 'priority: P1', 'area: ci'];
const FAILING_CONCLUSIONS = new Set(['failure', 'timed_out', 'startup_failure']);
const ALWAYS_TRACKED_EVENTS = new Set(['workflow_dispatch', 'release']);
const BRANCH_EVENTS = new Set(['push', 'schedule', 'merge_group']);
const MAX_FAILED_STEPS = 3;

export function alertKey(workflowName) {
  return `ci:${workflowName}`;
}

export function runState(conclusion) {
  if (FAILING_CONCLUSIONS.has(conclusion)) return 'failing';
  if (conclusion === 'success') return 'passing';
  return 'ignored';
}

export function isTrackedRun(run, { repo, defaultBranch }) {
  if (!run || run.head_repository?.full_name !== repo) return false;
  if (ALWAYS_TRACKED_EVENTS.has(run.event)) return true;
  return BRANCH_EVENTS.has(run.event) && run.head_branch === defaultBranch;
}

export function summarizeFailedJobs(jobs) {
  return (jobs || [])
    .filter(job => FAILING_CONCLUSIONS.has(job.conclusion))
    .map(job => ({
      name: job.name,
      url: job.html_url,
      conclusion: job.conclusion,
      failedSteps: (job.steps || [])
        .filter(step => FAILING_CONCLUSIONS.has(step.conclusion))
        .slice(0, MAX_FAILED_STEPS)
        .map(step => step.name),
    }));
}

function runLine(run) {
  const sha = String(run.head_sha || '').slice(0, 12);
  return `[${run.name} #${run.run_number} attempt ${run.run_attempt ?? 1}](${run.html_url}) (${run.event} on \`${run.head_branch}\` at \`${sha}\`) concluded **${run.conclusion}**.`;
}

function jobLines(failedJobs) {
  if (!failedJobs.length) return ['No individual job reported a failure; open the run for setup or startup errors.'];
  return failedJobs.map(job => {
    const steps = job.failedSteps.length ? `: ${job.failedSteps.map(step => `\`${step}\``).join(', ')}` : '';
    return `- [${job.name}](${job.url}) ${job.conclusion}${steps}`;
  });
}

export function renderFailure(run, failedJobs) {
  return [runLine(run), '', `Head SHA: \`${run.head_sha}\``, '', '**Failed jobs and first failing steps**', ...jobLines(failedJobs)].join('\n');
}

export function renderIssue(run, failedJobs) {
  return {
    title: `CI alert: ${run.name} failing on ${run.head_branch}`,
    labels: CI_ALERT_LABELS,
    body: [
      alertMarker(alertKey(run.name)),
      renderFailure(run, failedJobs),
      '',
      'This issue was opened by the CI alert workflow. Later failures of the same workflow are added as comments, and the issue closes automatically when the workflow succeeds again. See docs/alerting.md.',
    ].join('\n'),
  };
}

export function decideAction({ run, repo, defaultBranch, openIssue, failedJobs = [] }) {
  if (!isTrackedRun(run, { repo, defaultBranch })) return { type: 'none', reason: 'untracked run' };
  const state = runState(run.conclusion);
  if (state === 'failing' && !openIssue) return { type: 'create', issue: renderIssue(run, failedJobs) };
  if (state === 'failing') return { type: 'comment', number: openIssue.number, comment: `Failed again.\n\n${renderFailure(run, failedJobs)}` };
  if (state === 'passing' && openIssue) {
    return { type: 'close', number: openIssue.number, comment: `Recovered: ${runLine(run)} Closing this alert.` };
  }
  return { type: 'none', reason: state === 'passing' ? 'no open alert' : `conclusion ${run.conclusion} is not alerted` };
}

export function fetchFailedJobs(repo, run, request) {
  const attempt = run.run_attempt ?? 1;
  const response = request('GET', `repos/${repo}/actions/runs/${run.id}/attempts/${attempt}/jobs?per_page=100`);
  return summarizeFailedJobs(response?.jobs);
}

export function processEvent(event, { repo, request = ghRunner(), log = console.log }) {
  const run = event.workflow_run;
  const defaultBranch = event.repository?.default_branch || 'main';
  if (!isTrackedRun(run, { repo, defaultBranch }) || runState(run.conclusion) === 'ignored') {
    log(`No alert action for ${run?.name ?? 'unknown workflow'} (${run?.event}, ${run?.head_branch}, ${run?.conclusion}).`);
    return { type: 'none' };
  }
  const client = createIssueClient({ repo, run: request });
  const openIssue = findAlertIssue(client.listOpenIssues(), alertKey(run.name));
  const failedJobs = runState(run.conclusion) === 'failing' ? fetchFailedJobs(repo, run, request) : [];
  const action = decideAction({ run, repo, defaultBranch, openIssue, failedJobs });
  const result = applyAlertAction(client, action);
  log(`CI alert for ${run.name}: ${result.type}${result.number ? ` #${result.number}` : ''}${result.issue ? ` #${result.issue.number}` : ''}.`);
  return result;
}

function main(argv) {
  const eventIndex = argv.indexOf('--event');
  const eventPath = eventIndex >= 0 ? argv[eventIndex + 1] : process.env.GITHUB_EVENT_PATH;
  if (!eventPath) throw new Error('Usage: node tools/ci-alert.mjs --event <workflow_run event JSON> (or set GITHUB_EVENT_PATH)');
  const repo = process.env.GITHUB_REPOSITORY;
  if (!repo) throw new Error('GITHUB_REPOSITORY must be set.');
  processEvent(JSON.parse(readFileSync(eventPath, 'utf8')), { repo });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
