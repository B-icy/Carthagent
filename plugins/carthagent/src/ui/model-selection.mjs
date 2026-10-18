/** Select a model only after any required nested variant picker is accepted. */
export async function selectModelWithVariant({ model, variant, promptForVariant = false, chooseVariant, switchModel }) {
  const available = model.variants.map((item) => item.id);
  let selectedVariant = variant;
  // An explicit variant from `/model query variant` is authoritative; the
  // nested picker is only for a model-only multi-result selection.
  if (variant === undefined && promptForVariant && available.length) {
    selectedVariant = await chooseVariant(model);
    if (selectedVariant === undefined) return { status: "cancelled" };
  }
  if (selectedVariant && !available.includes(selectedVariant)) {
    return { status: "invalid", variant: selectedVariant };
  }
  await switchModel({ providerID: model.providerID, id: model.id, ...(selectedVariant ? { variant: selectedVariant } : {}) });
  return { status: "selected", variant: selectedVariant || undefined };
}
