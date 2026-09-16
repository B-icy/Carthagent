/**
 * Pure helpers for the console's provider/model picker.
 *
 * `state.modelList` is a flat array of `{ provider, id, full }` from pi's
 * `get_available_models`. The settings overlay groups/filters it by provider
 * so multiple authenticated providers can coexist and be switched between.
 */

/** Sorted unique provider ids present in a model list. */
export function providersFromModels(list) {
  const seen = new Set();
  for (const m of list || []) if (m?.provider) seen.add(m.provider);
  return [...seen].sort((a, b) => a.localeCompare(b));
}

/** Provider id for the current model, resolved against the available list.
 *  Falls back to the `provider/…` prefix when the model isn't listed yet. */
export function providerForModel(model, list) {
  const s = String(model || '');
  const hit = (list || []).find(m => m.full === s) || (list || []).find(m => m.id === s);
  if (hit) return hit.provider;
  const slash = s.indexOf('/');
  return slash > 0 ? s.slice(0, slash) : '';
}

/** Filter a model list by provider and (optionally) a search string, capped. */
export function filterModelsByProvider(list, provider, query, limit = 50) {
  let out = list || [];
  if (provider) out = out.filter(m => m.provider === provider);
  const q = (query || '').toLowerCase();
  if (q) out = out.filter(m => m.full.toLowerCase().includes(q));
  return out.slice(0, limit);
}

/** Next provider id when cycling a list, wrapping in both directions. */
export function cycleProvider(providers, current, dir) {
  if (!providers?.length) return '';
  const i = providers.indexOf(current);
  const at = i === -1 ? 0 : i;
  return providers[(at + dir + providers.length) % providers.length];
}
