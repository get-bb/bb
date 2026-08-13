import type Database from "better-sqlite3";

import { findingStableKey, type FindingIdentity } from "../../../lib/sync/registry.js";
import { registerResolver } from "../../sync/engine/adapter.js";
import {
  parseEncodedFindingKey,
  resolveEncodedFinding,
  resolveFinding,
  StableFindingKeyError,
  type StableFindingKey,
} from "./resolve.js";

export {
  enforcePin,
  FindingPinError,
  parseEncodedFindingKey,
  resolveEncodedFinding,
  resolveFinding,
  StableFindingKeyError,
  type FindingMatchReason,
  type FindingResolution,
  type Pin,
  type StableFindingKey,
} from "./resolve.js";
export {
  foldFindingComponent,
  foldFindingGroup,
  normalizeFindingPurl,
  normalizeFindingVersion,
} from "./fold.js";

function codecInput(identity: FindingIdentity): Readonly<Record<string, unknown>> & FindingIdentity {
  return {
    cve: identity.cve,
    purl: identity.purl,
    name: identity.name,
    group: identity.group,
    version: identity.version,
  };
}

function fullKey(project: string, identity: FindingIdentity): StableFindingKey {
  return {
    schema: "fs-finding-key/v1",
    project,
    purl: identity.purl ?? null,
    name: identity.name,
    group: identity.group ?? null,
    version: identity.version ?? null,
    cve: identity.cve,
  };
}

/** Installs WP-23's cache-only, read-only resolver for VEX decisions. */
export function registerFindingsStableKeyStub(db: Database.Database): void {
  registerResolver("vexDecision", async (encoded, scope, context) => {
    if (scope.projectVersionId === null) return { resolved: false };
    if (context === undefined) {
      const result = resolveEncodedFinding(db, encoded, scope.projectId, scope.projectVersionId);
      return result.state === "resolved"
        ? { resolved: true, detail: result }
        : { resolved: false };
    }

    const parsed = parseEncodedFindingKey(encoded);
    if (context.kind !== "finding" || context.identity.cve !== parsed.cve) {
      throw new StableFindingKeyError("Finding resolver context does not match the stable key");
    }
    const canonical = findingStableKey(codecInput(context.identity), parsed.tier);
    if (canonical !== encoded) {
      throw new StableFindingKeyError("Finding resolver context does not match the stable key");
    }
    const result = resolveFinding(
      db,
      fullKey(scope.projectId, context.identity),
      scope.projectVersionId,
      context.pin,
    );
    return result.state === "resolved"
      ? { resolved: true, detail: result }
      : { resolved: false };
  });
}
