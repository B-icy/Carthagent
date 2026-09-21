# Extending Carthagent

Carthagent has five extension points, listed from simplest to most powerful. Each is a directory of files with a known shape — no build step, no registration call. The first three are pure config; the last two are code.

| Extension point | What it does | Where it lives | Requires code? |
|---|---|---|---|
| **Guidance profile** | Injects domain-specific planning/check/review requirements when a request matches keywords or dependencies | `guidance/profiles/*.json` | No |
| **Prompt template** | Pre-packaged prompt with frontmatter; expanded via `/guide <name> <args>` or the default delivery flow | `prompts/*.md` | No |
| **Skill** | Domain knowledge the agent reads before implementing matching tasks | `skills/<name>/SKILL.md` | No (markdown only) |
| **Provider** | Registers a new AI provider (model gateway, auth, model discovery) | `lib/providers/<name>.mjs` + an extension that calls `registerProvider` | Yes |
| **Extension** | Registers tools, commands, flags, event handlers, and providers into the engine | `extensions/*.ts` | Yes |

---

## Guidance profiles

A guidance profile adds planning, check, and review requirements to the delivery system prompt when a user request matches its keywords or project dependencies. Matching is automatic and happens on every `before_agent_start` event.

**Location:** `guidance/profiles/<id>.json`

**Shape:**

```json
{
  "id": "my-domain",
  "title": "My domain",
  "priority": 50,
  "match": {
    "keywords": ["widget", "gadget"],
    "allKeywords": [],
    "excludeKeywords": ["read-only"],
    "dependencies": ["my-lib", "@scope/my-lib"]
  },
  "activateOnDependency": false,
  "planning": [
    "Plan requirement: separate widget logic from rendering.",
    "Plan requirement: validate gadget input before persistence."
  ],
  "checks": [
    "Check: test widget rendering at narrow and wide widths.",
    "Check: test gadget input with malformed and empty values."
  ],
  "review": [
    "Review: confirm widgets clean up listeners on unmount.",
    "Review: confirm gadget errors do not leak internal state."
  ]
}
```

**Rules** (enforced by `lib/guidance.mjs`):

- `id` — must match `^[a-z][a-z0-9-]{1,39}$` (lowercase, hyphens, 2–40 chars).
- `title` — required string.
- `match.keywords` — required non-empty array; any keyword match activates the profile.
- `match.allKeywords` — optional; if present, *all* must match (AND).
- `match.excludeKeywords` — optional; any match deactivates the profile.
- `match.dependencies` — optional; matched against `package.json` dependency names (case-insensitive).
- `activateOnDependency` — when `true`, a dependency match alone activates the profile even without a keyword match. Default `false`.
- `priority` — higher wins when multiple profiles match; ties break by `id` alphabetical order. Default `0`.
- `planning`, `checks`, `review` — each a required array of non-empty strings.

Profiles are loaded at startup from every `*.json` file in the directory. No restart is needed for content changes — they are read fresh on each session start.

---

## Prompt templates

A prompt template is a markdown file with YAML frontmatter. The body is the prompt; `$@` is replaced with the user's argument when expanded.

**Location:** `prompts/<name>.md`

**Shape:**

```markdown
---
description: Short description shown in the template picker
argument-hint: "<args>"
---
Do this task with evidence: $@

**Phase 1 — Inspect.** Read the repo and relevant APIs.

**Phase 2 — Plan.** Call delivery_plan first.
```

**Conventions:**

- The filename (minus `.md`) is the template name, used as `/guide <name> <args>` or selected in the prompt template picker.
- `$@` is the placeholder for the user's argument. If the template contains `$@`, the argument is substituted in place; otherwise it is appended after a blank line (see `lib/tui/framing.mjs` `framePrompt`).
- Frontmatter is stripped before the prompt is sent to the model (see `lib/tui/framing.mjs` `readTemplate`).
- The default delivery flow uses `prompts/delivery.md` automatically — `framing.mjs` resolves and expands it for every non-slash, non-question prompt unless `--no-guide` is passed.

**The default template** (`prompts/delivery.md`) is the phased delivery pipeline. To change the default flow, edit that file. To add an alternative flow, add a new template and invoke it with `/guide <name>`.

---

## Skills

A skill is a markdown knowledge base the agent reads before implementing matching tasks. The engine discovers skills from the `skills/` directory (passed via `--skill <dir>` in `lib/engine.mjs`).

**Location:** `skills/<name>/SKILL.md`

**Shape:**

```markdown
---
name: my-skill
description: One-line description of when to use this skill. The agent reads this
  to decide whether the skill applies to the current task.
---
# My skill

## When to use
Tasks involving X, Y, or Z.

## How to implement
1. Step one.
2. Step two.

## Pitfalls
- Common mistake and how to avoid it.
```

**Conventions:**

- `name` in frontmatter should match the directory name.
- `description` is what the agent sees in the skills list — make it specific enough that the agent picks it for the right tasks and skips it for the wrong ones.
- The body is plain markdown. Include concrete API names, code patterns, and pitfalls — the agent reads the full file when it decides the skill applies.
- A skill directory can contain additional files (scripts, assets, starter code). Reference them by relative path from the SKILL.md, e.g. `scripts/verify.py` or `assets/starter.py`. The game-development skill uses this pattern — see `skills/game-development/`.

