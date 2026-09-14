/**
 * Scenario manifests: pluggable task profiles for the evaluation runner.
 *
 * Each scenarios/<name>/ directory holds a scenario.json plus its graders,
 * seed files, and context. The harness (evaluate.mjs) stays domain-agnostic —
 * a game, a CLI task, or any future domain is just another manifest, i.e. a
 * selectable path through the same delivery plan → check → finish pipeline.
 *
 * scenario.json shape:
 *   {
 *     "name": "game",
 *     "description": "…",
 *     "prompt": "the single user prompt",              // or { "file": "prompt.md" }
 *     "setup": "text appended to the shared execution context (both modes)",
 *     "context": ["context.md"],                        // files joined into --delivery-context (custom mode)
 *     "skills": ["game-development"],                   // skill dirs whose SKILL.md is inlined into context
 *     "seeds": [{ "from": "seed/file.ts", "to": "src/index.ts" }],
 *     "runtimes": { "python": "/path/to/python" },       // extra runtime placeholders (optional)
 *     "developmentChecks": [check],                     // required validators during the run
 *     "holdoutChecks": [check],                         // scored after the run, unseen by the model
 *   }
 *
 * check = { "id", "kind", "argv": [...], "timeoutSeconds" } — argv supports
 * placeholders: {python} {node} {root} {home} {cwd} {scenario}, plus any key
 * declared in the scenario's "runtimes" map (e.g. {rust}, {go}).
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';

export function listScenarios(root) {
  const dir = join(root, 'scenarios');
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter(d => d.isDirectory() && existsSync(join(dir, d.name, 'scenario.json')))
    .map(d => d.name);
}

export function loadScenario(root, name) {
  const scenariosRoot = resolve(root, 'scenarios');
  const dir = resolve(scenariosRoot, name);
  const local = relative(scenariosRoot, dir);
  if (!name || local === '..' || local.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(local)) throw Error(`Invalid scenario name: ${JSON.stringify(name)}`);
  const manifestPath = join(dir, 'scenario.json');
  if (!existsSync(manifestPath)) {
    const known = listScenarios(root);
    throw Error(`Unknown scenario ${JSON.stringify(name)}. Available: ${known.join(', ') || '(none — expected scenarios/<name>/scenario.json beside evaluate.mjs)'}`);
  }
  const m = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (typeof m.name === 'string' && m.name !== name) throw Error(`Scenario ${name} manifest name mismatch: ${m.name}`);
  const prompt = typeof m.prompt === 'string'
    ? m.prompt
    : m.prompt?.file ? readFileSync(join(dir, m.prompt.file), 'utf8').trim()
    : null;
  if (!prompt) throw Error(`Scenario ${name} needs a prompt (string or {file})`);

  const check = c => {
    if (!c.id || !Array.isArray(c.argv) || !c.argv.every(a => typeof a === 'string' && a.length)) throw Error(`Scenario ${name}: invalid check ${JSON.stringify(c?.id)}`);
    return { kind: 'runtime', timeoutSeconds: 90, ...c };
  };
  const developmentChecks = (m.developmentChecks || []).map(check);
  const holdoutChecks = (m.holdoutChecks || []).map(check);
  if (!developmentChecks.length && !holdoutChecks.length) throw Error(`Scenario ${name} declares no checks`);

  // Resolve everything path-shaped relative to the scenario dir now; {cwd}
  // and {python} stay as placeholders — they differ per trial run.
  const contextParts = [];
  for (const skill of m.skills || []) {
    const skillDir = join(root, 'skills', skill);
    const skillMd = join(skillDir, 'SKILL.md');
    if (!existsSync(skillMd)) throw Error(`Scenario ${name}: missing skill ${skillDir}`);
    contextParts.push(readFileSync(skillMd, 'utf8'), `Skill-relative assets/scripts resolve under: ${skillDir}`);
  }
  for (const file of m.context || []) contextParts.push(readFileSync(join(dir, file), 'utf8'));

  return {
    name,
    dir,
    description: m.description || '',
    prompt,
    setup: m.setup || '',
    context: contextParts.join('\n\n'),
    seeds: (m.seeds || []).map(s => ({
      from: expandPlaceholders(s.from, { root, home: root, scenario: dir }),
      to: s.to,
    })),
    developmentChecks,
    holdoutChecks,
    needsPython: JSON.stringify(m).includes('{python}'),
    runtimes: m.runtimes || {},
  };
}

/** Substitute {python} {node} {root} {home} {cwd} {scenario} and any scenario-declared runtime keys in a string/argv. */
export function expandPlaceholders(value, vars) {
  const sub = s => s.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? `{${k}}`);
  if (typeof value === 'string') return sub(value);
  if (Array.isArray(value)) return value.map(v => expandPlaceholders(v, vars));
  return value;
}
