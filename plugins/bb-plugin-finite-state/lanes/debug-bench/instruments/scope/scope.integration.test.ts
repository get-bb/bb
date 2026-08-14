import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { DeviceClaim } from "../../registry/claims.js";
import type { CaptureArtifactSink, InstrumentDriver } from "../driver.js";
import { createPicoScopeDriver } from "./picoscope.js";
import { createScpiScopeDriver } from "./scpi.js";

const enabled = process.env.FS_SCOPE_INTEGRATION === "1";
const directories: string[] = [];

afterAll(() => {
  for (const directory of directories)
    rmSync(directory, { recursive: true, force: true });
});

function outputSink(): CaptureArtifactSink {
  const directory = mkdtempSync(join(tmpdir(), "fs129-scope-hardware-"));
  directories.push(directory);
  return {
    directory,
    async record() {
      /* The integration assertion reads the recorded path. */
    },
  };
}

function claim(deviceId: string): DeviceClaim {
  return {
    deviceId,
    holder: "fs129-hardware-integration",
    scope: "machine",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  };
}

async function assertRealCapture(
  driver: InstrumentDriver,
  transport: Parameters<InstrumentDriver["open"]>[0],
  deviceClaim: DeviceClaim,
): Promise<void> {
  await expect(driver.detect(transport)).resolves.toMatchObject({
    kind: "scope",
  });
  const session = await driver.open(
    transport,
    deviceClaim,
    new AbortController().signal,
  );
  try {
    const artifact = await session.capture(
      {
        durationMs: 1,
        sampleRateHz: 1_000,
        channels: [0],
        artifactSink: outputSink(),
      },
      new AbortController().signal,
    );
    expect(JSON.parse(readFileSync(artifact.path, "utf8"))).toMatchObject({
      schema: "finite-state-scope-v1",
      channels: expect.any(Object),
    });
  } finally {
    await session.close();
  }
}

describe.skipIf(!enabled)("scope hardware integration", () => {
  it("captures one normalized PicoScope block", async () => {
    const serial = process.env.FS_PICOSCOPE_SERIAL;
    if (!serial)
      throw new Error(
        "FS_PICOSCOPE_SERIAL is required when hardware integration is enabled.",
      );
    const deviceClaim = claim("hardware-picoscope");
    const driver = createPicoScopeDriver({
      verifyClaim() {
        /* The opt-in fixture supplies the live physical claim identity. */
      },
      registeredSerials: () => [serial],
      serialForDeviceId: () => serial,
    });
    await assertRealCapture(
      driver,
      { kind: "usb", serial, path: null },
      deviceClaim,
    );
  });

  it("captures one normalized SCPI/LAN block", async () => {
    const host = process.env.FS_SCPI_SCOPE_HOST;
    const port = Number(process.env.FS_SCPI_SCOPE_PORT ?? "5025");
    if (!host || !Number.isInteger(port)) {
      throw new Error(
        "FS_SCPI_SCOPE_HOST and an integer FS_SCPI_SCOPE_PORT are required.",
      );
    }
    const resource = `TCPIP0::${host}::${port}::SOCKET`;
    const deviceClaim = claim("hardware-scpi-scope");
    const driver = createScpiScopeDriver({
      verifyClaim() {
        /* The opt-in fixture supplies the live physical claim identity. */
      },
      resourceForDeviceId: () => resource,
    });
    await assertRealCapture(driver, { kind: "lan", host, port }, deviceClaim);
  });
});