**How the agent discovers skills:** The delivery system prompt (in `extensions/delivery.ts`) tells the agent to "check the available skills list and read the matching skill before implementing." The engine makes the skill list and contents available; no manual invocation is needed.

---

## Providers

A provider connects the engine to an AI model gateway. It defines the base URL, API protocol, authentication (API key or OAuth), model discovery, and the streaming function.

**Location:** `lib/providers/<name>.mjs` (the provider config factory) + an extension in `extensions/<name>.ts` that calls `registerProvider`.

**Provider config shape** (returned by the factory function, see `lib/providers/experiential.mjs`):

```js
export function myProviderConfig({ env = process.env } = {}) {
  return {
    name: 'My Provider',           // display name
    baseUrl: 'https://api.example.com/v1',
    api: 'openai-completions',     // API protocol: 'openai-completions' | 'openai-responses' | ...
    apiKey: '$MY_API_KEY',         // env var name prefixed with $; the engine reads it
    authHeader: true,              // send Authorization: Bearer <key>
    oauth: {                       // optional OAuth flow (omit for API-key-only providers)
      name: 'My Provider account',
      async login(interaction) { /* returns { access, refresh, expiresAt } */ },
      async refreshToken(credentials, signal) { /* returns refreshed credentials */ },
      getApiKey(credentials) { return credentials.access; },
    },
    streamSimple(model, context, options) {
      // Calls the engine's bundled streaming function for this API protocol.
      // For openai-completions: import { streamSimple } from '../../vendor/agent/chunks/openai-completions-*.js'
      return streamOpenAiCompletions(model, context, options);
    },
    models: [],                    // initial model list (empty = discover at runtime)
    async refreshModels(context) {
      // Fetch GET /v1/models with context.credential, return [{ id, name }]
      // context: { stored, credential, allowNetwork, signal }
      // Throw on failure; return stored models if !allowNetwork
    },
  };
}
```

**Extension that registers it** (`extensions/<name>.ts`):

```typescript
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { myProviderConfig, MY_PROVIDER_ID } from '../lib/providers/my-provider.mjs';

export default function myProvider(pi: ExtensionAPI) {
  pi.registerProvider(MY_PROVIDER_ID, myProviderConfig());
}
```

**Wiring it in:** The provider extension must be loaded by the engine. Carthagent loads `extensions/experiential.ts` automatically in `lib/engine.mjs` (`buildEngineArgs`). To load an additional provider extension, either:

1. Add it to `buildEngineArgs` in `lib/engine.mjs` (for always-on providers), or
2. Pass `-e extensions/my-provider.ts` to the engine (for optional providers).

**Key fields:**

- `api` — the streaming protocol. Must match a bundled chunk in `vendor/agent/chunks/`. Common values: `openai-completions`, `openai-responses`.
- `apiKey` — `'$ENV_VAR_NAME'` tells the engine to read the key from that env var. The `$` prefix is required.
- `oauth` — omit for API-key-only providers. When present, the login picker offers the OAuth flow alongside the API-key field.
- `refreshModels(context)` — called on login and model refresh. `context.credential.type` is `'api_key'` or `'oauth'`; `context.credential.key` or `context.credential.access` holds the token. Return `[{ id, name }]`.

---

## Extensions

An extension is a TypeScript module with a default export function that receives the `ExtensionAPI` and registers tools, commands, flags, event handlers, and/or providers.

**Location:** `extensions/<name>.ts`

**Minimal extension** (registers a provider + event handler — see `extensions/experiential.ts`):

```typescript
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

export default function myExtension(pi: ExtensionAPI) {
  pi.on('message_end', (event, ctx) => {
    if (event?.message?.stopReason === 'error') {
      ctx.ui?.notify?.('An error occurred.', 'warning');
    }
  });
}
```

### ExtensionAPI surface

Defined in `types/pi-coding-agent.d.ts`:

| Method | Purpose |
|---|---|
| `pi.registerTool(tool)` | Register a tool the model can call |
| `pi.registerCommand(name, command)` | Register a slash command (`/name`) |
| `pi.registerFlag(name, flag)` | Register a CLI flag (string or boolean) |
| `pi.getFlag(name)` | Read a flag value at runtime |
| `pi.on(event, handler)` | Subscribe to engine events |
| `pi.registerProvider(id, config)` | Register an AI provider |
| `pi.appendEntry(customType, data)` | Persist a custom entry in the session file |
| `pi.sendMessage(message, options?)` | Send a message to the conversation (with optional `triggerTurn`) |

### Registering a tool

Tools use TypeBox for parameter schemas (imported from `typebox`). The `execute` function is async and returns `{ content: [{ type: 'text', text }], isError? }`.

