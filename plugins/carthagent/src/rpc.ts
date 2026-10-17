import { Rpc } from '@opencode/plugin/rpc';

/** Public CTG protocol. Clients use snapshots after reconnect, never event replay. */
export const Carthagent = Rpc.define({
  id: 'carthagent',
  methods: {
    health: {
      input: { type: 'object', additionalProperties: false },
      output: {
        type: 'object',
        properties: {
          protocol: { type: 'integer', const: 1 },
          hostVersion: { type: 'string' },
          directory: { type: 'string' },
        },
        required: ['protocol', 'hostVersion', 'directory'],
        additionalProperties: false,
      },
    },
    echo: {
      input: {
        type: 'object',
        properties: { text: { type: 'string' } },
        required: ['text'],
        additionalProperties: false,
      },
      output: {
        type: 'object',
        properties: { text: { type: 'string' } },
        required: ['text'],
        additionalProperties: false,
      },
    },
  },
  events: {
    changed: {
      schema: {
        type: 'object',
        properties: {
          sessionID: { type: 'string' },
          domain: { type: 'string' },
        },
        required: ['domain'],
        additionalProperties: false,
      },
    },
  },
});
