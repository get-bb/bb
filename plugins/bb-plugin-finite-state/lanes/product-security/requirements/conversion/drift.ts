import {
  buildConversionBundle,
  conversionSourceDigest,
  getStoredConversionBundle,
  type EarsConversionBundleMeta,
} from "./bundle.js";
import { spawnConversionThread, type ConversionSpawnResult } from "./spawn.js";

export interface ConversionDriftReport {
  bundleId: string;
  driftedRequirementIds: string[];
  unchangedRequirementIds: string[];
  removedRequirementIds: string[];
}

export async function detectConversionDrift(bundleId: string): Promise<ConversionDriftReport> {
  const bundle = getStoredConversionBundle(bundleId);
  const current = await bundle.deps.loadPullSnapshot();
  const currentById = new Map(
    (current?.requirements ?? []).map((source) => [source.requirementId, source]),
  );
  const driftedRequirementIds: string[] = [];
  const unchangedRequirementIds: string[] = [];
  const removedRequirementIds: string[] = [];
  for (const source of bundle.sources) {
    const next = currentById.get(source.requirementId);
    if (!next) removedRequirementIds.push(source.requirementId);
    else if (conversionSourceDigest(next) === source.sourceDigest) unchangedRequirementIds.push(source.requirementId);
    else driftedRequirementIds.push(source.requirementId);
  }
  return {
    bundleId,
    driftedRequirementIds,
    unchangedRequirementIds,
    removedRequirementIds,
  };
}

export async function buildDriftRerunBundle(bundleId: string): Promise<EarsConversionBundleMeta | null> {
  const bundle = getStoredConversionBundle(bundleId);
  const drift = await detectConversionDrift(bundleId);
  if (drift.driftedRequirementIds.length === 0) return null;
  return buildConversionBundle(bundle.deps, drift.driftedRequirementIds);
}

export async function spawnDriftRerun(bundleId: string): Promise<ConversionSpawnResult | null> {
  const next = await buildDriftRerunBundle(bundleId);
  return next ? spawnConversionThread(next.bundleId) : null;
}
