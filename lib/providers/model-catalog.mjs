import catalog from './model-catalog.json' with { type: 'json' };

/** Reviewed, offline metadata. Never fetch a third-party model catalog. */
export function catalogModels(providerId) {
  const models = catalog.providers[providerId] || [];
  return structuredClone(models);
}
