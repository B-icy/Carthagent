import { Rpc } from '@opencode/plugin/rpc';

const errors = {
  wrong_workspace: {
    type: 'object', properties: { sessionID: { type: 'string' } },
    required: ['sessionID'], additionalProperties: false,
  },
} as const;

export const SessionControls = Rpc.define({
  id: 'carthagent.session',
  methods: {
    framing: {
      input: {
        type: 'object', properties: { sessionID: { type: 'string', minLength: 1 }, enabled: { type: 'boolean' } },
        required: ['sessionID'], additionalProperties: false,
      },
      output: { type: 'object', properties: { enabled: { type: 'boolean' } }, required: ['enabled'], additionalProperties: false },
      errors,
    },
    compact: {
      input: {
        type: 'object', properties: { sessionID: { type: 'string', minLength: 1 }, notes: { type: 'string', maxLength: 16000 } },
        required: ['sessionID'], additionalProperties: false,
      },
      output: { type: 'object', properties: { admitted: { type: 'boolean' } }, required: ['admitted'], additionalProperties: false },
      errors,
    },
  },
  events: {},
});
