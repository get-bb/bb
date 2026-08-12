import type { DIRECTIVE_IDS } from "./registry.js";

export type ToolClass = "read" | "write" | "action";
export type ServerAccess =
  | "none"
  | "read-refresh"
  | "read-fetch"
  | "invoke";
export type ToolIdempotency =
  | "idempotent"
  | "convergent"
  | "non-idempotent";
export type DirectiveId = (typeof DIRECTIVE_IDS)[number];

export interface AgentToolSpec {
  readonly name: `fs_${string}`;
  readonly class: ToolClass;
  readonly server: ServerAccess;
  readonly idempotency: ToolIdempotency;
  readonly directive?: DirectiveId;
  readonly page?: { readonly default: 50; readonly max: 200 };
}

export interface ToolError {
  readonly code: string;
  readonly message: string;
  readonly hint: string;
  readonly retryable: boolean;
  readonly details?: unknown;
}

export interface ToolSuccessMeta {
  readonly bytes: number;
  readonly truncated?: boolean;
  readonly nextCursor?: string;
}

export type ToolResult<T> =
  | { readonly ok: true; readonly data: T; readonly meta: ToolSuccessMeta }
  | { readonly ok: false; readonly error: ToolError };

export type ToolSuccess<T> = Extract<ToolResult<T>, { readonly ok: true }>;

export type WriteOperation = "create" | "update" | "noop";

export interface FieldDiff {
  readonly field: string;
  readonly from: string | null;
  readonly to: string | null;
}

export interface WriteResult {
  readonly path: string;
  readonly op: WriteOperation;
  readonly diffSummary: readonly FieldDiff[];
  readonly omittedDiffs: number;
}
