/** Build the Python PTY arguments while preserving the identity gate's digest. */
export function nativePtySmokeArgs({ root, binary, plugin, selection, probe }) {
  const args = [
    `${root}/tools/native-pty-smoke.py`, '--binary', binary, '--plugin', plugin,
    '--command', probe.command, '--expect', probe.expect, '--ready', '◆ CTG',
    ...(probe.secondEnter ? ['--second-enter'] : ['--confirm']),
  ];
  for (const next of probe.next ?? []) args.push('--after-command', next.command, '--after-expect', next.expect);
  if (probe.dismissCompletion) args.push('--dismiss-completion');
  if (probe.postSubmitMarker) args.push('--post-submit-marker', probe.postSubmitMarker);
  if (probe.color) args.push('--expect-color', probe.color);
  if (probe.initialTheme) args.push('--initial-theme', probe.initialTheme);
  if (selection.binarySha256) args.push('--expected-sha256', selection.binarySha256);
  return args;
}
