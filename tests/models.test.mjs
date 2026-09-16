import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cycleProvider, filterModelsByProvider, providerForModel, providersFromModels } from '../lib/tui/models.mjs';

const MODELS = [
  { provider: 'deepseek', id: 'deepseek-chat', full: 'deepseek/deepseek-chat' },
  { provider: 'deepseek', id: 'deepseek-reasoner', full: 'deepseek/deepseek-reasoner' },
  { provider: 'openrouter', id: 'anthropic/claude', full: 'openrouter/anthropic/claude' },
  { provider: 'openrouter', id: 'meta/llama', full: 'openrouter/meta/llama' },
];

test('providersFromModels returns sorted unique providers', () => {
  assert.deepEqual(providersFromModels(MODELS), ['deepseek', 'openrouter']);
  assert.deepEqual(providersFromModels([]), []);
  assert.deepEqual(providersFromModels(null), []);
});

test('providerForModel resolves the full id, then bare id, then prefix', () => {
  assert.equal(providerForModel('openrouter/anthropic/claude', MODELS), 'openrouter');
  assert.equal(providerForModel('deepseek-chat', MODELS), 'deepseek');
  // not in the list yet → fall back to the slash prefix
  assert.equal(providerForModel('google/gemini', []), 'google');
  assert.equal(providerForModel('sonnet', []), '');
  assert.equal(providerForModel('', MODELS), '');
});

test('filterModelsByProvider scopes to a provider and matches a query', () => {
  assert.deepEqual(
    filterModelsByProvider(MODELS, 'deepseek', '').map(m => m.id),
    ['deepseek-chat', 'deepseek-reasoner']
  );
  assert.deepEqual(
    filterModelsByProvider(MODELS, 'openrouter', 'llama').map(m => m.id),
    ['meta/llama']
  );
  // no provider filter → all models
  assert.equal(filterModelsByProvider(MODELS, '', '').length, 4);
  // limit is applied
  assert.equal(filterModelsByProvider(MODELS, '', '', 2).length, 2);
});

test('cycleProvider wraps in both directions and handles unknown current', () => {
  const provs = ['a', 'b', 'c'];
  assert.equal(cycleProvider(provs, 'b', 1), 'c');
  assert.equal(cycleProvider(provs, 'c', 1), 'a');
  assert.equal(cycleProvider(provs, 'a', -1), 'c');
  assert.equal(cycleProvider(provs, '', 1), 'b');
  assert.equal(cycleProvider([], 'a', 1), '');
});
