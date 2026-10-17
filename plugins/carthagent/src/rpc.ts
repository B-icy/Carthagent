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
            capabilities: { type: 'array', items: { type: 'string', enum: ['delivery.session-options.v1', 'delivery.budgets.v1', 'delivery.policy-overrides.v1'] }, uniqueItems: true },
          },
        required: ['protocol', 'hostVersion', 'directory'],
        additionalProperties: false,
      },
    },
    budgetStatus: {
      input: {
        type: 'object', properties: { sessionID: { type: 'string', minLength: 1 } },
        required: ['sessionID'], additionalProperties: false,
      },
      output: {
        type: 'object', properties: {
          tools: { type: 'integer', minimum: 0 },
          maxTools: { type: 'integer', minimum: 0 },
          seconds: { type: 'integer', minimum: 0 },
          maxSeconds: { type: 'integer', minimum: 0 },
          repairs: { type: 'integer', minimum: 0 },
          maxRepairs: { type: 'integer', minimum: 0 },
          stopped: { type: ['string', 'null'], enum: ['elapsed-time', 'tool-calls', 'repair-rounds', null] },
        },
        required: ['tools', 'maxTools', 'seconds', 'maxSeconds', 'repairs', 'maxRepairs', 'stopped'],
        additionalProperties: false,
      },
      errors: {
        budgetUnavailable: {
          type: 'object', properties: { reason: { type: 'string', enum: ['wrong-location', 'not-initialized'] } },
          required: ['reason'], additionalProperties: false,
        },
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
    authStart: {
      input: { type: 'object', additionalProperties: false },
      output: {
        type: 'object',
        properties: {
          flowId: { type: 'string' },
          userCode: { type: 'string' },
          verificationUri: { type: 'string' },
          expiresAt: { type: 'integer' },
        },
        required: ['flowId', 'userCode', 'verificationUri', 'expiresAt'],
        additionalProperties: false,
      },
    },
    authCancel: {
      input: {
        type: 'object',
        properties: { flowId: { type: 'string' } },
        required: ['flowId'],
        additionalProperties: false,
      },
      output: {
        type: 'object',
        properties: { cancelled: { type: 'boolean' } },
        required: ['cancelled'],
        additionalProperties: false,
      },
    },
    shipAccount: {
      input: { type: 'object', additionalProperties: false },
      output: { type: 'object', properties: { account: { type: 'object', additionalProperties: true }, error: { type: 'string' } }, required: ['account'], additionalProperties: false },
      errors: { unauthenticated: { type: 'object', properties: {}, additionalProperties: false } },
    },
    shipBilling: {
      input: { type: 'object', properties: { action: { type: 'string', enum: ['checkout', 'portal'] } }, required: ['action'], additionalProperties: false },
      output: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'], additionalProperties: false },
      errors: { unauthenticated: { type: 'object', properties: {}, additionalProperties: false } },
    },
    shipLogout: {
      input: { type: 'object', properties: { session: { type: 'string', minLength: 1, maxLength: 128 } }, additionalProperties: false },
      output: { type: 'object', properties: { revoked: { type: 'boolean' }, credentialID: { type: 'string' } }, required: ['revoked'], additionalProperties: false },
      errors: { unauthenticated: { type: 'object', properties: {}, additionalProperties: false } },
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
