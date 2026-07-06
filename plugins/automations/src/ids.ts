import { randomBytes } from "node:crypto";

function createId(prefix: string): string {
  return `${prefix}_${randomBytes(8).toString("base64url").toLowerCase()}`;
}

export function createAutomationId(): string {
  return createId("auto");
}

export function createAutomationRunId(): string {
  return createId("arun");
}
