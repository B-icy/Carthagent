/**
 * `ctg doctor`: a quick, read-only health report. Every check is independent,
 * so one failure (e.g. the service will not start) still shows the rest and the
 * next step to take.
 */

const NODE_RANGES = [[22, 22, 2], [24, 15, 0], [26, 0, 0]];

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
 * @param {{ version: string, nodeVersion: string, platform: string, probes: Record<string, () => Promise<any>> }} input
 */
export async function doctorReport({ version, nodeVersion, platform, probes }) {
  const rows = [];
  const add = (status, label, detail, fix) => rows.push({ status, label, detail, ...(fix ? { fix } : {}) });
  add('ok', 'Carthagent', version);
  if (supportedNode(nodeVersion)) add('ok', 'Node', nodeVersion);
  else add('fail', 'Node', `${nodeVersion} is not supported`, 'Install Node 22.22.2+, 24.15+ or 26+, then reinstall Carthagent.');
  add('ok', 'Platform', platform);

  const attempt = async (name) => {
    try { return { value: await probes[name]() }; }
    catch (error) { return { error: error instanceof Error ? error.message : String(error) }; }
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
  if (cloud.error) add('warn', 'Carthagent Cloud', 'not signed in', 'Optional: `ctg login` and choose Carthagent Cloud.');
  else add('ok', 'Carthagent Cloud', cloud.value);
  return rows;
}

const MARK = { ok: '✓', warn: '!', fail: '✗', skip: '-' };

/** Plain text, one line per check, with a fix under anything that failed. */
export function formatDoctor(rows) {
  const width = Math.max(...rows.map(row => row.label.length));
  const lines = rows.flatMap(row => [`${MARK[row.status]} ${row.label.padEnd(width)}  ${row.detail}`, ...(row.fix ? [`  ${' '.repeat(width)}  → ${row.fix}`] : [])]);
  const failed = rows.filter(row => row.status === 'fail').length;
  lines.push('', failed ? `${failed} problem${failed === 1 ? '' : 's'} found.` : 'All good.');
  return lines.join('\n');
}

export const doctorExitCode = rows => (rows.some(row => row.status === 'fail') ? 1 : 0);
