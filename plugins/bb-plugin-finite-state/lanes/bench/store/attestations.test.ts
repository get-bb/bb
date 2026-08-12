import { createFakePluginHost } from "@bb/plugin-sdk/testing";
import { afterEach, describe, expect, it } from "vitest";
import { listBenchAttestations } from "./attestations.js";
import { storeEvidenceCheckpointWithResult } from "./results.js";
import {
  createBenchTestStore,
  DIGEST_A,
  DIGEST_B,
  evidenceBundle,
  SYNCED_AT,
} from "./test-helpers.js";

const hosts: Array<ReturnType<typeof createFakePluginHost>> = [];

afterEach(async () => {
  await Promise.all(hosts.splice(0).map((host) => host.harness.lifecycle.dispose()));
});

describe("bench attestations repository", () => {
  it("marks a locally signature-verified matching subject verified", () => {
    const fixture = createBenchTestStore("attestation-valid");
    hosts.push(fixture.host);
    storeEvidenceCheckpointWithResult(
      fixture.db,
      evidenceBundle({
        attestation: {
          format: "in-toto",
          subjectDigest: DIGEST_A,
          payload: JSON.stringify({ payloadType: "application/vnd.in-toto+json", signatures: [] }),
          verified: true,
        },
      }),
      SYNCED_AT,
    );
    const page = listBenchAttestations(fixture.db, {
      projectId: "project-a",
      pvId: "version-a",
      runId: "run-a",
      pageSize: 20,
      continuation: null,
    });
    expect(page.items[0]).toMatchObject({
      signatureVerified: true,
      subjectMatchesRun: true,
      verified: true,
    });
  });

  it("keeps a signature-verified mismatched subject unverified", () => {
    const fixture = createBenchTestStore("attestation-mismatch");
    hosts.push(fixture.host);
    storeEvidenceCheckpointWithResult(
      fixture.db,
      evidenceBundle({
        attestation: {
          format: "sigstore",
          subjectDigest: DIGEST_B,
          payload: JSON.stringify({ mediaType: "application/vnd.dev.sigstore.bundle+json" }),
          verified: true,
        },
      }),
      SYNCED_AT,
    );
    const stored = fixture.db
      .prepare(
        "SELECT signature_verified, subject_matches_run, verified FROM attestations",
      )
      .get();
    expect(stored).toEqual({ signature_verified: 1, subject_matches_run: 0, verified: 0 });
  });

  it("rejects malformed envelopes and rolls back the run", () => {
    const fixture = createBenchTestStore("attestation-malformed");
    hosts.push(fixture.host);
    expect(() =>
      storeEvidenceCheckpointWithResult(
        fixture.db,
        evidenceBundle({
          attestation: {
            format: "in-toto",
            subjectDigest: DIGEST_A,
            payload: "not-json",
            verified: true,
          },
        }),
        SYNCED_AT,
      ),
    ).toThrow(/json envelope/iu);
    expect(fixture.db.prepare("SELECT COUNT(*) FROM verification_runs").pluck().get()).toBe(0);
  });

  it("never backfills a different current digest onto historical evidence", () => {
    const fixture = createBenchTestStore("attestation-history");
    hosts.push(fixture.host);
    storeEvidenceCheckpointWithResult(fixture.db, evidenceBundle(), SYNCED_AT);
    expect(() =>
      storeEvidenceCheckpointWithResult(
        fixture.db,
        evidenceBundle({ run: { ...evidenceBundle().run, firmwareDigest: DIGEST_B } }),
        "2026-08-12T20:05:00.000Z",
      ),
    ).toThrow(/digest is immutable/iu);
    expect(
      fixture.db.prepare("SELECT firmware_digest FROM verification_runs").pluck().get(),
    ).toBe(DIGEST_A);
  });
});
