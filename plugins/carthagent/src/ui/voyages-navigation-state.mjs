import { voyagesErrorCode } from './voyages-state.mjs';

/** Read-only summaries only. Never retain recovery payloads, catalog or consent. */
export function createVoyagesNavigationState({ profile, daily, changed = (_state) => {}, timeoutSignal = () => AbortSignal.timeout(15_000) }) {
  let generation = 0, active = false, disposed = false;
  let request = new AbortController();
  let state = { busy: false, error: '', profile: undefined, daily: undefined };
  const emit = () => { if (!disposed) changed({ ...state }); };
  const invalidate = () => {
    generation++;
    request.abort();
    request = new AbortController();
    state = { busy: false, error: '', profile: undefined, daily: undefined };
    emit();
  };
  const refresh = async () => {
    if (disposed || !active || state.busy) return;
    const current = generation;
    const signal = AbortSignal.any([request.signal, timeoutSignal()]);
    const live = () => !disposed && active && generation === current && !signal.aborted;
    state = { busy: true, error: '', profile: undefined, daily: undefined };
    emit();
    try {
      const [account, assignments] = await Promise.all([profile(signal), daily(signal)]);
      if (!live()) return;
      state.profile = {
        name: account.profile.name, shipName: account.profile.shipName,
        coins: account.profile.coins, level: account.profile.level, totalXp: account.profile.totalXp,
      };
      state.daily = {
        day: assignments.slate.day, endsAt: assignments.slate.endsAt,
        items: assignments.slate.items.map((quest) => ({ id: quest.id, title: quest.definition.title, status: quest.status })),
      };
    } catch (error) {
      if (!disposed && active && generation === current) {
        const code = error?.type === 'dailyQuestError' ? error.data?.code : voyagesErrorCode(error);
        state.error = typeof code === 'string' && /^[a-z_]{1,64}$/.test(code) ? code : 'voyages_request_failed';
      }
    } finally {
      if (!disposed && active && generation === current) { state.busy = false; emit(); }
    }
  };
  return {
    refresh,
    invalidate,
    activate(next) {
      if (disposed || active === next) return;
      active = next;
      invalidate();
      if (active) return refresh();
    },
    contextChanged() { invalidate(); if (active) return refresh(); },
    disconnect() { invalidate(); },
    dispose() { active = false; invalidate(); disposed = true; request.abort(); },
  };
}
