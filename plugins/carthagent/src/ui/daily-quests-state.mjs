import { dailyRequest } from '../daily-evidence.mjs';

const copy = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
const localError = code => ({ type: 'dailyQuestError', data: { code } });
const failureMessage = code => `${code}. Refresh required; no success assumed. Sign in again if access expired or was revoked.`;

/** Native promise RPC errors are { type, message, data }. Never render messages. */
export function dailyErrorCode(error) {
  const code = error?.type === 'dailyQuestError' ? error.data?.code : undefined;
  return typeof code === 'string' && code.length >= 1 && code.length <= 64 && !/[^a-z_]/.test(code) ? code : 'daily_request_failed';
}

/** Processing status is not a coding assessment, nor independent verification. */
export function dailySubmissionLabel(submission) {
  if (!submission) return 'No submission';
  if (submission.status === 'queued') return 'Queued (not completed)';
  if (submission.status === 'grading') return 'Grading (not completed)';
  if (submission.status === 'failed') return 'Processing failed (not a coding assessment)';
  if (submission.status === 'graded') {
    if (submission.decision === 'assessed_complete') return 'Classifier-assessed complete (not independently verified)';
    if (submission.decision === 'not_met') return 'Graded: not met';
    if (submission.decision === 'needs_evidence') return 'Graded: needs evidence';
    return 'Graded: assessment unavailable';
  }
  return 'Submission status unavailable';
}

/** Offline UI transaction controller. Only explicit submit/retry can upload.
 * Dialog callbacks receive detached copies plus a live() lifetime predicate.
 * Cancel/back/invalidate synchronously revoke any outstanding dialog callback.
 */
