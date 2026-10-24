import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { join } from 'node:path';
import type { Context } from '@opencode/plugin/promise/plugin';
import { CloudClient, cloudControlUrl } from '../../../../lib/cloud/client.mjs';
import { atomicWrite, runtimePaths, withFileLock } from '../../../../lib/opencode/runtime.mjs';
import { Voyages, voyagesSlots, voyagesAppearance, type VoyagesProfile, type VoyagesItem, type VoyagesQuote, type VoyagesPending } from '../voyages-rpc';

type Port = Pick<Context, 'integration'>;
type Call = import('@opencode/plugin/promise/rpc').RpcCallContext<typeof Voyages.methods.snapshot>;
type CloudPort = { request(path: string, options: { method: string; accessToken: string; signal: AbortSignal; body?: unknown }): Promise<unknown> };
type Pending = VoyagesPending & { key: string };
type State = { quotes: VoyagesQuote[]; pending?: Pending };
class Failure extends Error {
  constructor(readonly code: string, readonly status = 0, readonly uncertain = false) { super(code); }
}
const codes = new Set(('authentication_required invalid_token expired_token revoked_token reauthentication_required insufficient_scope milestone_locked purchase_required insufficient_coins profile_not_found not_found not_available version_conflict already_owned quote_expired terms_changed quote_consumed key_conflict rate_limited quote_limit voyages_unavailable internal_error invalid_body unknown_field version_required invalid_name invalid_config invalid_item invalid_id invalid_key wallet_limit').split(' '));
const noDebit = new Set(('invalid_body unknown_field invalid_id invalid_key milestone_locked insufficient_coins not_found not_available already_owned quote_expired terms_changed authentication_required invalid_token expired_token revoked_token reauthentication_required insufficient_scope').split(' '));
type Journal = { get(file: string): Promise<unknown>; set(file: string, state: State): Promise<void> };
const fileJournal: Journal = {
  async get(file) {
    let handle;
    try { handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
    try {
      const details = await handle.stat();
      check(details.isFile() && details.size <= 65536);
      const bytes = Buffer.alloc(65537);
      const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
      check(bytesRead <= 65536 && bytesRead === details.size);
      return JSON.parse(bytes.toString('utf8', 0, bytesRead));
    } finally { await handle.close(); }
  },
  async set(file, state) {
    const contents = JSON.stringify(state); check(Buffer.byteLength(contents) <= 65536);
    await atomicWrite(file, contents, 0o600);
    // Persist the rename as well as the file bytes on POSIX filesystems.
    if (process.platform !== 'win32') {
      const directory = await open(join(file, '..'), 'r');
      try { await directory.sync(); } finally { await directory.close(); }
    }
  },
};
function check(ok: unknown): asserts ok { if (!ok) throw new Failure('invalid_response'); }
function obj(value: unknown): Record<string, unknown> { check(value && typeof value === 'object' && !Array.isArray(value)); return value as Record<string, unknown>; }
function str(value: unknown, max = 128): string { check(typeof value === 'string' && value.length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value)); return value; }
function int(value: unknown, min = 0): number { check(typeof value === 'number' && Number.isSafeInteger(value) && value >= min); return value; }
function num(value: unknown): number { check(typeof value === 'number' && Number.isFinite(value) && value >= 0); return value; }
function key(value: unknown): string { const result = str(value, 64); check(/^[a-zA-Z0-9_-]+$/.test(result)); return result; }
function fullItem(value: unknown): string { const result = str(value); const parts = result.split(':'); const [slot, item] = parts; check(parts.length === 2 && voyagesSlots.includes(slot as typeof voyagesSlots[number]) && item); key(item); return result; }
function choice(value: unknown, choices: readonly string[]): string { check(choices.includes(value as string)); return value as string; }
function profile(value: unknown): VoyagesProfile {
  const p = obj(value), c = obj(p.config);
  const config = Object.fromEntries(voyagesSlots.map(slot => [slot, key(c[slot])])) as VoyagesProfile['config'];
  config.skin = choice(c.skin, voyagesAppearance.skin);
  config.hair = choice(c.hair, voyagesAppearance.hair);
  config.pattern = choice(c.pattern, voyagesAppearance.pattern);
  check(Array.isArray(p.owned) && p.owned.length <= 10000);
  const owned = p.owned.map(fullItem); check(new Set(owned).size === owned.length);
  return { version: int(p.version, 1), name: str(p.name, 20), shipName: str(p.shipName, 28), coins: int(p.coins), totalXp: int(p.totalXp), level: int(p.level, 1), xpIntoLevel: int(p.xpIntoLevel), xpForLevel: int(p.xpForLevel, 1), km: num(p.km), weeklyKm: num(p.weeklyKm), config, owned };
}
function item(value: unknown, owned: ReadonlySet<string>): VoyagesItem {
  const v = obj(value);
  check(typeof v.requiresPurchase === 'boolean' && typeof v.available === 'boolean' && typeof v.eligible === 'boolean');
  const id = fullItem(v.item), itemKey = key(v.itemKey);
  check(id === `${v.slot}:${itemKey}`);
  // Retired paid equipment remains owned; a missing offer price is not zero.
  check(v.price !== null || owned.has(id));
  check(v.reason === null || typeof v.reason === 'string' && v.reason.length <= 128 && !/[\u0000-\u001f\u007f]/.test(v.reason));
  return { item: id, name: str(v.name), slot: v.slot as VoyagesItem['slot'], itemKey, price: v.price === null ? null : int(v.price), requiresPurchase: v.requiresPurchase, available: v.available, eligible: v.eligible, reason: v.reason as string | null };
}
function quote(value: unknown): VoyagesQuote {
  const q = obj(value);
  const iso = str(q.expiresAt, 24);
  check(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(iso));
  const epoch = Date.parse(iso);
  check(Number.isFinite(epoch) && epoch > 0 && epoch <= 8.64e15);
  check(new Date(epoch).toISOString().slice(0, 19) === iso.slice(0, 19));
  return { id: str(q.id), item: fullItem(q.item), price: int(q.price), expiresAt: new Date(epoch).toISOString() };
}
function safe(error: unknown, uncertain = false): Failure {
  if (error instanceof Failure) return new Failure(error.code, error.status, uncertain || error.uncertain);
  const e = error as { code?: string; status?: number } | null;
  const status = Number.isInteger(e?.status) && e!.status! >= 400 && e!.status! <= 599 ? e!.status! : 0;
  return new Failure(codes.has(e?.code ?? '') ? e!.code! : status ? 'request_rejected' : 'request_failed', status, uncertain);
}

