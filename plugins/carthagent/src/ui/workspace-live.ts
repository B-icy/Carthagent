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
  const entries = delivery?.truncation ? Object.entries(delivery.truncation) : undefined;
  const sections = entries
    ? entries.map(([name, value]) => `${name}: ${value.returned} of ${value.total} returned`)
    : ["Coverage metadata unavailable: completeness cannot be confirmed"];
  const sectionRows: Array<{ text: string; tone: "returned" | "truncated" | "unknown" }> = entries
    ? entries.map(([name, value], index) => value.returned === value.total
      ? { text: `Returned DTO section · ${sections[index]}`, tone: "returned" }
      : { text: `Truncated DTO section · ${sections[index]}`, tone: "truncated" })
    : [{ text: sections[0]!, tone: "unknown" }];
  const receipts = (delivery && "evidence" in delivery && Array.isArray(delivery.evidence) ? delivery.evidence : [])
    .map((item) => `Receipt ${item.id}: ${item.status}`);
  const gate = delivery?.gate === "open" || delivery?.gate === "locked" ? delivery.gate : "unknown";
  return {
    label: `Readiness: ${delivery?.completion === "ready" ? "ready" : delivery?.completion === "incomplete" ? "incomplete" : "unknown"} · ${readiness.status}`,
    gate,
    coverageLabel: readiness.coverage === "unknown" ? "Coverage: unknown" : `Coverage: ${readiness.coverage}`,
    coverage: readiness.coverage,
    sections,
    sectionRows,
    receipts,
  };
}

export function workspaceReturnRoute(sessionID: string | undefined) {
  return sessionID ? { type: "session" as const, sessionID } : { type: "home" as const };
}

/**
 * The workspace review RPC reports only the independent .harness/reviews receipt.
 * A Ship delivery_review record is model-authored self-review and must never be shown as that receipt.
 */
export function independentReviewText(review: { status?: string; summary?: string; error?: string } | undefined) {
  if (review?.error) return `Independent review status unavailable: ${review.error}`;
  const summary = review?.summary ? ` · ${review.summary}` : "";
  const status = review?.status;
  switch (status) {
    case "approved": return `Independent review approved${summary}`;
    case "changes-requested": return `Independent review requested changes${summary}`;
    case "stale": return `Independent review receipt stale${summary || " · Review source changed since this receipt"}`;
    case "invalid": return `Independent review receipt invalid${summary}`;
    case "unreviewed": return `No independent code-review receipt${summary}. Any delivery self-review is model-authored and not an independent review.`;
    case undefined: return "Independent review status unavailable";
    default: return `Independent review status: ${status}${summary}`;
  }
}
