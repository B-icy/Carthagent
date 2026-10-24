import type { Context } from "@opencode/plugin/tui/context";
import type { LocationRef } from "@opencode/client";
import { Workspace, type WorkspaceDelivery, type WorkspaceSnapshot } from "../workspace-rpc.js";
import { SessionControls } from "../session-rpc.js";
import { PullRequests, type PullRequestRecord } from "../pull-request-rpc.js";
import { Archive } from "../archive-rpc.js";
import { Carthagent } from "../rpc.js";
import { Voyages, type VoyagesSnapshot, type VoyagesProfile, type VoyagesItem, type VoyagesQuote } from "../voyages-rpc.js";
import { formatCloudAccount, formatCloudUsage } from "../../../../lib/cloud/client.mjs";

export { Workspace, SessionControls, PullRequests, Archive };
export type { WorkspaceDelivery, WorkspaceSnapshot, PullRequestRecord };
export type { VoyagesSnapshot, VoyagesProfile, VoyagesItem, VoyagesQuote };

const REQUEST_TIMEOUT_MS = 15_000;

type RpcContext = Pick<Context, "client" | "location" | "data">;

type SelectedLocation = LocationRef | (() => LocationRef | undefined);

function requestOptions(context: RpcContext, selectedLocation?: SelectedLocation, signal?: AbortSignal) {
  const location = typeof selectedLocation === "function" ? selectedLocation() : selectedLocation;
  return {
    location: location ?? context.location ?? context.data.location.default(),
    signal: signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  };
}

export function voyagesClient(context: RpcContext, selectedLocation?: SelectedLocation) {
  const rpc = context.client.rpc(Voyages);
  return {
    snapshot: (signal?: AbortSignal) => rpc.snapshot({}, requestOptions(context, selectedLocation, signal)) as Promise<VoyagesSnapshot>,
    customize: (input: { version: number; name?: string; shipName?: string; skin?: string; hair?: string; pattern?: string }, signal?: AbortSignal) => rpc.customize(input, requestOptions(context, selectedLocation, signal)),
    equip: (input: { version: number; slot: string; item: string }, signal?: AbortSignal) => rpc.equip(input, requestOptions(context, selectedLocation, signal)),
    quote: (input: { slot: string; item: string }, signal?: AbortSignal) => rpc.quote(input, requestOptions(context, selectedLocation, signal)),
    purchase: (input: { quoteId: string }, signal?: AbortSignal) => rpc.purchase(input, requestOptions(context, selectedLocation, signal)),
    retryPurchase: (input: { quoteId: string }, signal?: AbortSignal) => rpc.retryPurchase(input, requestOptions(context, selectedLocation, signal)),
  };
}

export function workspaceClient(context: RpcContext, selectedLocation?: SelectedLocation) {
  const rpc = context.client.rpc(Workspace);
  return {
    snapshot: (input?: { projectID?: string }, signal?: AbortSignal) => rpc.snapshot(input ?? {}, requestOptions(context, selectedLocation, signal)) as Promise<WorkspaceSnapshot>,
    open: (input: { sessionID: string }, signal?: AbortSignal) => rpc.open(input, requestOptions(context, selectedLocation, signal)) as Promise<{ opened: boolean; directory: string }>,
    createWorktree: (input: { projectID: string; name: string }, signal?: AbortSignal) => rpc.createWorktree(input, requestOptions(context, selectedLocation, signal)) as Promise<{ directory: string }>,
    createTask: (input: { task: string; branch?: string }, signal?: AbortSignal) => rpc.createTask(input, requestOptions(context, selectedLocation, signal)) as Promise<{ taskID: string; sessionID: string; directory: string }>,
    delivery: (input: { sessionID: string }, signal?: AbortSignal) => rpc.delivery(input, requestOptions(context, selectedLocation, signal)) as Promise<WorkspaceDelivery>,
    review: (input: { sessionID: string }, signal?: AbortSignal) => rpc.review(input, requestOptions(context, selectedLocation, signal)) as Promise<{ status: string; summary?: string }>,
    startReview: (input: { sessionID: string }, signal?: AbortSignal) => rpc.startReview(input, requestOptions(context, selectedLocation, signal)) as Promise<{ status: string; summary: string; sessionID?: string }>,
    events: rpc.events,
  };
}

