import type { Context } from "@opencode/plugin/tui/context";
import type { LocationRef } from "@opencode/client";
import { Workspace, type WorkspaceSnapshot } from "../workspace-rpc.js";
import { SessionControls } from "../session-rpc.js";

export { Workspace, SessionControls };
export type { WorkspaceSnapshot };

const REQUEST_TIMEOUT_MS = 15_000;

type RpcContext = Pick<Context, "client" | "location" | "data">;

function requestOptions(context: RpcContext, selectedLocation?: LocationRef, signal?: AbortSignal) {
  return {
    location: selectedLocation ?? context.location ?? context.data.location.default(),
    signal: signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  };
}

export function workspaceClient(context: RpcContext, selectedLocation?: LocationRef) {
  const rpc = context.client.rpc(Workspace);
  return {
    snapshot: (input?: { projectID?: string }, signal?: AbortSignal) => rpc.snapshot(input ?? {}, requestOptions(context, selectedLocation, signal)) as Promise<WorkspaceSnapshot>,
    open: (input: { sessionID: string }, signal?: AbortSignal) => rpc.open(input, requestOptions(context, selectedLocation, signal)) as Promise<{ opened: boolean; directory: string }>,
    createWorktree: (input: { projectID: string; name: string }, signal?: AbortSignal) => rpc.createWorktree(input, requestOptions(context, selectedLocation, signal)) as Promise<{ directory: string }>,
    createTask: (input: { task: string; branch?: string }, signal?: AbortSignal) => rpc.createTask(input, requestOptions(context, selectedLocation, signal)) as Promise<{ taskID: string; sessionID: string; directory: string }>,
    delivery: (input: { sessionID: string }, signal?: AbortSignal) => rpc.delivery(input, requestOptions(context, selectedLocation, signal)) as Promise<{ plan?: unknown; evidence?: unknown; status: string }>,
    review: (input: { sessionID: string }, signal?: AbortSignal) => rpc.review(input, requestOptions(context, selectedLocation, signal)) as Promise<{ status: string; summary?: string }>,
    startReview: (input: { sessionID: string }, signal?: AbortSignal) => rpc.startReview(input, requestOptions(context, selectedLocation, signal)) as Promise<{ status: string; summary: string; sessionID?: string }>,
    events: rpc.events,
  };
}

export function sessionControls(context: RpcContext, selectedLocation?: LocationRef) {
  const rpc = context.client.rpc(SessionControls);
  return {
    framing: (input: { sessionID: string; enabled?: boolean }, signal?: AbortSignal) => rpc.framing(input, requestOptions(context, selectedLocation, signal)) as Promise<{ enabled: boolean }>,
    compact: (input: { sessionID: string; notes?: string }, signal?: AbortSignal) => rpc.compact(input, requestOptions(context, selectedLocation, signal)) as Promise<{ admitted: boolean }>,
  };
}

export function rpcEventOptions(_context: RpcContext, signal?: AbortSignal): { signal?: AbortSignal } {
  return signal ? { signal } : {};
}
