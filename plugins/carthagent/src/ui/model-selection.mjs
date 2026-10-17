/** Select a model only after any required nested variant picker is accepted. */
export async function selectModelWithVariant({ model, variant, promptForVariant = false, chooseVariant, switchModel }) {
  const available = model.variants.map((item) => item.id);
  let selectedVariant = variant;
  if (promptForVariant && available.length) {
    selectedVariant = await chooseVariant(model);
    if (selectedVariant === undefined) return { status: "cancelled" };
  }
  if (selectedVariant && !available.includes(selectedVariant)) {
    return { status: "invalid", variant: selectedVariant };
  }
  await switchModel({ providerID: model.providerID, id: model.id, ...(selectedVariant ? { variant: selectedVariant } : {}) });
  return { status: "selected", variant: selectedVariant || undefined };
}