export function sessionControls(context: RpcContext, selectedLocation?: SelectedLocation) {
  const rpc = context.client.rpc(SessionControls);
  return {
    framing: (input: { sessionID: string; enabled?: boolean }, signal?: AbortSignal) => rpc.framing(input, requestOptions(context, selectedLocation, signal)) as Promise<{ enabled: boolean }>,
    compact: (input: { sessionID: string; notes?: string }, signal?: AbortSignal) => rpc.compact(input, requestOptions(context, selectedLocation, signal)) as Promise<{ admitted: boolean }>,
  };
}

export function pullRequestClient(context: RpcContext, selectedLocation?: SelectedLocation) {
  const rpc = context.client.rpc(PullRequests);
  return {
    list: (input: { sessionID: string; taskID: string }, signal?: AbortSignal) => rpc.list(input, requestOptions(context, selectedLocation, signal)) as Promise<{ pullRequests: PullRequestRecord[] }>,
    associate: (input: { sessionID: string; taskID: string; number: number }, signal?: AbortSignal) => rpc.associate(input, requestOptions(context, selectedLocation, signal)) as Promise<{ pullRequest: PullRequestRecord }>,
    refresh: (input: { sessionID: string; taskID: string; number?: number }, signal?: AbortSignal) => rpc.refresh(input, requestOptions(context, selectedLocation, signal)) as Promise<{ pullRequest: PullRequestRecord }>,
  };
}

export function shipClient(context: RpcContext, selectedLocation?: SelectedLocation) {
  const rpc = context.client.rpc(Carthagent);
  return {
    account: (signal?: AbortSignal) => rpc.shipAccount({}, requestOptions(context, selectedLocation, signal)),
    usage: (input: { limit?: number } = {}, signal?: AbortSignal) => rpc.shipUsage(input, requestOptions(context, selectedLocation, signal)),
    billing: (input: { action: "checkout" | "portal" }, signal?: AbortSignal) => rpc.shipBilling(input, requestOptions(context, selectedLocation, signal)),
    logout: (input: { session?: string } = {}, signal?: AbortSignal) => rpc.shipLogout(input, requestOptions(context, selectedLocation, signal)),
  };
}

export function archiveClient(context: RpcContext, selectedLocation?: SelectedLocation) {
  const rpc = context.client.rpc(Archive);
  return {
    list: (input: { offset?: number; limit?: number } = {}, signal?: AbortSignal) => rpc.list(input, requestOptions(context, selectedLocation, signal)),
    search: (input: { query: string; offset?: number; limit?: number }, signal?: AbortSignal) => rpc.search(input, requestOptions(context, selectedLocation, signal)),
    read: (input: { id: string }, signal?: AbortSignal) => rpc.read(input, requestOptions(context, selectedLocation, signal)),
    export: (input: { id: string; format?: "json" | "jsonl" }, signal?: AbortSignal) => rpc.export(input, requestOptions(context, selectedLocation, signal)),
  };
}

export function cloudAccountText(account: Record<string, unknown>) {
  return formatCloudAccount(account);
}

export function cloudUsageText(usage: Record<string, unknown>, account?: Record<string, unknown>) {
  return formatCloudUsage(usage, { account } as Parameters<typeof formatCloudUsage>[1]);
}

export function archiveItemText(item: Record<string, unknown>) {
  return `${String(item.id)} · ${String(item.messageCount)} messages${item.createdAt ? ` · ${String(item.createdAt)}` : ""}${item.excerpt ? `\n${String(item.excerpt)}` : ""}`;
}

export function rpcEventOptions(_context: RpcContext, signal?: AbortSignal): { signal?: AbortSignal } {
  return signal ? { signal } : {};
}
