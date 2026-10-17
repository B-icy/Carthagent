export declare function convertLegacyTheme(name: string, palette: Record<string, unknown>, lightPalette?: Record<string, unknown>): Record<string, unknown>;
export declare function provisionNativeThemes(profileConfigDir: string, names?: readonly string[]): Promise<{ directory: string; installed: string[] }>;
export declare function provisionDefaultNativeTheme(profileConfigDir: string): Promise<{ directory: string; installed: string[] }>;