/** No credentials enter RPC DTOs. Native resolve owns serialized OAuth refresh. */
export function createVoyagesRpcHandlers(ctx: Port, options: { cloudClient?: CloudPort; baseUrl?: string; now?: () => number; profileRoot?: string; journal?: Journal } = {}) {
  const baseUrl = (options.baseUrl ?? cloudControlUrl()).replace(/\/+$/, '');
  const cloud: CloudPort = options.cloudClient ?? new CloudClient({ baseUrl });
  const now = options.now ?? Date.now;
  // Native plugin storage is not relied on for cross-workspace/profile recovery.
  // This journal contains purchase terms/keys only, never authentication tokens.
  const directory = join(runtimePaths({ root: options.profileRoot }).state, 'carthagent', 'voyages');
  const journal = options.journal ?? fileJournal;
  async function access() {
    const active = await ctx.integration.connection.active('experiential-labs');
    if (!active || active.type !== 'credential' || active.method !== 'oauth') throw new Failure('authentication_required', 401);
    let credential;
    try { credential = await ctx.integration.connection.resolve(active); } catch { throw new Failure('authentication_required', 401); }
    if (credential?.type !== 'oauth' || credential.methodID !== 'carthagent-device' || !credential.access) throw new Failure('authentication_required', 401);
    const scope = join(directory, createHash('sha256').update(JSON.stringify([baseUrl, active.id])).digest('hex'));
    return { id: active.id, token: credential.access, scope };
  }
  type Access = Awaited<ReturnType<typeof access>>;
  async function current(a: Access, signal: AbortSignal) {
    signal.throwIfAborted();
    const active = await ctx.integration.connection.active('experiential-labs');
    if (!active || active.type !== 'credential' || active.id !== a.id || active.method !== 'oauth') throw new Failure('account_changed', 401);
  }
  async function request(a: Access, path: string, signal: AbortSignal, method = 'GET', body?: unknown) {
    await current(a, signal);
    const result = await cloud.request(`/v1/voyages/${path}`, { method, accessToken: a.token, signal, ...(body === undefined ? {} : { body }) });
    await current(a, signal);
    return obj(result);
  }
  async function read(a: Access): Promise<State> {
    // Always read fresh after acquiring the profile-wide cross-process lock.
    const raw = await journal.get(`${a.scope}.json`);
    if (raw === undefined) return { quotes: [] };
    const s = obj(raw); check(Array.isArray(s.quotes) && s.quotes.length <= 20);
    const quotes = s.quotes.map(quote).filter(q => Date.parse(q.expiresAt) > now());
    if (s.pending === undefined) return { quotes };
    const p = obj(s.pending);
    return { quotes, pending: { quoteId: str(p.quoteId), key: str(p.key), item: fullItem(p.item), price: int(p.price) } };
  }
  const write = (a: Access, state: State) => journal.set(`${a.scope}.json`, state);
  function run<T>(fn: (input: Record<string, unknown>, call: Call, a: Access) => Promise<T>) {
    return async (input: unknown, call: Call) => {
      try {
        call.signal.throwIfAborted();
        const a = await access();
        return await withFileLock(`${a.scope}.lock`, async () => { await current(a, call.signal); return fn(obj(input), call, a); });
      } catch (error) {
        const e = safe(error);
        return call.error('voyagesError', e.code, { code: e.code, status: e.status, uncertain: e.uncertain });
      }
    };
  }
  async function buy(a: Access, state: State, call: Call, replay: boolean) {
    const pending = state.pending!;
    try {
      const r = await request(a, 'purchases', call.signal, 'POST', { quoteId: pending.quoteId, key: pending.key });
      const receipt = { receiptId: str(r.receiptId), item: fullItem(r.item), price: int(r.price) };
      check(receipt.item === pending.item && receipt.price === pending.price);
      await write(a, { quotes: [] });
      await current(a, call.signal);
      return receipt;
    } catch (error) {
      const e = safe(error);
      // Backend checks exact committed replay under the player lock BEFORE
      // expiry/debit. Thus 409 quote_expired proves this pair never committed.
      // Auth, key conflicts and all other replay errors remain uncertain.
      if ((!replay && e.status >= 400 && e.status < 500 && noDebit.has(e.code)) || (replay && e.status === 409 && e.code === 'quote_expired')) {
        try { await write(a, { quotes: [] }); } catch { throw new Failure('storage_failed', 0, true); }
        throw e;
      }
      throw safe(error, true);
    }
  }
  async function versioned(a: Access, path: string, input: Record<string, unknown>, call: Call, method: string) {
    try { return { profile: profile((await request(a, path, call.signal, method, input)).profile) }; }
    catch (error) {
      const e = safe(error);
      // Never retry a versioned write. Unknown outcomes require profile reconcile.
      throw safe(error, e.status === 0 || e.status >= 500);
    }
  }
  function selection(input: Record<string, unknown>) {
    choice(input.slot, voyagesSlots);
    key(input.item);
  }
  return {
    snapshot: run(async (_input, call, a) => {
      const bootstrap = await request(a, 'bootstrap', call.signal);
      check(bootstrap.signedIn === true);
      const p = profile(bootstrap.profile);
      const shop = await request(a, 'shop', call.signal);
      check(Array.isArray(shop.items) && shop.items.length <= 10000);
      const owned = new Set(p.owned);
      const items = shop.items.map(value => item(value, owned)); check(new Set(items.map(i => i.item)).size === items.length);
      const state = await read(a); await current(a, call.signal);
      const pending = state.pending;
      return { profile: p, items, ...(pending ? { pending: { quoteId: pending.quoteId, item: pending.item, price: pending.price } } : {}) };
    }),
    customize: run(async (input, call, a) => versioned(a, 'profile', input, call, 'PATCH')),
    equip: run(async (input, call, a) => { selection(input); return versioned(a, 'equip', input, call, 'POST'); }),
    quote: run(async (input, call, a) => {
      selection(input);
      const state = await read(a);
      if (state.pending) throw new Failure('purchase_pending', 0, true);
      const q = quote((await request(a, 'quotes', call.signal, 'POST', input)).quote);
      check(q.item === `${input.slot}:${input.item}` && Date.parse(q.expiresAt) > now() && Date.parse(q.expiresAt) <= now() + 125000);
      await write(a, { quotes: [...state.quotes.filter(v => v.id !== q.id), q].slice(-20) });
      await current(a, call.signal);
      return { quote: q };
    }),
    purchase: run(async (input, call, a) => {
      const state = await read(a);
      if (state.pending) throw new Failure('purchase_pending', 0, true);
      const q = state.quotes.find(q => q.id === input.quoteId);
      if (!q) throw new Failure('quote_required');
      await current(a, call.signal);
      state.pending = { quoteId: q.id, key: randomUUID(), item: q.item, price: q.price };
      // A single durable record contains both the authoritative terms and pair.
      // Do not send anything if persistence fails or cancellation was observed.
      await write(a, state);
      return buy(a, state, call, false);
    }),
    retryPurchase: run(async (input, call, a) => {
      const state = await read(a);
      if (!state.pending) throw new Failure('no_pending_purchase');
      if (input.quoteId !== state.pending.quoteId) throw new Failure('pending_changed', 0, true);
      return buy(a, state, call, true);
    }),
  };
}

export async function registerVoyagesRpc(ctx: Context) {
  return ctx.rpc.register(Voyages, createVoyagesRpcHandlers(ctx));
}
