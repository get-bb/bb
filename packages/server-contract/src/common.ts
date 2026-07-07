export type { EmptyInput, Endpoint, Untyped } from "@bb/hono-typed-routes";

export type PathId = { param: { id: string } };
export type PathProjectId = { param: { id: string } };
export type PathThreadAndQueuedMessage = {
  param: { id: string; queuedMessageId: string };
};
/**
 * Thread routes that address a workspace-relative file as a path suffix
 * (`:filePath{.+}` matches across slashes). Clients must percent-encode each
 * path segment themselves — hono's `$url()` substitutes params verbatim.
 */
export type PathThreadAndFilePath = {
  param: { id: string; filePath: string };
};
export type PathThreadAndTerminal = {
  param: { id: string; terminalId: string };
};
export type PathEnvironmentAndTerminal = {
  param: { id: string; terminalId: string };
};
export type PathTerminal = {
  param: { terminalId: string };
};
