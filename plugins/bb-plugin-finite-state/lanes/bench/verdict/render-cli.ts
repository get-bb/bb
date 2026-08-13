import type { PluginCliContext, PluginCliResult } from "@bb/plugin-sdk";
import type Database from "better-sqlite3";
import type { VerdictEvidence, VerdictResult } from "./evaluate.js";
import { getOtaVerdict } from "./query.js";

const VERDICT_LABELS = {
  SAFE_TO_OTA: "Safe to OTA",
  NOT_SAFE: "Not safe to OTA",
  INCONCLUSIVE: "Inconclusive",
} as const;

function evidenceRefs(evidence: VerdictEvidence): string {
  const refs = [
    `matrix=requirements/${encodeURIComponent(evidence.requirementId)}/verifications/${evidence.tier}`,
    ...(evidence.runId ? [`run=bench/runs/${encodeURIComponent(evidence.runId)}`] : []),
    ...(evidence.checkId ? [`check=${evidence.checkId}`] : []),
    ...(evidence.resultId ? [`result=${evidence.resultId}`] : []),
    ...(evidence.attestationId ? [`attestation=${evidence.attestationId}`] : []),
  ];
  return refs.join(" · ");
}

function evidenceLine(evidence: VerdictEvidence): string {
  const scope = evidence.required ? "required" : "optional";
  const outcome = evidence.outcome ? ` · outcome=${evidence.outcome}` : "";
  return `- [${evidence.state}] ${evidence.requirementId}/${evidence.tier} (${scope})${outcome} · ${evidenceRefs(evidence)}`;
}

/** Stable, ANSI-free text projection over the evaluator result. */
export function renderVerdictCli(result: VerdictResult): string {
  const blocking = result.evidence.filter((entry) =>
    entry.required && entry.state !== "proven");
  const signatures = result.evidence.filter((entry) =>
    entry.state === "proven" && entry.attestationVerified);
  const lines = [
    `Verdict: ${VERDICT_LABELS[result.verdict]}`,
    `Firmware digest: ${result.firmwareDigest ?? "unavailable"}${result.stale ? " (historical; not currently mounted)" : ""}`,
    `Current mounted digest: ${result.currentMountedDigest ?? "unavailable"}`,
    `Coverage: ${result.proven}/${result.required} required cells proven; ${result.failed} failed; ${result.gaps} gaps`,
  ];
  if (result.issues.length > 0) {
    lines.push("Issues:", ...result.issues.map((issue) => `- ${issue.code}: ${issue.message}`));
  }
  lines.push(
    "Blocking failures and gaps:",
    ...(blocking.length > 0 ? blocking.map(evidenceLine) : ["- none"]),
    "Evidence coverage:",
    ...(result.evidence.length > 0 ? result.evidence.map(evidenceLine) : ["- none"]),
    "Verified signatures:",
    ...(signatures.length > 0
      ? signatures.map((entry) =>
        `- ${entry.signerIdentity ?? "identity unavailable"} · ${entry.attestationId ?? "attestation unavailable"}`)
      : ["- none"]),
    `Computed at: ${result.computedAt}`,
  );
  return `${lines.join("\n")}\n`;
}

export type BenchVerdictCliRunner = (
  argv: string[],
  context: PluginCliContext,
) => Promise<PluginCliResult>;

function optionValue(args: string[], index: number): { value: string; consumed: number } {
  const current = args[index] ?? "";
  const equals = current.indexOf("=");
  if (equals >= 0) {
    const value = current.slice(equals + 1);
    if (!value) throw new Error("--digest requires a value");
    return { value, consumed: 1 };
  }
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error("--digest requires a value");
  return { value, consumed: 2 };
}

export function createBenchVerdictCliRunner(
  db: Database.Database,
  now?: () => string,
): BenchVerdictCliRunner {
  return async (argv, context) => {
    const args = argv[0] === "bench" ? argv.slice(1) : [...argv];
    const command = args.shift();
    const pvId = args.shift();
    const usage = "usage: bb finite-state bench verdict <pv-id> [--digest <sha256>] [--json]";
    if (command !== "verdict" || !pvId || pvId.startsWith("--")) {
      throw new Error(usage);
    }
    let digest: string | undefined;
    let json = false;
    for (let index = 0; index < args.length;) {
      const arg = args[index] ?? "";
      if (arg === "--json") {
        json = true;
        index += 1;
      } else if (arg === "--digest" || arg.startsWith("--digest=")) {
        const option = optionValue(args, index);
        if (!/^[a-f0-9]{64}$/u.test(option.value)) {
          throw new Error("--digest must be a lowercase sha256 digest");
        }
        digest = option.value;
        index += option.consumed;
      } else {
        throw new Error(`${usage}; unexpected argument ${arg}`);
      }
    }
    if (!context.projectId) {
      throw new Error("BENCH_PROJECT_CONTEXT_REQUIRED: invoke from a bb project thread");
    }
    const result = await getOtaVerdict(
      { db, projectId: context.projectId, ...(now ? { now } : {}) },
      pvId,
      digest,
    );
    return {
      exitCode: result.verdict === "SAFE_TO_OTA"
        ? 0
        : result.verdict === "NOT_SAFE" ? 1 : 2,
      stdout: json ? `${JSON.stringify(result)}\n` : renderVerdictCli(result),
      stderr: "",
    };
  };
}
