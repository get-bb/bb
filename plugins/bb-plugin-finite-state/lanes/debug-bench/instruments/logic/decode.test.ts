import { mkdirSync, mkdtempSync, rmSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { CaptureArtifact } from "../driver.js";
import { decodeCapture, type DecodedProtocol } from "./decode.js";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function fixtureArtifact(): CaptureArtifact {
  return {
    path: fileURLToPath(new URL("./fixtures/session.json", import.meta.url)),
    format: "finite-state-logic-json-v1",
    durationMs: 50,
    channels: 8,
  };
}

function tempArtifact(manifest: unknown): CaptureArtifact {
  const directory = mkdtempSync(join(tmpdir(), "fs127-decode-"));
  directories.push(directory);
  const path = join(directory, "capture.json");
  writeFileSync(path, JSON.stringify(manifest), "utf8");
  return { path, format: "finite-state-logic-json-v1", durationMs: 1, channels: 1 };
}

describe("logic protocol decode", () => {
  it("normalizes golden SPI, I2C, UART, and CAN frames from replay", async () => {
    const expected = {
      spi: { type: "transfer", data: "0x9F 0xEF 0x40 0x18" },
      i2c: { type: "write", data: "0x50: 0x00 0x2A" },
      uart: { type: "data", data: "OK\\r\\n" },
      can: { type: "data", data: "18DAF110#0210030000000000" },
    } satisfies Record<DecodedProtocol, { type: string; data: string }>;
    for (const protocol of ["spi", "i2c", "uart", "can"] as const) {
      await expect(decodeCapture(fixtureArtifact(), protocol, { pageSize: 1 }))
        .resolves.toMatchObject({
          items: [expect.objectContaining({ protocol, ...expected[protocol] })],
          total: protocol === "spi" ? 2 : 1,
        });
    }
  });

  it("pages a large decoded frame collection with opaque protocol-bound cursors", async () => {
    const frames = Array.from({ length: 501 }, (_, index) => ({
      startTimeSeconds: index / 1_000,
      endTimeSeconds: (index + 1) / 1_000,
      type: "data",
      data: index.toString(16),
      fields: { sequence: index },
    }));
    const artifact = tempArtifact({
      schema: "finite-state-logic-v1",
      decoderExports: {},
      frames: { uart: frames },
    });
    const first = await decodeCapture(artifact, "uart", { pageSize: 200 });
    expect(first).toMatchObject({ total: 501, items: { length: 200 } });
    expect(first.cursor).not.toBeNull();
    const second = await decodeCapture(artifact, "uart", { pageSize: 200, cursor: first.cursor });
    expect(second.items[0]).toMatchObject({ index: 200, data: "c8" });
    await expect(decodeCapture(artifact, "spi", { cursor: first.cursor }))
      .rejects.toMatchObject({ code: "DECODE_CURSOR_INVALID" });
  });

  it("rejects malformed vendor exports without crashing", async () => {
    const malformed = tempArtifact({
      schema: "finite-state-logic-v1",
      decoderExports: { spi: "malformed.csv" },
      frames: {},
    });
    writeFileSync(join(malformed.path, "..", "malformed.csv"), "No Time,No Data\n1,2\n", "utf8");
    await expect(decodeCapture(malformed, "spi"))
      .rejects.toMatchObject({ code: "DECODE_EXPORT_MALFORMED" });
    const absent = tempArtifact({
      schema: "finite-state-logic-v1",
      decoderExports: {},
      frames: {},
    });
    await expect(decodeCapture(absent, "can"))
      .rejects.toMatchObject({ code: "DECODE_PROTOCOL_UNAVAILABLE" });
  });

  it("confines and size-bounds vendor decoder exports", async () => {
    const directory = mkdtempSync(join(tmpdir(), "fs127-decode-outside-"));
    directories.push(directory);
    const outside = join(directory, "outside.csv");
    writeFileSync(outside, "Time,Data\n0,escape\n", "utf8");
    const nested = join(directory, "capture");
    mkdirSync(nested);
    const artifact = {
      path: join(nested, "capture.json"),
      format: "finite-state-logic-json-v1",
      durationMs: 1,
      channels: 1,
    } satisfies CaptureArtifact;
    writeFileSync(artifact.path, JSON.stringify({
      schema: "finite-state-logic-v1",
      decoderExports: { spi: "../outside.csv" },
      frames: {},
    }), "utf8");
    await expect(decodeCapture(artifact, "spi"))
      .rejects.toMatchObject({ code: "DECODE_EXPORT_MALFORMED" });

    const oversized = tempArtifact({
      schema: "finite-state-logic-v1",
      decoderExports: { can: "large.csv" },
      frames: {},
    });
    const largePath = join(oversized.path, "..", "large.csv");
    writeFileSync(largePath, "Time,Data\n", "utf8");
    truncateSync(largePath, 64 * 1024 * 1024 + 1);
    await expect(decodeCapture(oversized, "can"))
      .rejects.toMatchObject({ code: "DECODE_EXPORT_TOO_LARGE" });
  });
});