```typescript
import { Type } from 'typebox';
import type { ExtensionAPI, ExtensionToolResult } from '@earendil-works/pi-coding-agent';

export default function myExtension(pi: ExtensionAPI) {
  pi.registerTool({
    name: 'my_tool',
    label: 'My tool',
    description: 'Does something useful. The model reads this to decide when to call it.',
    parameters: Type.Object({
      path: Type.String({ minLength: 1, maxLength: 500 }),
      verbose: Type.Optional(Type.Boolean()),
    }),
    async execute(id, params, signal, onUpdate, ctx): Promise<ExtensionToolResult> {
      // params is typed by the TypeBox schema above
      // signal is an AbortSignal; check it for long operations
      // onUpdate(result?) streams partial results to the UI (optional)
      // ctx: { cwd, hasUI, sessionManager, ui, ... }

      const result = `Processed ${params.path}`;
      return { content: [{ type: 'text', text: result }] };
    },
  });
}
```

**Tool conventions:**

- `name` — snake_case, used as the tool call name.
- `description` — the model's only guidance for when and how to call the tool. Be specific about preconditions and what it returns.
- `parameters` — a TypeBox `Type.Object(...)`. The engine validates calls against this schema before `execute` runs.
- `execute(id, params, signal, onUpdate, ctx)` — `id` is the call ID; `signal` is an `AbortSignal` (check `signal.aborted` for long operations); `onUpdate` streams partial results; `ctx.cwd` is the workspace, `ctx.sessionManager` gives session access.
- Return `{ content: [{ type: 'text', text }], isError?: true }`. Use `truncateTail` from the engine API for large outputs.

### Registering a slash command

```typescript
pi.registerCommand('my-command', {
  description: 'Do something',
  handler(args, ctx) {
    // args is the raw string after the command name
    // ctx has the same shape as tool ctx
    pi.sendMessage({ customType: 'my-command', display: true, content: `Ran with: ${args}` });
  },
});
```

### Registering a flag

```typescript
pi.registerFlag('my-flag', {
  description: 'A string flag that controls behavior',
  type: 'string',          // or 'boolean'
  default: 'default-value', // omit for boolean flags
});
```

Read it at runtime with `pi.getFlag('my-flag')`.

### Event handlers

Common events (see `extensions/delivery.ts` for full usage):

| Event | When | Handler return |
|---|---|---|
| `session_start` | Session begins or resumes | — |
| `session_tree` | Session tree rebuilt (e.g. after compaction) | — |
| `session_shutdown` | Session ends | — |
| `agent_start` | A model turn begins | — |
| `before_agent_start` | Before a turn; can inject system prompt | `{ systemPrompt: '...' }` |
| `input` | User input received | `{ action: 'continue' }` to proceed |
| `context` | Context assembled (e.g. after compaction) | `{ messages: [...] }` to inject |
| `tool_call` | Before a tool executes | `{ block: true, reason: '...' }` to block |
| `message_end` | A message completes | — |

The `tool_call` event can mutate or block tool calls — `delivery.ts` uses this to enforce plan-before-write and cap shell timeouts. Return `{ block: true, reason: '...' }` to prevent execution.

### Loading an extension

Extensions are loaded via the engine's `-e` flag. Carthagent's `lib/engine.mjs` (`buildEngineArgs`) automatically loads `extensions/experiential.ts` and, when delivery is enabled, `extensions/delivery.ts`. To load a custom extension:

- **Always-on:** add `args.push('-e', join(ROOT, 'extensions', 'my-extension.ts'))` to `buildEngineArgs` in `lib/engine.mjs`.
- **Per-run:** pass `-e extensions/my-extension.ts` to the engine, or `--no-extensions` to skip all extensions.

### Type checking

Extensions are type-checked by `npm run typecheck` (tsc with `types/pi-coding-agent.d.ts`). Run `npm run lint` before committing — it runs both eslint and typecheck. The type definitions in `types/pi-coding-agent.d.ts` are ambient; at runtime the bundled engine aliases `@earendil-works/pi-coding-agent` to its own exports, so extensions never resolve an external package.

---

## Testing extensions

Extension tests live in `tests/extension.test.mjs`. The pattern uses `jiti` to load the TypeScript extension without a build step, and a fake `ExtensionAPI` object to capture registrations:

```javascript
const jiti = createJiti(import.meta.url, {
  alias: {
    typebox: requireEngine.resolve('typebox'),
    '@earendil-works/pi-coding-agent': fileURLToPath(new URL('../vendor/agent/index.js', import.meta.url)),
  },
});
const factory = await jiti.import(fileURLToPath(new URL('../extensions/my-extension.ts', import.meta.url)), { default: true });

const hooks = {}, commands = {}, tools = {};
const engine = {
  registerCommand(name, command) { commands[name] = command; },
  registerFlag() {}, getFlag: () => undefined,
  on(name, fn) { hooks[name] = fn; },
  registerTool(tool) { tools[tool.name] = tool; },
  appendEntry() {}, sendMessage() {},
};
factory(engine);

// Now assert tools/commands were registered
assert.ok(tools.my_tool);
assert.ok(commands['my-command']);
```

Run the full suite with `npm test` (or `node --test tests/*.test.mjs`).
