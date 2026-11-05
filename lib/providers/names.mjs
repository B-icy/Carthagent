export const CARTHAGENT_SHIP_PROVIDER_ID = 'carthagent-cloud';
export const CARTHAGENT_SHIP_PROVIDER_NAME = 'Carthagent Cloud';
// Pre-rename provider id. Kept so stored credentials, saved config models and
// older session records still resolve to the managed Carthagent Cloud provider.
export const CARTHAGENT_SHIP_LEGACY_PROVIDER_IDS = Object.freeze(['experiential-labs']);

export function isCarthagentShipProviderId(providerId) {
  return providerId === CARTHAGENT_SHIP_PROVIDER_ID || CARTHAGENT_SHIP_LEGACY_PROVIDER_IDS.includes(providerId);
}

export function normalizeShipProviderId(providerId) {
  return CARTHAGENT_SHIP_LEGACY_PROVIDER_IDS.includes(providerId) ? CARTHAGENT_SHIP_PROVIDER_ID : providerId;
}

/** Rewrite a stored `provider/model` string onto the current provider id. */
export function normalizeModelIdentity(value) {
  const identity = String(value || '');
  const slash = identity.indexOf('/');
  if (slash <= 0) return identity;
  return `${normalizeShipProviderId(identity.slice(0, slash))}${identity.slice(slash)}`;
}

export function providerDisplayName(providerId) {
  return isCarthagentShipProviderId(providerId) ? CARTHAGENT_SHIP_PROVIDER_NAME : String(providerId || '');
}

export function modelDisplayIdentity(value) {
  return normalizeModelIdentity(value);
}
