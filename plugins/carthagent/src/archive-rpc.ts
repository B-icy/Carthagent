import { Rpc } from '@opencode/plugin/rpc';

const id = { type: 'string', minLength: 1, maxLength: 128 } as const;
const page = { type: 'integer', minimum: 0, maximum: 1_000_000 } as const;
const limit = { type: 'integer', minimum: 1, maximum: 100 } as const;
const item = {
  type: 'object', properties: {
    id, createdAt: {}, messageCount: { type: 'integer', minimum: 0 }, malformedLines: { type: 'array', items: { type: 'object', properties: { line: { type: 'integer', minimum: 1 } }, required: ['line'], additionalProperties: false } }, moreMalformedLines: { type: 'boolean' },
    excerpt: { type: 'string' }, archiveOnly: { type: 'boolean', const: true },
  }, required: ['id', 'messageCount', 'malformedLines', 'moreMalformedLines', 'archiveOnly'], additionalProperties: false,
} as const;
const errors = {
  archive_error: {
    type: 'object', properties: {
      code: { type: 'string', enum: ['invalid_request', 'not_found', 'limit_exceeded', 'archive_io'] },
    }, required: ['code'], additionalProperties: false,
  },
} as const;

/** Opaque-ID-only contract. Clients never provide filesystem paths. */
export const Archive = Rpc.define({
  id: 'carthagent.archive',
  methods: {
    list: {
      errors,
      input: { type: 'object', properties: { offset: page, limit }, additionalProperties: false },
      output: { type: 'object', properties: { items: { type: 'array', items: item }, total: { type: 'integer', minimum: 0 }, offset: page, limit }, required: ['items', 'total', 'offset', 'limit'], additionalProperties: false },
    },
    search: {
      errors,
      input: { type: 'object', properties: { query: { type: 'string', minLength: 1, maxLength: 200 }, offset: page, limit }, required: ['query'], additionalProperties: false },
      output: { type: 'object', properties: { items: { type: 'array', items: item }, total: { type: 'integer', minimum: 0 }, offset: page, limit }, required: ['items', 'total', 'offset', 'limit'], additionalProperties: false },
    },
    read: {
      errors,
      input: { type: 'object', properties: { id }, required: ['id'], additionalProperties: false },
      output: { type: 'object', properties: { id, records: { type: 'array', items: {} }, malformedLines: item.properties.malformedLines, moreMalformedLines: { type: 'boolean' }, archiveOnly: { type: 'boolean', const: true } }, required: ['id', 'records', 'malformedLines', 'moreMalformedLines', 'archiveOnly'], additionalProperties: false },
    },
    export: {
      errors,
      input: { type: 'object', properties: { id, format: { type: 'string', enum: ['json', 'jsonl'] } }, required: ['id'], additionalProperties: false },
      output: { type: 'object', properties: { id, format: { type: 'string', enum: ['json', 'jsonl'] }, content: { type: 'string', maxLength: 5_000_000 }, archiveOnly: { type: 'boolean', const: true } }, required: ['id', 'format', 'content', 'archiveOnly'], additionalProperties: false },
    },
  },
  events: {},
});
