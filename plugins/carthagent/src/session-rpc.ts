import { Rpc } from '@opencode/plugin/rpc';

export const SessionControls = Rpc.define({
  id: 'carthagent.session',
  methods: {
    framing: {
      input: {
        type: 'object', properties: { sessionID: { type: 'string', minLength: 1 }, enabled: { type: 'boolean' } },
        required: ['sessionID'], additionalProperties: false,
      },
      output: { type: 'object', properties: { enabled: { type: 'boolean' } }, required: ['enabled'], additionalProperties: false },
    },
    compact: {
      input: {
        type: 'object', properties: { sessionID: { type: 'string', minLength: 1 }, notes: { type: 'string', maxLength: 16000 } },
        required: ['sessionID'], additionalProperties: false,
      },
      output: { type: 'object', properties: { admitted: { type: 'boolean' } }, required: ['admitted'], additionalProperties: false },
    },
  },
  events: {},
});
