// Daily goals: simple everyday habits ("change 20 lines", "run your tests", "run
// a review") counted locally from the user's own ctg sessions. Pure helpers only;
// the server module owns hooks, storage and syncing. Counts are motivation, not
// verification: they are deliberately simple and never block or alter a tool call.

export const DAILY_GOAL_METRICS = Object.freeze(['lines', 'tests', 'reviews', 'commits', 'tasks', 'verified']);
export const METRIC_UNITS = Object.freeze({ lines: ['line', 'lines'], tests: ['test run', 'test runs'], reviews: ['review', 'reviews'], commits: ['commit', 'commits'], tasks: ['task', 'tasks'], verified: ['verified task', 'verified tasks'] });
const MAX_METRIC = 100000;
const MAX_TEXT = 2_000_000;

export const utcDay = (now = Date.now()) => new Date(now).toISOString().slice(0, 10);
export const emptyMetrics = () => Object.fromEntries(DAILY_GOAL_METRICS.map(name => [name, 0]));

const text = value => typeof value === 'string' && value.length <= MAX_TEXT ? value : '';
const lines = value => { const t = text(value); return t ? t.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n') : []; };

/** Lines added plus lines removed between two texts, by multiset difference (order-insensitive, cheap). */
export function changedLines(before, after) {
  const counts = new Map();
  for (const line of lines(before)) counts.set(line, (counts.get(line) ?? 0) + 1);
  let added = 0;
  for (const line of lines(after)) {
    const left = counts.get(line) ?? 0;
    if (left > 0) counts.set(line, left - 1); else added++;
  }
  let removed = 0;
  for (const left of counts.values()) removed += left;
  return added + removed;
}

/** +/- body lines of an apply_patch/unified patch, ignoring file headers. */
export function patchLines(patch) {
  let count = 0;
  for (const line of lines(patch)) {
    if (/^(\*\*\*|\+\+\+ |--- |@@)/.test(line)) continue;
    if (line.startsWith('+') || line.startsWith('-')) count++;
  }
  return count;
}

const TEST_COMMAND = /(^|[\s;&|(])((npm|pnpm|yarn|bun)( run)? test(:[\w:-]+)?\b|npx (vitest|jest|playwright test|mocha)\b|node( (-r|--import|--require|--loader|--env-file(-if-exists)?)(=| )\S+| --(?!test)[\w-]+(=\S+)?)* --test\b|(vitest|jest|mocha|pytest|phpunit|rspec)\b|(python3?|uv run|poetry run) -m (pytest|unittest)\b|uv run pytest\b|go test\b|cargo (test|nextest)\b|dotnet test\b|mvn( -\S+)* (test|verify)\b|gradlew? (test|check)\b|make (test|check)\b|swift test\b|deno test\b|mix test\b|bundle exec (rspec|rake test)\b)/;
const COMMIT_COMMAND = /(^|[\s;&|(])git( -C \S+)?( -c \S+)* commit\b/;

export const isTestCommand = command => TEST_COMMAND.test(text(command));
export const isCommitCommand = command => COMMIT_COMMAND.test(text(command)) && !/\s--dry-run\b/.test(text(command));

const name = tool => String(tool ?? '').replace(/^carthagent[._]/, '');
const field = (input, ...keys) => { for (const key of keys) if (typeof input?.[key] === 'string') return input[key]; return undefined; };

/**
 * Metric increments for one finished tool call. `previous` is the file's text before a
 * whole-file write (when the caller captured it). Failed calls count nothing, except a
 * failing test run: running the tests is the habit, not passing them.
 */
export function toolGoalProgress({ tool, input, status, previous }) {
  const t = name(tool);
  const completed = status === 'completed';
  if (t === 'edit' && completed) return { lines: changedLines(field(input, 'oldString', 'old_string'), field(input, 'newString', 'new_string')) };
  if (t === 'multiedit' && completed && Array.isArray(input?.edits)) return { lines: input.edits.reduce((sum, e) => sum + changedLines(field(e, 'oldString', 'old_string'), field(e, 'newString', 'new_string')), 0) };
  if (t === 'write' && completed) return { lines: changedLines(previous ?? '', field(input, 'content')) };
  if ((t === 'apply_patch' || t === 'patch') && completed) return { lines: patchLines(field(input, 'patchText', 'patch', 'input')) };
  if (t === 'shell' || t === 'bash') {
    const command = field(input, 'command', 'cmd');
    if (isTestCommand(command) && (completed || status === 'error')) return { tests: 1 };
    if (isCommitCommand(command) && completed) return { commits: 1 };
    return {};
  }
  if (t === 'delivery_check' && (completed || status === 'error')) return { tests: 1 };
  if (t === 'delivery_review' && completed) return { reviews: 1 };
  if (t === 'delivery_finish' && completed && input?.status === 'verified') return { verified: 1 };
  return {};
}

/** Add increments to today's totals, starting over on a new UTC day. */
export function addProgress(state, increments, day) {
  const base = state && state.day === day ? state : { day, metrics: emptyMetrics() };
  const metrics = { ...emptyMetrics(), ...base.metrics };
  for (const [key, value] of Object.entries(increments ?? {})) {
    if (!DAILY_GOAL_METRICS.includes(key) || !Number.isSafeInteger(value) || value <= 0) continue;
    metrics[key] = Math.min(MAX_METRIC, metrics[key] + value);
  }
  return { day, metrics };
}

/** Validate a stored counter file; anything unexpected starts the day over. */
export function readProgress(raw, day) {
  if (!raw || typeof raw !== 'object' || raw.day !== day || !raw.metrics || typeof raw.metrics !== 'object') return { day, metrics: emptyMetrics() };
  const metrics = emptyMetrics();
  for (const key of DAILY_GOAL_METRICS) {
    const value = raw.metrics[key];
    if (Number.isSafeInteger(value) && value >= 0) metrics[key] = Math.min(MAX_METRIC, value);
  }
  return { day, metrics };
}

/** "12/20 lines" or "1 review". */
export function goalProgressLabel(goal) {
  const [one, many] = METRIC_UNITS[goal.metric] ?? ['', ''];
  const shown = Math.min(goal.progress, goal.target);
  return goal.target === 1 ? (goal.completed ? `1 ${one}` : `0/1 ${one}`) : `${shown}/${goal.target} ${many}`;
}

/** A fixed-width text progress bar. */
export function goalBar(goal, width = 12) {
  const filled = goal.completed ? width : Math.max(0, Math.min(width, Math.floor(width * goal.progress / goal.target)));
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

/** Show the larger of the server's stored progress and today's local count. */
export function mergeGoals(goals, local) {
  return goals.map(goal => {
    const progress = Math.min(goal.target, Math.max(goal.progress, local?.metrics?.[goal.metric] ?? 0));
    return { ...goal, progress, completed: goal.completed || progress >= goal.target };
  });
}

export function goalsReset(endsAt, now = Date.now()) {
  const minutes = Math.max(0, Math.ceil((Date.parse(endsAt) - now) / 60000));
  return minutes === 0 ? 'Resetting…' : `New goals in ${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/** "Bigger" / "Stretch" badge for goals that rolled a larger target and reward. */
export function goalTierLabel(goal) {
  return goal?.tier === 'stretch' ? 'Stretch' : goal?.tier === 'bigger' ? 'Bigger' : '';
}

export function completionMessage(goal) {
  const tier = goalTierLabel(goal);
  return `${tier ? `${tier} goal` : 'Daily goal'} done: ${goal.title} · +${goal.coins} coins, +${goal.xp} XP`;
}
