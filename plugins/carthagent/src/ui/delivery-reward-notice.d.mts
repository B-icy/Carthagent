export const DELIVERY_REWARD_NOTICE: string;
export function createDeliveryRewardNotice(options: {
  delivery: (sessionID: string, signal?: AbortSignal) => Promise<{ status?: string; runId?: string } | undefined>;
  notify: (message: string, sessionID: string) => void;
  signal?: AbortSignal;
}): { onSucceeded(event: any): Promise<boolean> };
