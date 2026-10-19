import type { JsonValue } from "@opencode/client";
export type AutoCompactionAction = "on" | "off" | "toggle";
export interface SessionMetadataClient {
  get(input: { sessionID: string }, options: { location: unknown; signal: AbortSignal }): Promise<{ metadata?: Record<string, JsonValue> }>;
  update(input: { sessionID: string; metadata: Record<string, JsonValue> }, options: { location: unknown; signal: AbortSignal }): Promise<unknown>;
}
export function setSessionAutoCompaction(client: SessionMetadataClient, sessionID: string, location: unknown, action: AutoCompactionAction): Promise<boolean>;
