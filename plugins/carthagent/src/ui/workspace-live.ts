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
    invalidate() {
      generation++;
      active?.abort();
      active = undefined;
    },
  };
}

type WorkspaceUpdatedEvents = {
  on(
    name: "updated",
    handler: (event: { location?: { directory: string }; data?: { revision?: string } }) => void,
    options?: { signal?: AbortSignal },
  ): () => void;
};

/** The RPC event is location-scoped by the subscribed RPC client, not its payload. */
export function onWorkspaceUpdated(events: WorkspaceUpdatedEvents, directory: () => string, invalidate: () => void, options?: { signal?: AbortSignal }) {
  return events.on(
    "updated",
    (event) => {
      if (event.location?.directory === directory()) invalidate();
    },
    options,
  );
}

export function deliveryReadiness(
  delivery:
    | {
        completion?: string;
        gate?: string;
        freshness?: string;
        evidence?: Array<{ id: string; status: string }>;
        truncation?: Record<string, { returned: number; total: number }>;
      }
    | undefined,
) {
  if (!delivery) return { complete: false, coverage: "unknown", status: "not loaded" };
  const truncation = delivery.truncation;
  const capped = truncation ? Object.entries(truncation).filter(([, value]) => value.returned !== value.total) : [];
  const complete = delivery.completion === "ready" && delivery.freshness === "current";
  const totals = capped.map(([name, value]) => `${name} ${value.returned}/${value.total}`);
  return {
    complete,
    coverage: truncation ? (totals.length ? "partial" : "complete") : "unknown",
    status: `completion ${delivery.completion ?? "unknown"} · freshness ${delivery.freshness ?? "unknown"} · implementation gate ${delivery.gate ?? "unknown"}${totals.length ? ` · partial coverage: ${totals.join(", ")}` : ""}`,
  };
}

export function renderDeliveryReadiness(delivery: Parameters<typeof deliveryReadiness>[0]) {
  const readiness = deliveryReadiness(delivery);
  const entries = delivery?.truncation ? Object.entries(delivery.truncation) : undefined;
  const sections = entries
    ? entries.map(([name, value]) => `${name}: ${value.returned} of ${value.total} returned`)
    : ["Coverage metadata unavailable: completeness cannot be confirmed"];
  const sectionRows: Array<{ text: string; tone: "returned" | "truncated" | "unknown" }> = entries
    ? entries.flatMap(([, value], index) =>
        value.returned === value.total ? [] : [{ text: `Truncated DTO section · ${sections[index]}`, tone: "truncated" as const }],
      )
    : [{ text: sections[0]!, tone: "unknown" }];
  if (entries && !sectionRows.length) sectionRows.push({ text: `Coverage: complete · ${entries.length} sections fully returned`, tone: "returned" });
  const receipts = orderedWorkflowNodes(delivery?.evidence ?? []).map((item) => `Receipt ${item.id}: ${item.status}`);
  const gate = delivery?.gate === "open" || delivery?.gate === "locked" ? delivery.gate : "unknown";
  return {
    label: `Readiness: ${delivery?.completion ?? "unknown"} · freshness ${delivery?.freshness ?? "unknown"} · implementation gate ${gate}`,
    tone: readiness.complete ? ("success" as const) : delivery?.completion ? ("warning" as const) : ("muted" as const),
    gate,
    coverageLabel: readiness.coverage === "unknown" ? "Coverage: unknown" : `Coverage: ${readiness.coverage}`,
    coverage: readiness.coverage,
    sections,
    sectionRows,
    receipts,
  };
}

/** Attention first, preserving authored order within each group and never changing the DTO. */
export function orderedWorkflowNodes<T extends { status: string }>(nodes: readonly T[]) {
  const priority = (status: string) =>
    ["fail", "failed", "blocked", "stale"].includes(status) ? 0 : ["done", "completed", "complete", "passed", "pass", "fresh"].includes(status) ? 2 : 1;
  return [...nodes].sort((a, b) => priority(a.status) - priority(b.status));
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
    case "approved":
      return `Independent review approved${summary}`;
    case "changes-requested":
      return `Independent review requested changes${summary}`;
    case "stale":
      return `Independent review receipt stale${summary || " · Review source changed since this receipt"}`;
    case "invalid":
      return `Independent review receipt invalid${summary}`;
    case "unreviewed":
      return `No independent code-review receipt${summary}. Any delivery self-review is model-authored and not an independent review.`;
    case undefined:
      return "Independent review status unavailable";
    default:
      return `Independent review status: ${status}${summary}`;
  }
}