export function createDailyQuestsState({ api, changed = (_state) => {}, timeoutSignal = () => AbortSignal.timeout(15_000) }) {
  let generation = 0;
  let disposed = false;
  let controller = new AbortController();
  const state = { snapshot: undefined, detail: undefined, busy: false, error: '', draft: undefined, preview: undefined, phase: 'overview' };
  const emit = () => { if (!disposed) changed(copy(state)); };
  const clearDraft = () => { state.draft = undefined; state.preview = undefined; state.phase = 'overview'; };
  const clearProtected = () => { state.snapshot = undefined; state.detail = undefined; clearDraft(); };
  const revoke = () => {
    generation++;
    controller.abort();
    controller = new AbortController();
    state.busy = false;
    state.error = '';
  };
  const invalidate = () => { revoke(); clearProtected(); emit(); };
  const networkSignal = signal => AbortSignal.any([signal, timeoutSignal()]);
  const savedRecord = id => state.snapshot?.records.find(record => record.id === id);
  const knownQuest = id => state.snapshot?.slate.items.some(quest => quest.id === id)
    || state.snapshot?.records.some(record => record.questId === id);

  async function loadSnapshot(tx, expectedAccount = tx.accountKey) {
    if (!tx.live()) return false;
    const snapshot = copy(await api.snapshot(networkSignal(tx.signal)));
    if (!tx.live()) return false;
    if (!snapshot?.accountKey || (expectedAccount != null && snapshot.accountKey !== expectedAccount)) {
      throw localError('daily_account_changed');
    }
    state.snapshot = snapshot;
    emit();
    return tx.live();
  }
  async function loadDetail(id, tx) {
    if (!tx.live()) return;
    const detail = copy(await api.detail({ id }, networkSignal(tx.signal)));
    if (!tx.live()) return;
    if (detail?.id !== id) throw localError('daily_request_failed');
    // The detail RPC reconciles acceptance and erases raw journal payloads.
    // Drop the matching in-memory copy before exposing the accepted detail.
    if (detail.latestSubmission && state.snapshot) {
      const submission = detail.latestSubmission;
      const previous = savedRecord(submission.id);
      const record = { id: submission.id, questId: detail.id, createdAt: previous?.createdAt ?? submission.createdAt, request: null, submission: copy(submission) };
      state.snapshot.records = state.snapshot.records.filter(item => item.id !== submission.id);
      state.snapshot.records.push(record);
    }
    state.detail = detail;
    emit();
  }
  async function run(action) {
    if (disposed || state.busy) return;
    const current = generation;
    const signal = controller.signal;
    const tx = { signal, accountKey: state.snapshot?.accountKey, live: () => !disposed && generation === current && !signal.aborted };
    state.busy = true;
    state.error = '';
    emit();
    try { if (tx.live()) await action(tx); }
    catch (error) {
      if (tx.live()) {
        clearProtected();
        state.error = failureMessage(dailyErrorCode(error));
        emit();
        // Read the durable journal only. Never replay a write, assume success,
        // or resurrect raw evidence from a callback after an unknown outcome.
        try { await loadSnapshot(tx); }
        catch (reconcileError) {
          if (tx.live()) {
            clearProtected();
            if (dailyErrorCode(reconcileError) === 'daily_account_changed') state.error = failureMessage('daily_account_changed');
          }
        }
      }
    } finally {
      if (tx.live()) { state.busy = false; emit(); }
    }
  }
  async function refreshedWrite(tx, questId) {
    // Immediately drop all copies of raw evidence; GET is authoritative.
    clearProtected();
    emit();
    if (await loadSnapshot(tx)) await loadDetail(questId, tx);
  }

  return {
    invalidate,
    dispose() { if (!disposed) { invalidate(); disposed = true; controller.abort(); } },
    refresh() {
      return run(async tx => { clearProtected(); emit(); await loadSnapshot(tx, null); });
    },
    select(id) {
      return run(async tx => {
        if (!knownQuest(id)) return;
        clearDraft(); state.detail = undefined; emit();
        await loadDetail(id, tx);
      });
    },
    compose(makeDraft) {
      return run(async tx => {
        const detail = copy(state.detail);
        const accountKey = state.snapshot?.accountKey;
        if (!accountKey || !detail || detail.status !== 'open' || !knownQuest(detail.id)) return;
        clearDraft(); emit();
        if (!tx.live()) return;
        const draft = await makeDraft(copy(detail), tx.live, tx.signal);
        if (!draft || !tx.live() || state.snapshot?.accountKey !== accountKey || state.detail?.id !== detail.id) return;
        state.draft = { accountKey, questId: detail.id, id: draft.id, text: JSON.stringify(draft.evidence, null, 2), provenance: typeof draft.provenance === 'string' ? draft.provenance : '' };
        state.phase = 'edit';
        emit();
      });
    },
    edit(text) {
      if (disposed || state.busy || !state.draft || typeof text !== 'string') return;
      state.draft.text = text; state.preview = undefined; state.phase = 'edit'; state.error = ''; emit();
    },
    preview() {
      if (disposed || state.busy || !state.draft) return;
      state.preview = undefined; state.phase = 'edit'; state.error = '';
      try {
        const request = dailyRequest(state.draft.id, JSON.parse(state.draft.text));
        state.draft.text = JSON.stringify(request.evidence, null, 2);
        state.preview = freeze(copy(request)); state.phase = 'preview';
      } catch { state.error = 'invalid_daily_evidence. Correct the evidence before previewing or submitting.'; }
      emit();
    },
    backToEdit() {
      if (disposed || !state.draft) return;
      if (state.busy) revoke();
      state.preview = undefined; state.phase = 'edit'; state.error = ''; emit();
    },
    cancelDraft() {
      if (disposed) return;
      if (state.busy) revoke();
      clearDraft(); state.error = ''; emit();
    },
    submit(confirm) {
      return run(async tx => {
        if (!state.draft || !state.preview || !state.detail || state.detail.status !== 'open') return;
        const draft = copy(state.draft);
        if (draft.accountKey !== tx.accountKey || draft.questId !== state.detail.id) return;
        const request = freeze(copy(state.preview));
        const shown = { quest: copy(state.detail), request: freeze(copy(request)) };
        if (await confirm(shown, tx.live) !== true || !tx.live()) return;
        if (state.draft?.id !== draft.id || state.snapshot?.accountKey !== draft.accountKey || !state.preview) return;
        await api.submit({ accountKey: draft.accountKey, questId: draft.questId, ...copy(request) }, networkSignal(tx.signal));
        if (tx.live()) await refreshedWrite(tx, draft.questId);
      });
    },
    poll(id) {
      return run(async tx => {
        const record = savedRecord(id);
        const questId = record?.questId ?? (state.detail?.latestSubmission?.id === id ? state.detail.id : undefined);
        if (!questId || !tx.accountKey) return;
        clearDraft(); state.detail = undefined; emit();
        if (!tx.live()) return;
        await api.poll({ id }, networkSignal(tx.signal));
        if (await loadSnapshot(tx)) await loadDetail(questId, tx);
      });
    },
    retry(id, confirm) {
      return run(async tx => {
        const record = copy(savedRecord(id));
        if (!record?.request || !tx.accountKey) return;
        const shown = freeze(copy(record));
        if (await confirm(shown, tx.live) !== true || !tx.live()) return;
        await api.retry({ accountKey: tx.accountKey, id: record.id }, networkSignal(tx.signal));
        if (tx.live()) await refreshedWrite(tx, record.questId);
      });
    },
    forget(id, confirm) {
      return run(async tx => {
        const record = copy(savedRecord(id));
        if (!record?.request || !tx.accountKey) return;
        if (await confirm(freeze(copy(record)), tx.live) !== true || !tx.live()) return;
        await api.forgetPayload({ accountKey: tx.accountKey, id: record.id }, networkSignal(tx.signal));
        if (tx.live()) await refreshedWrite(tx, record.questId);
      });
    },
  };
}
