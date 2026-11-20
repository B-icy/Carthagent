/**
 * `ctg doctor`: a quick, read-only health report. Every check is independent,
 * so one failure (e.g. the service will not start) still shows the rest and the
 * next step to take.
 */

import { crashIssueUrl, crashLogDir, latestCrashReport } from '../crash-report.mjs';
import { getLogger } from '../logger.mjs';

const RECENT_CRASH_MS = 14 * 24 * 60 * 60 * 1000;
const log = getLogger('doctor');

const NODE_RANGES = [
  [22, 22, 2],
  [24, 15, 0],
  [26, 0, 0],
];

/** True when `version` (e.g. "v24.22.1") satisfies ^22.22.2 || ^24.15.0 || >=26. */
export function supportedNode(version) {
  const [major, minor, patch] = String(version).replace(/^v/, '').split('.').map(Number);
  if (![major, minor, patch].every(Number.isInteger)) return false;
  if (major >= 26) return true;
  const range = NODE_RANGES.find(([m]) => m === major);
  if (!range) return false;
  return minor > range[1] || (minor === range[1] && patch >= range[2]);
}

/**
 * Run the checks. Each probe returns a value or throws; the report never throws.
 * `probes.crash` (default: the newest local crash report) adds a warning row
 * for a crash recorded in the last 14 days.
 * @param {{ version: string, nodeVersion: string, platform: string, probes: Record<string, () => Promise<any>>, now?: number }} input
 */
export async function doctorReport({ version, nodeVersion, platform, probes, now = Date.now() }) {
  const rows = await healthRows({ version, nodeVersion, platform, probes });
  const crash = await (probes.crash ?? (async () => latestCrashReport()))().catch(error => {
    log.debug('Could not read crash reports', { error });
    return null;
  });
  const row = crashRow(crash, now);
  if (row) rows.push(row);
  return rows;
}

function crashRow(found, now) {
  const report = found?.report;
  if (!report || !(now - Date.parse(report.timestamp) <= RECENT_CRASH_MS)) return null;
  const message = String(report.error?.message ?? '').split('\n')[0];
  return {
    status: 'warn',
    label: 'Last crash',
    detail: `${report.timestamp} ${report.fingerprint} ${report.error?.name}: ${message.length > 120 ? `${message.slice(0, 117)}...` : message}`,
    fix: `Full report: \`ctg doctor --crash-report\`. Report it: ${crashIssueUrl(report)}`,
  };
}

async function healthRows({ version, nodeVersion, platform, probes }) {
  const rows = [];
  const add = (status, label, detail, fix) => rows.push({ status, label, detail, ...(fix ? { fix } : {}) });
  add('ok', 'Carthagent', version);
  if (supportedNode(nodeVersion)) add('ok', 'Node', nodeVersion);
  else add('fail', 'Node', `${nodeVersion} is not supported`, 'Install Node 22.22.2+, 24.15+ or 26+, then reinstall Carthagent.');
  add('ok', 'Platform', platform);

  const attempt = async name => {
    try {
      return { value: await probes[name]() };
    } catch (error) {
      log.debug('Doctor check failed', { check: name, error });
      // Native RPC rejects with plain { type, message } objects, not Error instances.
      return { error: typeof error?.message === 'string' && error.message ? error.message : String(error) };
    }
  };

  const runtime = await attempt('runtime');
  if (runtime.error) add('fail', 'Runtime', runtime.error, 'Check your network, then run `ctg` again to download it.');
  else add('ok', 'Runtime', runtime.value);

  const service = await attempt('service');
  if (service.error) {
    add('fail', 'Service', service.error, 'Run `ctg service stop`, then `ctg doctor` again.');
    add('skip', 'Providers', 'skipped (service unavailable)');
    add('skip', 'Carthagent Cloud', 'skipped (service unavailable)');
    return rows;
  }
  add('ok', 'Service', service.value);

  const providers = await attempt('providers');
  if (providers.error) add('fail', 'Providers', providers.error);
  else if (!providers.value.length) add('fail', 'Providers', 'none connected', 'Run `ctg login` (Carthagent Cloud is recommended) or set a provider API key.');
  else add('ok', 'Providers', providers.value.join(', '));

  const cloud = await attempt('cloud');
  // Never signed in is optional; a session the server ended is broken auth.
  if (cloud.error && /expired or was revoked/i.test(cloud.error))
    add('fail', 'Carthagent Cloud', 'session expired or revoked', 'Run `ctg login` again and choose Carthagent Cloud.');
  else if (cloud.error) add('warn', 'Carthagent Cloud', 'not signed in', 'Optional: `ctg login` and choose Carthagent Cloud.');
  else add('ok', 'Carthagent Cloud', cloud.value);
  return rows;
}

const MARK = { ok: '✓', warn: '!', fail: '✗', skip: '-' };

/** Plain text, one line per check, with a fix under anything that failed. */
export function formatDoctor(rows) {
  const width = Math.max(...rows.map(row => row.label.length));
  const lines = rows.flatMap(row => [
    `${MARK[row.status]} ${row.label.padEnd(width)}  ${row.detail}`,
    ...(row.fix ? [`  ${' '.repeat(width)}  → ${row.fix}`] : []),
  ]);
  const failed = rows.filter(row => row.status === 'fail').length;
  lines.push('', failed ? `${failed} problem${failed === 1 ? '' : 's'} found.` : 'All good.');
  return lines.join('\n');
}

export const doctorExitCode = rows => (rows.some(row => row.status === 'fail') ? 1 : 0);

/** `ctg doctor --crash-report`: print the newest local crash report as JSON on stdout. */
export function printLatestCrashReport({ io = console, dir = crashLogDir() } = {}) {
  const found = latestCrashReport(dir);
  if (!found) {
    io.log(`No crash reports found in ${dir}.`);
    return 0;
  }
  io.error(`Crash report: ${found.path}`);
  io.log(JSON.stringify(found.report, null, 2));
  return 0;
}
