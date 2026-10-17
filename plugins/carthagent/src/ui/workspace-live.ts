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

export function deliveryReadiness(delivery: {
  completion?: string;
  gate?: string;
  freshness?: string;
  truncation?: Record<string, { returned: number; total: number }>;
} | undefined) {
  if (!delivery) return { complete: false, coverage: "unknown", status: "not loaded" };
  const truncation = delivery.truncation;
  const capped = truncation ? Object.entries(truncation).filter(([, value]) => value.returned !== value.total) : [];
  const complete = delivery.completion === "ready";
  const totals = capped.map(([name, value]) => `${name} ${value.returned}/${value.total}`);
  return {
    complete,
    coverage: truncation ? (totals.length ? "partial" : "complete") : "unknown",
    status: `completion ${delivery.completion ?? "unknown"} · gate ${delivery.gate ?? "unknown"} · freshness ${delivery.freshness ?? "unknown"}${totals.length ? ` · partial coverage: ${totals.join(", ")}` : ""}`,
  };
}

export function renderDeliveryReadiness(delivery: Parameters<typeof deliveryReadiness>[0]) {
  const readiness = deliveryReadiness(delivery);
  const sections = delivery?.truncation
    ? Object.entries(delivery.truncation).map(([name, value]) => `${name}: ${value.returned} of ${value.total} returned`)
    : ["Coverage metadata unavailable: completeness cannot be confirmed"];
  const receipts = (delivery && "evidence" in delivery && Array.isArray(delivery.evidence) ? delivery.evidence : [])
    .map((item) => `Receipt ${item.id}: ${item.status}`);
  const gate = delivery?.gate === "open" || delivery?.gate === "locked" ? delivery.gate : "unknown";
  return {
    label: `Readiness: ${delivery?.completion === "ready" ? "ready" : delivery?.completion === "incomplete" ? "incomplete" : "unknown"} · ${readiness.status}`,
    gate,
    coverageLabel: readiness.coverage === "unknown" ? "Coverage: unknown" : `Coverage: ${readiness.coverage}`,
    coverage: readiness.coverage,
    sections,
    receipts,
  };
}
