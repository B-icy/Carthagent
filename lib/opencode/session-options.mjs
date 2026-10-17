import { resolve } from 'node:path';
import { validateBudgetOptions } from '../budget.mjs';

export const SESSION_OPTIONS_KEY = 'carthagent.options';
const booleans = ['delivery', 'guide', 'strict', 'isolate', 'protectExisting'];
const integers = ['maxTools', 'maxSeconds', 'maxRepairs', 'codegraphMaxFiles', 'rewriteCap', 'toolOutputCap'];
const paths = ['validators', 'context'];

/** Only delivery runtime settings belong here; credentials and UI choices do not. */
export function normalizeSessionOptions(input = {}, cwd = process.cwd()) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('Session options must be an object');
  const result = {};
  for (const key of booleans) {
    if (input[key] === undefined) continue;
    if (typeof input[key] !== 'boolean') throw new TypeError(`${key} must be boolean`);
    result[key] = input[key];
  }
  for (const key of integers) {
    if (input[key] === undefined) continue;
    const minimum = key === 'codegraphMaxFiles' ? 1 : 0;
    if (!/^\d+$/.test(String(input[key])) || !Number.isSafeInteger(Number(input[key])) || Number(input[key]) < minimum || Number(input[key]) > 1_000_000) {
      throw new TypeError(`${key} must be an integer from ${minimum} to 1000000`);
    }
    result[key] = Number(input[key]);
  }
  if (input.bashCap !== undefined) {
    const cap = Number(input.bashCap);
    if (!Number.isFinite(cap) || cap <= 0 || !/^\d+(?:\.\d+)?$/.test(String(input.bashCap))) throw new TypeError('bashCap must be a positive number');
    result.bashCap = cap;
  }
  for (const key of paths) {
    if (input[key] === undefined) continue;
    if (typeof input[key] !== 'string' || !input[key].trim()) throw new TypeError(`${key} must be a nonempty path`);
    result[key] = resolve(cwd, input[key]);
  }
  if (input.workflow !== undefined) {
    if (!['standard', 'strict'].includes(input.workflow)) throw new TypeError('workflow must be standard or strict');
    result.workflow = input.workflow;
  }
  if (input.review !== undefined) {
    if (!['ask', 'yes', 'no'].includes(input.review)) throw new TypeError('review must be ask, yes or no');
    result.review = input.review;
  }
  validateBudgetOptions(result, { allowWithoutDelivery: true });
  return result;
}

/** Resolve defaults without mutating shared location options across sessions. */
export function effectiveSessionOptions(session, defaults = {}) {
  const cwd = session?.location?.directory;
  if (typeof cwd !== 'string' || !cwd) throw new TypeError('Session requires an explicit workspace location');
  const overrides = session.metadata?.[SESSION_OPTIONS_KEY];
  if (overrides !== undefined && (!overrides || typeof overrides !== 'object' || Array.isArray(overrides))) throw new TypeError('Invalid persisted Carthagent session options');
  const result = normalizeSessionOptions({ ...defaults, ...overrides }, cwd);
  return { delivery: true, guide: true, strict: true, workflow: 'standard', ...result };
}

export function sessionOptionsMetadata(options, cwd, metadata = {}) {
  return { ...metadata, [SESSION_OPTIONS_KEY]: normalizeSessionOptions(options, cwd) };
}
