import { FirmwareCacheError } from "../../firmware/cache/layout.js";
import type {
  CascadeDeps,
  CorpusObservation,
  StaticQuery,
  TierVerdict,
} from "./types.js";
import { CascadeError } from "./types.js";

function sameSequence(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function corpusOutcome(
  query: Extract<StaticQuery, { kind: "init_sequence" }>,
  observed: readonly string[] | undefined,
  corpus: CorpusObservation,
): "confirmed" | "refuted" {
  return observed &&
    sameSequence(observed, query.expectedSequence) &&
    sameSequence(observed, corpus.initSequence)
    ? "confirmed"
    : "refuted";
}

export async function runD0(
  deps: CascadeDeps,
  query: StaticQuery,
  signal: AbortSignal,
): Promise<TierVerdict> {
  signal.throwIfAborted();
  // WP-47 owns this check and its MOUNT_* error vocabulary. Do not duplicate it.
  const mount = await deps.loadFirmwareReadiness(
    query.projectVersionId,
    signal,
  );
  if (mount.readiness !== "fully_materialized") {
    throw new FirmwareCacheError(
      "MOUNT_INCOMPLETE",
      `Firmware bytes are not fully materialized (readiness: ${mount.readiness}).`,
    );
  }
  if (!deps.stp.configured) {
    throw new CascadeError(
      "STP_NOT_CONFIGURED",
      "Configure the packaged STP static-analysis driver before running D0.",
      "debug-bench.stp",
    );
  }
  const result = await deps.stp.run(mount.rootfsPath, query, signal);
  if (result.command.length === 0) {
    throw new CascadeError(
      "STP_PROVENANCE_MISSING",
      "The STP driver returned no reproducible command.",
    );
  }

  let outcome: TierVerdict["outcome"] =
    result.status === "failed"
      ? "inconclusive"
      : result.matched
        ? "confirmed"
        : "refuted";
  const evidence = [...result.evidence];
  const annotations: NonNullable<TierVerdict["annotations"]> = [];
  let corpusState = "not_applicable";

  if (query.kind === "init_sequence" && result.status === "completed") {
    const corpus = deps.corpus
      ? await deps.corpus.findInitSequence(query.siliconFamily, signal)
      : null;
    if (corpus) {
      if (corpus.siliconFamily !== query.siliconFamily) {
        throw new CascadeError(
          "CORPUS_SILICON_MISMATCH",
          "The corpus returned observations for a different silicon family.",
        );
      }
      corpusState = "compared";
      evidence.push(...corpus.evidence);
      outcome = corpusOutcome(query, result.observedSequence, corpus);
    } else {
      corpusState = "absent";
      annotations.push({
        code: "BLOB_ONLY_ANALYSIS",
        message: `No RE-corpus observations exist for ${query.siliconFamily}; D0 used the mounted blob only.`,
      });
    }
  }

  return {
    tier: "d0",
    hypothesisId: query.hypothesis.id,
    outcome,
    forcedEscalation: false,
    evidence,
    producedBy: {
      command: [...result.command],
      inputs: {
        projectVersionId: query.projectVersionId,
        queryKind: query.kind,
        mountGeneration: mount.manifestGeneration,
        corpus: corpusState,
      },
    },
    ...(annotations.length > 0 ? { annotations } : {}),
  };
}

export const runD0Static = runD0;
