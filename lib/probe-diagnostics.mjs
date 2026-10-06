// Advisory only: diagnose repeated infrastructure failures without granting
// permission, suppressing evidence, executing commands or weakening checks.
export function probeDiagnostics(previous = { failures: 0, family: null }, event) {
  if (!['bash', 'delivery_check'].includes(event.toolName)) return { state: previous };
  const text = (event.content || []).filter(item => item.type === 'text').map(item => item.text).join('\n');
  const failed = event.isError === true || /(?:exit(?:ed)? (?:with )?code[: ]+[1-9]|\bERR_(?:MODULE|UNKNOWN|PACKAGE)|Cannot find (?:module|package)|"passed"\s*:\s*false|ℹ fail [1-9]|\btest failed\b)/i.test(text);
  if (!failed) return { state: { failures: 0, family: null } };
  const family = /module|loader|tsx|import|registerHooks|register\(/i.test(text) ? 'module-loader' : 'execution';
  const failures = previous.family === family ? previous.failures + 1 : 1;
  const state = { failures: Math.min(failures, 1000), family };
  if (failures !== 2 && failures !== 4) return { state };
  return { state, message: `Diagnostic checkpoint: ${failures} consecutive ${family} failures. Before another executable probe, state ONE observed failure and ONE changed hypothesis; preserve the original exit code and inspect complete stderr. Do not use pipelines that turn a failed test into exit 0. Prefer existing test tooling or node:test plus existing TypeScript transpilation and mocked imports over custom loader chains. Separate product defects from test infrastructure. Do not change unrelated dependencies, hide failures with stubs, or repeatedly revise the design for probe guesses. Fix the minimal mechanism, rerun the real suite, then reserve time for final review/handoff. This advice grants no execution or approval authority.` };
}
