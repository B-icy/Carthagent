export interface NativeReviewOffer {
  sessionID: string;
  runKey: string;
  writes: number;
  start: () => Promise<boolean>;
}

export interface NativeReviewConsumerOptions {
  mode: (sessionID: string) => string;
  diff: (sessionID: string, signal?: AbortSignal) => Promise<unknown>;
  offer: (value: NativeReviewOffer) => Promise<unknown>;
  kickoff: (sessionID: string, signal?: AbortSignal) => Promise<unknown>;
  latestUserMessage?: (sessionID: string) => { type?: string; metadata?: Record<string, unknown> } | undefined;
  isLoopActive?: (sessionID: string) => boolean;
  setLoopActive?: (sessionID: string, active: boolean) => void;
  signal?: AbortSignal;
}

export function sendNativeReviewKickoff(options: { client: any; sessionID: string; signal?: AbortSignal; prompt?: string }): Promise<void>;
export function nativeReviewMode(session: any, config: any, explicitMode?: string): string;
export function createNativeReviewConsumer(options: NativeReviewConsumerOptions): {
  setLoopActive(sessionID: string, active: boolean): void;
  onUserPromptAdmitted(sessionID: string, message?: { type?: string; metadata?: Record<string, unknown> }): void;
  onStarted(event: any): void;
  onSucceeded(event: any): Promise<void>;
  onFailed(event: any): Promise<void>;
  onInterrupted(event: any): Promise<void>;
  dispose(): void;
};
export function subscribeNativeReviewEvents(data: any, consumer: ReturnType<typeof createNativeReviewConsumer>, onError?: (error: unknown) => void): Array<() => void>;
