export interface SdkPublicApiInventory {
  schemaVersion: 1;
  entries: Record<string, { types: string; sha256: string }>;
}

export const INVENTORY_PATH: string;
export function hashDeclarationTokens(source: string): string;
export function createSdkPublicApiInventory(): SdkPublicApiInventory;
export function readSdkPublicApiInventory(): SdkPublicApiInventory;
