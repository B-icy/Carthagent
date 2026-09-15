/**
 * Ambient types for the engine API surface that extensions consume.
 * At runtime the baked-in engine (vendor/agent) aliases this specifier to its
 * own bundled exports, so extensions never resolve an external package.
 */
declare module '@earendil-works/pi-coding-agent' {
  export const CONFIG_DIR_NAME: string;
  export function truncateTail(
    text: string,
    options: { maxBytes?: number; maxLines?: number }
  ): { content: string; truncated: boolean };

  export interface ExtensionFlag {
    description: string;
    type: 'string' | 'boolean';
    default?: string | boolean;
  }

  export interface ExtensionToolResult {
    content: { type: 'text'; text: string }[];
    details?: unknown;
    isError?: boolean;
  }

  export interface ExtensionTool {
    name: string;
    label?: string;
    description: string;
    parameters: unknown;
    execute(id: string, params: any, signal: any, onUpdate: ((result?: any) => void) | undefined, ctx: ExtensionContext): Promise<ExtensionToolResult>;
  }

  export interface ExtensionCommand {
    description: string;
    handler(args: string, ctx: ExtensionContext): unknown;
  }

  export interface ExtensionAPI {
    registerFlag(name: string, flag: ExtensionFlag): void;
    getFlag(name: string): unknown;
    on(event: string, handler: (...args: any[]) => any): void;
    registerTool(tool: ExtensionTool): void;
    registerCommand(name: string, command: ExtensionCommand): void;
    appendEntry(customType: string, data: unknown): void;
    sendMessage(message: unknown, options?: unknown): void;
  }

  export interface ExtensionContext {
    cwd: string;
    hasUI: boolean;
    isProjectTrusted?(): boolean;
    hasPendingMessages(): boolean;
    sessionManager: {
      getBranch(): any[];
      getSessionId(): string;
      [key: string]: any;
    };
    ui?: any;
    [key: string]: any;
  }
}
