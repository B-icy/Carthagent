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
const failureMessage = code => ({
  not_found: 'No submission found yet. Use Retry saved submission to check again and resend the same request.',
  request_failed: 'Connection interrupted. Check submission status before trying again.',
  daily_request_failed: 'Could not load quests. Check your connection and refresh.',
  authentication_required: 'Sign in to Carthagent Cloud to load your quests.',
  expired_token: 'Your sign-in expired. Reconnect to continue.',
  revoked_token: 'Your sign-in was revoked. Reconnect to continue.',
  daily_quest_expired: 'This quest has closed. Refresh to see today’s quests.',
  daily_quest_complete: 'This quest is already complete. Refresh to see the result.',
  daily_submission_active: 'Your submission is still being checked. Check status in a moment.',
  submission_pending: 'A previous submission needs a status check before sending more work.',
  daily_outcome_claimed: 'This work already completed a quest. Choose different work.',
  daily_submission_limit: 'Today’s submission limit was reached. Try a new quest tomorrow.',
  rate_limited: 'Too many requests. Wait a moment, then check status.',
  daily_grading_unavailable: 'Assessment is temporarily unavailable. Try again later.',
  daily_source_unavailable: 'No recorded Ship delivery in this session. Complete the work in Ship mode, then choose it here.',
  invalid_daily_evidence: 'This work cannot be submitted yet. Check the selected summary and results.',
  storage_failed: 'Could not save submission recovery. Check available disk space, then retry.',
  daily_account_changed: 'Your account changed. Choose work again for the current account.',
}[code] ?? `Could not complete this action (${code}). Refresh or check submission status.`);

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
export function createDailyQuestsState({ api, changed = (_state) => {}, timeoutSignal = () => AbortSignal.timeout(15_000), draftCache }) {
  let generation = 0;
  let disposed = false;
  let controller = new AbortController();
  const state = { snapshot: undefined, detail: undefined, busy: false, error: '', draft: undefined, preview: undefined, phase: 'overview' };
  const drafts = draftCache ?? new Map();
  const emit = () => { if (!disposed) changed(copy(state)); };
  const clearDraft = () => { state.draft = undefined; state.preview = undefined; state.phase = 'overview'; };
  const clearProtected = () => { drafts.clear(); state.snapshot = undefined; state.detail = undefined; clearDraft(); };
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
    for (const [id, saved] of drafts) {
      if (saved.draft.accountKey !== snapshot.accountKey || !snapshot.slate.items.some(q => q.id === id && q.status === 'open')) drafts.delete(id);
    }
    if (state.detail && !knownQuest(state.detail.id)) { state.detail = undefined; clearDraft(); }
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
  async function run(action, { write = false } = {}) {
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
        const code = dailyErrorCode(error);
        const retain = !write && ['request_failed', 'daily_request_failed', 'daily_source_unavailable', 'rate_limited'].includes(code);
        if (!retain) clearProtected();
        state.error = failureMessage(code);
        emit();
        // Read the durable journal only. Never replay a write, assume success,
        // or resurrect raw evidence from a callback after an unknown outcome.
        try { if (!retain) await loadSnapshot(tx); }
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
    dispose() {
      if (disposed) return;
      if (!draftCache || state.busy) invalidate();
      else {
        if (state.draft) drafts.set(state.draft.questId, copy({ draft: state.draft, preview: state.preview, phase: state.phase }));
        revoke(); state.snapshot = undefined; state.detail = undefined; clearDraft();
      }
      disposed = true; controller.abort();
    },
    refresh() {
      return run(async tx => {
        const id = state.detail?.id;
        if (await loadSnapshot(tx)) {
          if (id && knownQuest(id)) await loadDetail(id, tx);
          if (state.detail?.status !== 'open') clearDraft();
        }
      });
    },
    select(id) {
      return run(async tx => {
        if (!knownQuest(id)) return;
        if (state.draft) drafts.set(state.draft.questId, { draft: state.draft, preview: state.preview, phase: state.phase });
        clearDraft(); state.detail = undefined; emit();
        await loadDetail(id, tx);
        if (tx.live() && state.detail?.status === 'open' && drafts.has(id)) {
          Object.assign(state, drafts.get(id)); emit();
        }
      });
    },
    compose(makeDraft) {
      return run(async tx => {
        const detail = copy(state.detail);
        const accountKey = state.snapshot?.accountKey;
        if (!accountKey || !detail || detail.status !== 'open' || !knownQuest(detail.id)) return;
        emit();
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
      if (state.draft) drafts.delete(state.draft.questId);
      clearDraft(); state.error = ''; emit();
    },
    /** Re-offer a draft saved before an event reload, only for the same verified account and a still-open quest. */
    adopt(saved) {
      if (disposed || state.busy || !saved?.draft || saved.draft.accountKey !== state.snapshot?.accountKey) return false;
      if (!state.snapshot.slate.items.some(q => q.id === saved.draft.questId && q.status === 'open')) return false;
      drafts.set(saved.draft.questId, copy(saved));
      return true;
    },
    overview() {
      if (disposed || state.busy) return;
      if (state.draft) drafts.set(state.draft.questId, { draft: state.draft, preview: state.preview, phase: state.phase });
      clearDraft();
      state.detail = undefined; state.error = ''; emit();
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
      }, { write: true });
    },
    poll(id, { follow = true } = {}) {
      return run(async tx => {
        const record = savedRecord(id);
        const questId = record?.questId ?? (state.detail?.latestSubmission?.id === id ? state.detail.id : undefined);
        if (!questId || !tx.accountKey) return;
        const selected = state.detail?.id;
        if (follow && selected !== questId) {
          if (state.draft) drafts.set(state.draft.questId, { draft: state.draft, preview: state.preview, phase: state.phase });
          clearDraft(); state.detail = undefined; emit();
        }
        if (!tx.live()) return;
        await api.poll({ id }, networkSignal(tx.signal));
        if (await loadSnapshot(tx)) {
          if (follow || selected === questId) {
            await loadDetail(questId, tx);
            if (state.detail?.status !== 'open' || state.draft?.id === id) { drafts.delete(questId); clearDraft(); }
          }
        }
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
      }, { write: true });
    },
    forget(id, confirm) {
      return run(async tx => {
        const record = copy(savedRecord(id));
        if (!record?.request || !tx.accountKey) return;
        if (await confirm(freeze(copy(record)), tx.live) !== true || !tx.live()) return;
        await api.forgetPayload({ accountKey: tx.accountKey, id: record.id }, networkSignal(tx.signal));
        if (tx.live()) await refreshedWrite(tx, record.questId);
      }, { write: true });
    },
  };
}
