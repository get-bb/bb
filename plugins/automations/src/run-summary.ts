import type { AutomationRunStatus } from "./rpc-types.js";

export function formatRunTransportLabel(status: AutomationRunStatus): string {
  return `transport=${status}`;
}

export function formatRunDomainLabel(
  terminalToken: string | null,
): string | null {
  return terminalToken === null ? null : `domain=${terminalToken}`;
}
