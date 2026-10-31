type CatalogModel = { providerID: string; modelID: string; id: string; name: string };

export type ModelCommandHost = {
  sync(): Promise<unknown>;
  list(): readonly CatalogModel[];
  select(options: Array<{ title: string; value: CatalogModel; description: string }>): Promise<CatalogModel | undefined>;
  switchModel(sessionID: string, model: { providerID: string; id: string }): Promise<unknown>;
  /** Opens the native configured-model picker (the `/models` command) with an optional search. */
  openNativePicker(query: string): void;
  providerName(providerID: string): string;
  toast(message: string, variant: "success" | "warning"): void;
};

/**
 * `/model [name]`. Without a session the choice belongs to the next session's draft, which only the native
 * picker owns, so it is opened directly; inside a session the selection is committed to that session.
 */
export async function runModelCommand(host: ModelCommandHost, input: { sessionID?: string; arg: string }) {
  if (!input.sessionID) {
    host.openNativePicker(input.arg);
    return;
  }
  await host.sync();
  const query = input.arg.toLowerCase();
  const options = host.list()
    .filter((model) => !query || `${host.providerName(model.providerID)} ${model.providerID}/${model.modelID} ${model.name}`.toLowerCase().includes(query))
    .map((model) => ({ title: `${host.providerName(model.providerID)}/${model.modelID}`, value: model, description: model.name }));
  const selected = await host.select(options);
  if (!selected) return;
  await host.switchModel(input.sessionID, { providerID: selected.providerID, id: selected.id });
  host.toast(`Selected ${host.providerName(selected.providerID)}/${selected.modelID}.`, "success");
}
