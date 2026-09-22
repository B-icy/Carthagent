export const CARTHAGENT_SHIP_PROVIDER_ID = 'experiential-labs';
export const CARTHAGENT_SHIP_PROVIDER_NAME = 'Carthagent Ship';

export function providerDisplayName(providerId) {
  return providerId === CARTHAGENT_SHIP_PROVIDER_ID ? CARTHAGENT_SHIP_PROVIDER_NAME : String(providerId || '');
}

export function modelDisplayIdentity(value) {
  const identity = String(value || '');
  const slash = identity.indexOf('/');
  if (slash <= 0) return identity;
  return `${providerDisplayName(identity.slice(0, slash))}/${identity.slice(slash + 1)}`;
}
