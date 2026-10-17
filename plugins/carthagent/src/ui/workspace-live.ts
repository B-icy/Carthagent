/** Generation gate for async workspace refreshes and reconnect rehydration. */
export function createLatestRequestGate() {
  let generation = 0;
  let active: AbortController | undefined;
  return {
    begin() {
      active?.abort();
      active = new AbortController();
      const request = ++generation;
      return { signal: active.signal, isCurrent: () => request === generation && !active?.signal.aborted };
    },
    invalidate() { generation++; active?.abort(); active = undefined; },
  };
}

type WorkspaceUpdatedEvents = {
  on(name: "updated", handler: (event: { location?: { directory: string }; data?: { revision?: string } }) => void, options?: { signal?: AbortSignal }): () => void;
};

/** The RPC event is location-scoped by the subscribed RPC client, not its payload. */
export function onWorkspaceUpdated(events: WorkspaceUpdatedEvents, directory: () => string, invalidate: () => void, options?: { signal?: AbortSignal }) {
  return events.on("updated", (event) => {
    if (event.location?.directory === directory()) invalidate();
  }, options);
}
