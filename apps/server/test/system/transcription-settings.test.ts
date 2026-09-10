import { describe, expect, it } from "vitest";
import {
  systemAiServicesSchema,
  systemConfigResponseSchema,
} from "@bb/server-contract";
import { readJson } from "../helpers/json.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

async function putTranscription(
  harness: TestAppHarness,
  body: unknown,
): Promise<Response> {
  return harness.app.request("/api/v1/settings/transcription", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("transcription settings", () => {
  it("persists validated values and reflects them in /system/config", async () => {
    await withTestHarness(async (harness) => {
      const response = await putTranscription(harness, {
        transcriptionModel: "codex/gpt-transcribe",
        transcriptionMaxBytes: 10 * 1024 * 1024,
        transcriptionTimeoutMaxMs: 120_000,
        recordingBitrate: 48_000,
      });
      expect(response.status).toBe(200);
      const aiServices = systemAiServicesSchema.parse(await readJson(response));
      expect(aiServices).toMatchObject({
        transcription: "codex/gpt-transcribe",
        transcriptionMaxBytes: 10 * 1024 * 1024,
        transcriptionTimeoutMaxMs: 120_000,
        recordingBitrate: 48_000,
      });

      const config = await harness.app.request("/api/v1/system/config");
      const parsed = systemConfigResponseSchema.parse(await readJson(config));
      expect(parsed.aiServices).toMatchObject({
        transcription: "codex/gpt-transcribe",
        transcriptionMaxBytes: 10 * 1024 * 1024,
        transcriptionTimeoutMaxMs: 120_000,
        recordingBitrate: 48_000,
      });
    });
  });

  it("updates only the provided field, leaving others unchanged", async () => {
    await withTestHarness(async (harness) => {
      const before = systemConfigResponseSchema.parse(
        await readJson(await harness.app.request("/api/v1/system/config")),
      );

      const response = await putTranscription(harness, {
        recordingBitrate: 64_000,
      });
      expect(response.status).toBe(200);
      const aiServices = systemAiServicesSchema.parse(await readJson(response));
      expect(aiServices.recordingBitrate).toBe(64_000);
      expect(aiServices.transcription).toBe(before.aiServices.transcription);
      expect(aiServices.transcriptionMaxBytes).toBe(
        before.aiServices.transcriptionMaxBytes,
      );
    });
  });

  it("rejects an audio limit above the 10MB cap without persisting", async () => {
    await withTestHarness(async (harness) => {
      const before = systemConfigResponseSchema.parse(
        await readJson(await harness.app.request("/api/v1/system/config")),
      );
      const response = await putTranscription(harness, {
        transcriptionMaxBytes: 10 * 1024 * 1024 + 1,
      });
      expect(response.status).toBe(400);
      await expect(readJson(response)).resolves.toMatchObject({
        code: "invalid_request",
      });

      const after = systemConfigResponseSchema.parse(
        await readJson(await harness.app.request("/api/v1/system/config")),
      );
      expect(after.aiServices.transcriptionMaxBytes).toBe(
        before.aiServices.transcriptionMaxBytes,
      );
    });
  });

  it("rejects a model without provider/model format", async () => {
    await withTestHarness(async (harness) => {
      const response = await putTranscription(harness, {
        transcriptionModel: "gpt-transcribe",
      });
      expect(response.status).toBe(400);
    });
  });

  it("rejects a timeout below the floor", async () => {
    await withTestHarness(async (harness) => {
      const response = await putTranscription(harness, {
        transcriptionTimeoutMaxMs: 9_999,
      });
      expect(response.status).toBe(400);
    });
  });

  it("rejects an empty update", async () => {
    await withTestHarness(async (harness) => {
      const response = await putTranscription(harness, {});
      expect(response.status).toBe(400);
    });
  });

  it("rejects unknown fields", async () => {
    await withTestHarness(async (harness) => {
      const response = await putTranscription(harness, {
        transcriptionModel: "codex/gpt-transcribe",
        unexpected: true,
      });
      expect(response.status).toBe(400);
    });
  });
});
