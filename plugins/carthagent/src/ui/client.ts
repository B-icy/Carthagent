import { Workspace, type WorkspaceSnapshot } from "../workspace-rpc.js";
import { SessionControls } from "../session-rpc.js";

export { Workspace, SessionControls };
export type { WorkspaceSnapshot };

const REQUEST_TIMEOUT_MS = 15_000;

function requestOptions(context: { location?: any; data: { location: { default(): any } } }, signal?: AbortSignal) {
  return {
    location: context.location ?? context.data.location.default(),
    signal: signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  };
}

export function workspaceClient(context: { client: { rpc: (definition: typeof Workspace) => any }; location?: any; data: { location: { default(): any } } }, selectedLocation?: any) {
  const rpc = context.client.rpc(Workspace);
  const callContext = selectedLocation ? { ...context, location: selectedLocation } : context;
  return {
    snapshot: (input?: { projectID?: string }, signal?: AbortSignal) => rpc.snapshot(input ?? {}, requestOptions(callContext, signal)) as Promise<WorkspaceSnapshot>,
    open: (input: { sessionID: string }, signal?: AbortSignal) => rpc.open(input, requestOptions(callContext, signal)),
    createWorktree: (input: { projectID: string; name: string }, signal?: AbortSignal) => rpc.createWorktree(input, requestOptions(callContext, signal)),
    createTask: (input: { task: string; branch?: string }, signal?: AbortSignal) => rpc.createTask(input, requestOptions(callContext, signal)),
    delivery: (input: { sessionID: string }, signal?: AbortSignal) => rpc.delivery(input, requestOptions(callContext, signal)),
    review: (input: { sessionID: string }, signal?: AbortSignal) => rpc.review(input, requestOptions(callContext, signal)),
    startReview: (input: { sessionID: string }, signal?: AbortSignal) => rpc.startReview(input, requestOptions(callContext, signal)),
    events: rpc.events,
  };
}

export function sessionControls(context: { client: { rpc: (definition: typeof SessionControls) => any }; location?: any; data: { location: { default(): any } } }, selectedLocation?: any) {
  const rpc = context.client.rpc(SessionControls);
  const callContext = selectedLocation ? { ...context, location: selectedLocation } : context;
  return {
    framing: (input: { sessionID: string; enabled?: boolean }, signal?: AbortSignal) => rpc.framing(input, requestOptions(callContext, signal)),
    compact: (input: { sessionID: string; notes?: string }, signal?: AbortSignal) => rpc.compact(input, requestOptions(callContext, signal)),
  };
}

export function rpcEventOptions(_context: { location?: any; data: { location: { default(): any } } }, signal?: AbortSignal) {
  return signal ? { signal } : {};
}
