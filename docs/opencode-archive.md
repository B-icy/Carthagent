# Native legacy archive RPC

`carthagent.archive` exposes the old Pi session JSONL transcripts as an explicitly read-only archive. It never writes to them and never treats an archive as a live OpenCode session. Clients call `list`, `search`, `read`, or `export` using an opaque SHA-256 transcript ID returned by `list`/`search`; filesystem paths are not part of the RPC contract. Export returns JSON or original JSONL content to the client. Any HTML rendering or save destination is a client responsibility.

## Root configuration and limits

The host registers the RPC with trusted server-side options: `registerArchive(ctx, { archiveRoots: ['/absolute/path', ...] })`, or the legacy single `archiveDir`. Caller-supplied roots and paths are never accepted. If no option is configured, the server reads `~/.carthagent/agent/sessions` using the runtime's original `HOME` (not the isolated OpenCode data home). No shared environment discovery is performed. Roots must be normalized absolute paths. Symlinks are skipped and canonical file paths are checked against their configured root.

Operations are synchronous filesystem reads and check RPC cancellation immediately before and after; cancellation cannot interrupt an OS-level synchronous read. Every transcript is capped at 4,000,000 bytes, each scan at 2,000 files and 50,000,000 total bytes, and list/search pages at 100 items. Search queries are limited to 200 characters and excerpts to 400 characters. `read` preserves all valid parsed JSONL records and reports malformed line numbers; `archiveOnly: true` marks its non-live status. Expected invalid IDs, roots, oversized archives, and formats raise descriptive errors rather than exposing raw server paths in client arguments.
