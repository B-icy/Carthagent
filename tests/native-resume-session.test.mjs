import assert from 'node:assert/strict';
import test from 'node:test';
import { findNativeResumeSession } from '../plugins/carthagent/src/ui/resume-session.mjs';

test('resume finds ID prefixes outside the server title-search results', async () => {
  const calls = [];
  const byPrefix = { id: 'ses_abc123', title: 'An unrelated session title', time: { updated: 2 } };
  const byTitle = { id: 'ses_xyz789', title: 'Parser implementation', time: { updated: 1 } };
  const client = {
    session: {
      async get() { throw new Error('not an exact ID'); },
      async list(input) {
        calls.push(input);
        const rows = input.search ? [byTitle] : [byPrefix];
        return { data: rows, cursor: { next: null } };
      },
    },
  };

  assert.equal((await findNativeResumeSession({ query: 'ses_abc', directory: '/repo', client })).id, byPrefix.id);
  assert.equal(calls[0].search, undefined, 'ID prefix lookup first uses unfiltered listing');
});

test('resume falls back to title search after an unfiltered ID-prefix miss', async () => {
  const calls = [];
  const byTitle = { id: 'ses_xyz789', title: 'Parser implementation', time: { updated: 1 } };
  const client = {
    session: {
      async get() { throw new Error('not an exact ID'); },
      async list(input) {
        calls.push(input);
        return { data: input.search ? [byTitle] : [], cursor: { next: null } };
      },
    },
  };
  assert.equal((await findNativeResumeSession({ query: 'parser', directory: '/repo', client })).id, byTitle.id);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].search, 'parser');
});

test('resume rejects sessions from another project location', async () => {
  const client = { session: {
    get: async () => ({ id: 'ses_exact', location: { directory: '/other' } }),
    list: async () => ({ data: [], cursor: { next: null } }),
  } };
  assert.equal(await findNativeResumeSession({ query: 'ses_exact', directory: '/repo', client }), undefined);
});
