import assert from "node:assert/strict";
import { test } from "node:test";
import { setSessionAutoCompaction } from "../src/ui/session-preferences.mjs";

test("autocompact persists explicit, idempotent session preferences without replacing neighbor metadata", async () => {
  let current = { "ctg.autoCompaction": false, "ctg.raw": true, "user.flag": "keep" };
  const updates = [];
  const client = {
    async get(input, options) {
      assert.equal(input.sessionID, "s1");
      assert.equal(options.location.directory, "/project");
      assert.ok(options.signal instanceof AbortSignal);
      return { metadata: current };
    },
    async update(input, options) {
      assert.equal(input.sessionID, "s1");
      assert.equal(options.location.directory, "/project");
      current = input.metadata;
      updates.push(input.metadata);
    },
  };
  const location = { directory: "/project" };
  assert.equal(await setSessionAutoCompaction(client, "s1", location, "off"), false);
  assert.equal(updates.length, 0, "repeating off must not write");
  assert.equal(await setSessionAutoCompaction(client, "s1", location, "on"), true);
  assert.deepEqual(current, { "ctg.raw": true, "user.flag": "keep" });
  assert.equal(await setSessionAutoCompaction(client, "s1", location, "toggle"), false);
  assert.deepEqual(current, { "ctg.autoCompaction": false, "ctg.raw": true, "user.flag": "keep" });
  assert.equal(await setSessionAutoCompaction(client, "s1", location, "toggle"), true);
  assert.equal(updates.length, 3);
});

test("invalid autocompact arguments fail before reading or mutating session state", async () => {
  let calls = 0;
  const client = {
    async get() { calls++; throw new Error("must not read"); },
    async update() { calls++; throw new Error("must not update"); },
  };
  await assert.rejects(setSessionAutoCompaction(client, "s1", { directory: "/project" }, "sometimes"), /Usage: \/autocompact \[on\|off\]/);
  assert.equal(calls, 0);
});
