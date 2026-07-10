import type {
  BbDesktopServerAddFailureReason,
  BbDesktopServerAddRequest,
} from "@bb/desktop-contract";
import type { ServerProbeResult } from "./server-probe.js";
import type {
  DesktopServerRecord,
  DesktopServerSource,
} from "./server-registry.js";

export type AddDesktopServerResult =
  | AddDesktopServerSuccessResult
  | AddDesktopServerFailureResult;

export interface AddDesktopServerSuccessResult {
  ok: true;
  server: DesktopServerRecord;
}

export interface AddDesktopServerFailureResult {
  ok: false;
  reason: BbDesktopServerAddFailureReason;
}

export interface AddDesktopServerArgs {
  existingUrls: readonly string[];
  probe: (serverUrl: string) => Promise<ServerProbeResult>;
  request: BbDesktopServerAddRequest;
  source: Exclude<DesktopServerSource, "builtin">;
  persist: (args: {
    name: string;
    source: Exclude<DesktopServerSource, "builtin">;
    url: string;
  }) => Promise<DesktopServerRecord>;
}

function normalizeHttpUrl(rawUrl: string): string | null {
  const trimmed = rawUrl.trim();
  if (trimmed.length === 0) {
    return null;
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return null;
  }
  // Drop trailing slash differences for duplicate detection later.
  parsed.hash = "";
  return parsed.toString().replace(/\/$/u, "");
}

function urlsMatch(left: string, right: string): boolean {
  const normalizedLeft = normalizeHttpUrl(left);
  const normalizedRight = normalizeHttpUrl(right);
  if (normalizedLeft === null || normalizedRight === null) {
    return left === right;
  }
  return normalizedLeft === normalizedRight;
}

function failureReasonFromProbe(
  result: ServerProbeResult,
): BbDesktopServerAddFailureReason {
  if (result.kind === "incompatible") {
    return "incompatible";
  }
  return "unreachable";
}

/**
 * Probe-gates a manual/connect server add. Only compatible http(s) URLs are
 * persisted. Duplicate URLs are treated as unreachable so the renderer can show
 * a single failure path without inventing a third reason.
 */
export async function addDesktopServer(
  args: AddDesktopServerArgs,
): Promise<AddDesktopServerResult> {
  const normalizedUrl = normalizeHttpUrl(args.request.url);
  if (normalizedUrl === null) {
    return { ok: false, reason: "unreachable" };
  }

  if (args.existingUrls.some((url) => urlsMatch(url, normalizedUrl))) {
    return { ok: false, reason: "unreachable" };
  }

  const probeResult = await args.probe(normalizedUrl);
  if (probeResult.kind !== "compatible") {
    return { ok: false, reason: failureReasonFromProbe(probeResult) };
  }

  const name =
    args.request.name === undefined || args.request.name.trim().length === 0
      ? ""
      : args.request.name.trim();
  const server = await args.persist({
    name,
    source: args.source,
    url: normalizedUrl,
  });
  return { ok: true, server };
}
