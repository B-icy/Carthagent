/** UI transaction lifetime. Credentials and durable purchase keys remain server-only. */
export function createVoyagesState({ api, changed = (_state) => {}, now = Date.now, timeoutSignal = () => AbortSignal.timeout(15_000) }) {
  let generation = 0;
  let disposed = false;
  let controller = new AbortController();
  const state = { snapshot: undefined, busy: false, error: "", notice: "" };
  const emit = () => { if (!disposed) changed({ ...state }); };
  const invalidate = () => {
    generation++;
    controller.abort();
    controller = new AbortController();
    state.snapshot = undefined;
    state.busy = false;
    state.error = "";
    state.notice = "";
    emit();
  };
  async function run(action) {
    if (disposed || state.busy) return;
    const current = generation;
    const signal = controller.signal;
    const live = () => !disposed && current === generation && !signal.aborted;
    state.busy = true;
    state.error = "";
    state.notice = "";
    emit();
    try { await action({ signal, live }); }
    catch (error) {
      if (!disposed && current === generation) {
        state.snapshot = undefined;
        state.error = `${voyagesErrorCode(error)}. Refresh required; no success assumed. Sign in again if access expired or was revoked.`;
        emit();
        // Reconcile all failed writes, never replay them. Even if this succeeds,
        // retain the failure message rather than claiming a successful mutation.
        try {
          const snapshot = await api.snapshot(AbortSignal.any([controller.signal, timeoutSignal()]));
          if (!disposed && current === generation) state.snapshot = snapshot;
        } catch { /* fail closed */ }
      }
    } finally {
      if (!disposed && current === generation) { state.busy = false; emit(); }
    }
  }
  async function load({ signal, live }) {
    const snapshot = await api.snapshot(networkSignal(signal));
    if (live()) { state.snapshot = snapshot; emit(); }
  }
  const networkSignal = (signal) => AbortSignal.any([signal, timeoutSignal()]);
  return {
    invalidate,
    dispose() { invalidate(); disposed = true; controller.abort(); },
    refresh() { return run(async (tx) => { state.snapshot = undefined; emit(); await load(tx); }); },
    customize(draft, confirm) {
      return run(async (tx) => {
        const profile = state.snapshot?.profile;
        if (!profile) return;
        const patch = await draft(profile, tx.live);
        if (!patch || !tx.live()) return;
        if (await confirm(profile, patch) !== true || !tx.live()) return;
        await api.customize({ version: profile.version, ...patch }, networkSignal(tx.signal));
        if (!tx.live()) return;
        await load(tx);
        if (tx.live()) state.notice = "Customization saved and refreshed.";
      });
    },
    equip(item, confirm) {
      return run(async (tx) => {
        const snapshot = state.snapshot;
        if (!snapshot || !snapshot.items.some((entry) => entry.item === item.item)) return;
        if (!canEquip(snapshot, item)) throw new Error("equip unavailable");
        if (await confirm(snapshot.profile, item) !== true || !tx.live()) return;
        await api.equip({ version: snapshot.profile.version, slot: item.slot, item: item.itemKey }, networkSignal(tx.signal));
        if (!tx.live()) return;
        await load(tx);
        if (tx.live()) state.notice = "Equipment saved and refreshed.";
      });
    },
    purchase(item, confirm) {
      return run(async (tx) => {
        const snapshot = state.snapshot;
        if (!snapshot || snapshot.pending || !snapshot.items.some((entry) => entry.item === item.item) || item.price === null || !item.requiresPurchase || !item.available || !item.eligible || snapshot.profile.owned.includes(item.item)) return;
        const { quote } = await api.quote({ slot: item.slot, item: item.itemKey }, networkSignal(tx.signal));
        if (!tx.live()) return;
        const valid = () => quote.item === item.item && Number.isSafeInteger(quote.price) && quote.price >= 0 && quote.price <= snapshot.profile.coins && Number.isFinite(Date.parse(quote.expiresAt)) && Date.parse(quote.expiresAt) > now();
        if (!valid()) throw new Error("invalid or expired quote");
        if (await confirm(quote, snapshot.profile) !== true || !tx.live()) return;
        if (!valid()) throw new Error("expired quote");
        await api.purchase({ quoteId: quote.id }, networkSignal(tx.signal));
        if (!tx.live()) return;
        await load(tx);
        if (tx.live()) state.notice = "Purchase receipt received; authoritative inventory refreshed.";
      });
    },
    retry(confirm) {
      return run(async (tx) => {
        const pending = state.snapshot?.pending ? { ...state.snapshot.pending } : undefined;
        if (!pending || await confirm(pending) !== true || !tx.live()) return;
        await api.retryPurchase({ quoteId: pending.quoteId }, networkSignal(tx.signal));
        if (!tx.live()) return;
        await load(tx);
        if (tx.live()) state.notice = "Purchase replay receipt received; inventory refreshed.";
      });
    },
  };
}

/** Native promise RPC throws { type, message, data }, not a nested error map. */
export function voyagesErrorCode(error) {
  const code = error?.type === 'voyagesError' ? error.data?.code : undefined;
  return typeof code === 'string' && /^[a-z_]{1,64}$/.test(code) ? code : 'voyages_request_failed';
}

/** Credential/integration events without a location are global. Generic update
 * events have no integration ID in the native union, so cannot be narrowed more.
 * Credential switched does carry an integration ID: ignore other providers. */
export function voyagesEventAction(event, location) {
  if (event.location && (event.location.directory !== location.directory || event.location.workspaceID !== location.workspaceID)) return 'ignore';
  if (event.type === 'server.disconnected') return 'clear';
  if (event.type === 'credential.switched' && event.data?.integrationID !== 'experiential-labs') return 'ignore';
  return ['server.connected', 'provider.updated', 'integration.updated', 'credential.updated', 'credential.switched'].includes(event.type) ? 'refresh' : 'ignore';
}

/** Synchronously remove the old identity before fetching, including any dialog
 * owned by this page. The caller's dialog adapter must not close native sign-in. */
export function handleVoyagesEvent(controller, event, location, closeDialog = () => {}) {
  const action = voyagesEventAction(event, location);
  if (action === 'ignore') return;
  controller.invalidate();
  closeDialog();
  if (action === 'refresh') return controller.refresh();
}

export function canEquip(snapshot, item) {
  return item.available === true && item.eligible === true &&
    (snapshot.profile.owned.includes(item.item) || (item.requiresPurchase === false && item.price !== null));
}

export function voyagesCatalogLabel(snapshot, item) {
  const category = snapshot.profile.owned.includes(item.item) ? 'Owned' : item.price === null ? 'Retired' : item.requiresPurchase ? 'Shop' : 'Free';
  const price = item.price === null ? 'price unavailable / retired' : `${item.price} coins`;
  return `${category} · ${item.name} · ${price}`;
}
