import { voyagesEventAction } from './voyages-state.mjs';

export const dailyCancellationNotice = 'Evidence/consent canceled because the account, connection or location changed. Nothing was resent automatically. Refresh and review again; check the recovery journal for any request already started.';

/** Daily-page invalidation only; retain the shared credential/location policy.
 * Reset the native index before either replay removal or protected-state clearing
 * can clamp a former consent selection onto Back. Never focus a renderable here.
 */
export function handleDailyQuestsEvent({ controller, event, location, changedLocation = false, interrupted = false, actions, clearReplay, closeDialog, notice }) {
  const action = changedLocation ? String(event.type) === 'server.disconnected' ? 'clear' : 'refresh' : voyagesEventAction(event, location);
  if (action === 'ignore') return;
  if (actions && !actions.isDestroyed) actions.setSelectedIndex(0);
  if (interrupted) notice(dailyCancellationNotice);
  clearReplay();
  controller.invalidate();
  closeDialog();
  if (action === 'refresh') return controller.refresh();
}
