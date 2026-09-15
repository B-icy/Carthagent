/**
 * Self-review loop: after a substantial change, the user can opt in to a
 * PR ↔ fresh-context review ↔ fixes loop. The current agent pushes a branch
 * and opens a PR; `pi2 review <pr>` then runs a brand-new agent process with
 * no shared context to review it, and the working agent applies the findings.
 *
 * Default behavior is a single tri-state: ask (offer at the end of a major
 * change), yes (always start the loop), no (never). Resolution order:
 * explicit flag (--review / --delivery-review) > ~/.pi2/config.json > 'ask'.
 */
import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import { atomicJson } from './delivery.mjs';

export const REVIEW_MODES = ['ask', 'yes', 'no'];
/** Hard cap on reviewer runs per loop — enforced by the delivery extension. */
export const MAX_REVIEW_ROUNDS = 3;

export function normalizeReviewMode(value) {
  const s = String(value ?? '').trim().toLowerCase();
  return REVIEW_MODES.includes(s) ? s : null;
}

/** pi2's user-level config file (PI2_CONFIG overrides for tests). */
export function pi2ConfigPath() {
  return process.env.PI2_CONFIG || join(os.homedir(), '.pi2', 'config.json');
}

export function loadPi2Config(path = pi2ConfigPath()) {
  try {
    const data = JSON.parse(readFileSync(path, 'utf8'));
    return data && typeof data === 'object' ? data : {};
  } catch {
    return {};
  }
}

/** Merge a patch into ~/.pi2/config.json atomically. Returns the new config. */
export function savePi2Config(patch, path = pi2ConfigPath()) {
  const config = { ...loadPi2Config(path), ...patch };
  atomicJson(path, config);
  return config;
}

/** flag (explicit CLI/extension flag) > config file > 'ask'. */
export function resolveReviewMode(flagValue, config = loadPi2Config()) {
  return normalizeReviewMode(flagValue) ?? normalizeReviewMode(config?.review) ?? 'ask';
}

/**
 * Pure offer predicate shared by the extension and the console: a self-review
 * offer is only made in ask mode, once per run, when the run produced a
 * verified delivery or real file edits, and no loop is already active.
 */
export function shouldOfferReview({ mode, verified, writes, loopActive, offeredRuns, runKey }) {
  if (mode !== 'ask' || loopActive) return false;
  if (!verified && !(writes > 0)) return false;
  return !(offeredRuns?.has?.(runKey));
}

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PI2_BIN = join(ROOT, 'bin', 'pi2.mjs');

/**
 * Instructions handed to the working agent when a review loop starts (via the
 * extension's kickoff message or the console's /review + ^y paths).
 */
export function reviewKickoff(pi2Bin = PI2_BIN) {
  return `The user opted in to a self-review loop — run it now.

1. Commit the finished work on a review branch (never the default branch), push it, and open a pull request (\`gh pr create --fill\` or equivalent). If the workspace is not a git repo, has no remote, or \`gh\` is unavailable/unauthenticated, tell the user and stop — do not simulate a review.
2. Run: node "${pi2Bin}" review <pr-number-or-url>
   This spawns a fresh-context reviewer that inspects the PR and prints prioritized findings, ending with VERDICT: APPROVE (exit 0) or VERDICT: CHANGES-REQUESTED (exit 1).
3. On CHANGES-REQUESTED: address each finding, commit, push, and run the same review command again on the same PR. On APPROVE: summarize the outcome and stop.
4. Stop after at most ${MAX_REVIEW_ROUNDS} review rounds — further reviewer runs are blocked by the delivery extension, so summarize any remaining findings for the user instead of looping forever.`;
}

/** Prompt for the detached fresh-context reviewer subprocess (`pi2 review <pr>`). */
export function reviewerPrompt({ prRef, cwd, meta = {} }) {
  const context = [
    meta.title ? `PR title: ${meta.title}` : '',
    meta.url ? `PR url: ${meta.url}` : '',
    meta.headRefName ? `branches: ${meta.headRefName} → ${meta.baseRefName}` : '',
  ].filter(Boolean).join('\n');
  return `You are a fresh-context code reviewer. Review pull request ${JSON.stringify(String(prRef))} in the repository at ${JSON.stringify(cwd)}.
${context ? context + '\n' : ''}
Inspect the change with \`gh pr view\`, \`gh pr diff\` and \`gh pr checks\` for this PR, and read the touched files in the working tree for surrounding context. Do not modify files, commit, push, or check out branches — review only.

Hunt for: correctness bugs and broken edge cases, security issues, missing test coverage for changed behavior, and violations of this repository's existing conventions. Skip style nitpicks that tooling already enforces. Verify every claim against the actual code before reporting it — no speculative findings.

Report format: a prioritized findings list, each entry \`file:line — severity — issue — suggested fix\` (mark uncertain findings as uncertain). Put the complete findings list at the END of your reply so it survives output truncation, then finish with exactly one line:
VERDICT: APPROVE — no blocking findings
VERDICT: CHANGES-REQUESTED — at least one blocking finding`;
}

/** Extract the reviewer's verdict from its output tail — the LAST VERDICT line
 *  wins, so format examples quoted earlier can't shadow the real verdict. */
export function parseVerdict(output) {
  const matches = [...String(output ?? '').matchAll(/VERDICT:\s*(APPROVE|CHANGES-REQUESTED)/gi)];
  const last = matches.at(-1);
  return last ? last[1].toUpperCase() : null;
}
