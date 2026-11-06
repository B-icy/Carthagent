import { expect, test } from "bun:test";
import type { Context } from "@opencode/plugin/tui/context";
import { archiveClient, dailyQuestsClient, dailySourceClient, pullRequestClient, sessionControls, shipClient, voyagesClient, workspaceClient } from "../src/ui/client.js";

test.each([dailyQuestsClient, voyagesClient])("mounted page RPC reads follow the current client after service replacement", async (makeClient) => {
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
