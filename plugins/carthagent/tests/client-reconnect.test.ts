import { expect, test } from "bun:test";
import type { Context } from "@opencode/plugin/tui/context";
import { archiveClient, dailyGoalsClient, dailySourceClient, isLocationNotFound, pullRequestClient, sessionControls, shipClient, voyagesClient, workspaceClient } from "../src/ui/client.js";

test.each([dailyGoalsClient, voyagesClient])("mounted page RPC reads follow the current client after service replacement", async (makeClient) => {
  const calls: string[] = [];
  const service = (name: string) => ({ rpc: () => ({ snapshot: async () => { calls.push(name); return {}; } }) });
  let client = service("before");
  const context = { get client() { return client; }, location: { directory: "/fixture" } } as unknown as Context;
  const page = makeClient(context);
  await page.snapshot();
  client = service("after");
  await page.snapshot();
  expect(calls).toEqual(["before", "after"]);
});

test.each([
  ["daily source", (context: Context) => { const page = dailySourceClient(context); return () => page.report({ sessionID: "fixture" }); }],
  ["workspace", (context: Context) => { const page = workspaceClient(context); return () => page.snapshot(); }],
  ["session", (context: Context) => { const page = sessionControls(context); return () => page.framing({ sessionID: "fixture" }); }],
  ["pull requests", (context: Context) => { const page = pullRequestClient(context); return () => page.list({ sessionID: "fixture", taskID: "task" }); }],
  ["ship", (context: Context) => { const page = shipClient(context); return () => page.account(); }],
  ["archive", (context: Context) => { const page = archiveClient(context); return () => page.list(); }],
] as const)("%s reads use the replacement service without remounting", async (_name, mount) => {
  const calls: string[] = [];
  const service = (name: string) => ({ rpc: () => new Proxy({}, { get: () => async () => { calls.push(name); return {}; } }) });
  let client = service("before");
  const context = { get client() { return client; }, location: { directory: "/fixture" } } as unknown as Context;
  const read = mount(context);
  await read();
  client = service("after");
  await read();
  expect(calls).toEqual(["before", "after"]);
});

const launch = { directory: "/launch" };
const deleted = { directory: "/deleted-worktree" };
const missing = () => Object.assign(new Error("Location not found"), { _tag: "LocationNotFoundError", name: "LocationNotFoundError" });

function locationContext(fail: (directory: string) => unknown) {
  const seen: string[] = [];
  const client = { rpc: () => new Proxy({}, { get: (_target, method) => async (_input: unknown, options: { location: { directory: string } }) => {
    seen.push(`${String(method)}@${options.location.directory}`);
    const error = fail(options.location.directory);
    if (error) throw error;
    return { ok: true };
  } }) };
  const context = { client, location: deleted, data: { location: { default: () => launch } } } as unknown as Context;
  return { context, seen };
}

test("isLocationNotFound recognizes the generated client's declared error", () => {
  expect(isLocationNotFound(missing())).toBe(true);
  expect(isLocationNotFound({ _tag: "LocationNotFoundError" })).toBe(true);
  expect(isLocationNotFound(new Error("Location not found"))).toBe(false);
  expect(isLocationNotFound({ type: "voyagesError", data: { code: "authentication_required" } })).toBe(false);
  expect(isLocationNotFound(undefined)).toBe(false);
});

test.each([
  ["voyages snapshot", (context: Context) => voyagesClient(context, deleted).snapshot(), "snapshot"],
  ["voyages purchase", (context: Context) => voyagesClient(context, deleted).purchase({ quoteId: "q" }), "purchase"],
  ["daily goals", (context: Context) => dailyGoalsClient(context, () => deleted).snapshot(), "snapshot"],
  ["cloud account", (context: Context) => shipClient(context, deleted).account(), "shipAccount"],
  ["archive", (context: Context) => archiveClient(context, deleted).list(), "list"],
] as const)("%s retries once at the launch location when the session folder is gone", async (_name, call, method) => {
  const { context, seen } = locationContext((directory) => (directory === deleted.directory ? missing() : undefined));
  expect(await call(context)).toEqual({ ok: true });
  expect(seen).toEqual([`${method}@/deleted-worktree`, `${method}@/launch`]);
});

test("other failures, rewards and launch-location misses are not retried", async () => {
  const auth = { type: "voyagesError", data: { code: "authentication_required" } };
  const signedOut = locationContext(() => auth);
  await expect(voyagesClient(signedOut.context, deleted).snapshot()).rejects.toBe(auth);
  expect(signedOut.seen).toEqual(["snapshot@/deleted-worktree"]);

  const rewards = locationContext(() => missing());
  await expect(voyagesClient(rewards.context, deleted).previewReward({ sessionID: "s" })).rejects.toMatchObject({ _tag: "LocationNotFoundError" });
  expect(rewards.seen).toEqual(["previewReward@/deleted-worktree"]);

  const everywhere = locationContext(() => missing());
  await expect(dailyGoalsClient(everywhere.context, launch).snapshot()).rejects.toMatchObject({ _tag: "LocationNotFoundError" });
  expect(everywhere.seen).toEqual(["snapshot@/launch"]);
});
