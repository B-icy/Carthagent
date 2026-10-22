# CTG-owned host-controls behavioral proof

`npm run test:owned-host-controls` is a focused Linux acceptance probe for the
owned OpenCode runtime. It uses a disposable host profile/database and an
offline loopback provider. Before invoking the product runtime resolver or
starting the host, it verifies the selected staging artifact's executable bytes
and embedded identity against `CTG_TEST_RUNTIME_RELEASE_MANIFEST`. The same
`runtimeOptions` object (including the explicit staging root and trusted
manifest path) is passed to both `resolveOpenCode()` and `runtimeIdentity()`.
The printed identity comes from the verified artifact and is checked against
the live server's `server.info()` response.

The proof establishes session-specific `ctg.autoCompaction` metadata survives
a service-process restart with the same database, then exercises actual
overflow handling: disabled auto-compaction fails without a summary request;
enabled auto-compaction sends a summary request and retries successfully. It
also runs two concurrent shell tool calls with the same command, checks each
session's successful durable tool result, and matches each provider tool-call ID
to the hook's exact `{sessionID, origin, callID, command}` event. The fixture
uses a Node-based shell command and is explicitly Linux-only; it makes no
cross-platform shell or runtime-selection claim.

This proof does **not** test clear behavior. In particular, it does not invoke
`session.revert.clear`: that endpoint clears staged revert state and is unrelated
to the TUI's visual `/clear` action. No claim about transcript presentation,
visual clearing, or the `/clear` key/action is established here. Stored-message
preservation under a visual clear remains unproven until that TUI behavior is
launched and observed directly.

An example invocation for a trusted local staging artifact is:

```sh
CTG_OWNED_OPENCODE_RUNTIME=/path/to/ctg-runtime \
CTG_TEST_RUNTIME_RELEASE_MANIFEST=/path/to/trusted-runtime-release.json \
npm run test:owned-host-controls
```

The explicit staging artifact is preflighted and reported as such. This is not
evidence that the installed-package default resolver selected that artifact.
