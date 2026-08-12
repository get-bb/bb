import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { PlatformClient } from "../../../lib/remote/platform/client.js";
import {
  SECURITY_ASSESSMENT_TOOLS,
  type SecurityAssessmentTool,
} from "../../../lib/remote/types.js";
import { createMockRemote } from "../server.js";
import {
  MOCK_PLATFORM_ADMIN_PERMISSION,
  registerMockPlatformFirmware,
} from "./firmware.js";
import {
  registerMockPlatformSecurityAssessment,
  securityAssessmentFixture,
} from "./security-assessment.js";

const fixtureRoot = fileURLToPath(new URL("../fixtures", import.meta.url));
const token = "platform-token";

function setup() {
  const harness = createMockRemote({
    platformToken: token,
    assuranceStudioKey: "as-key",
    fixtureRoot,
    register(service, registry) {
      if (service === "platform") {
        registerMockPlatformFirmware(registry, fixtureRoot);
        registerMockPlatformSecurityAssessment(registry);
      }
    },
  });
  return harness;
}

function clientWithPermission(harness: ReturnType<typeof setup>, admin: boolean) {
  return new PlatformClient({
    baseUrl: "http://mock.invalid",
    token,
    fetch(input, init) {
      const request = new Request(input, init);
      if (!admin) return harness.platform.fetch(request);
      const headers = new Headers(request.headers);
      headers.set("X-Mock-Permissions", MOCK_PLATFORM_ADMIN_PERMISSION);
      return harness.platform.fetch(new Request(request, { headers }));
    },
  });
}

async function bytes(artifact: Awaited<ReturnType<PlatformClient["getFirmwareFile"]>>) {
  if (!("stream" in artifact)) throw new Error("expected artifact");
  const chunks: Uint8Array[] = [];
  for await (const chunk of artifact.stream()) chunks.push(chunk);
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
}

describe("mock Platform firmware", () => {
  it("keeps tree metadata byte-free and rejects missing scans", async () => {
    const harness = setup();
    const client = clientWithPermission(harness, false);
    try {
      const tree = await client.browseFirmwareFilesystem({
        projectVersionId: "pv-a481df87dadf",
        path: "rootfs",
        depth: 3,
      });
      expect(JSON.stringify(tree)).not.toContain("byteSample");
      expect(tree.entries).toBeInstanceOf(Array);
      await expect(client.browseFirmwareFilesystem({
        projectVersionId: "pv-a481df87dadf",
        scanId: "missing-scan",
      })).rejects.toMatchObject({ status: 404 });
    } finally {
      client.close();
      await harness.close();
    }
  });

  it("enforces admin bytes, the range cap, and the full-byte digest", async () => {
    const harness = setup();
    const ordinary = clientWithPermission(harness, false);
    const admin = clientWithPermission(harness, true);
    const hash = "b16e06bd84484d737304616ed406cec442a7cd87af088f72f8580755e7585b5d";
    try {
      await expect(ordinary.getFirmwareFile({
        projectVersionId: "pv-a481df87dadf", fileHash: hash, mode: "full",
      })).rejects.toMatchObject({ status: 403 });
      await expect(admin.getFirmwareFile({
        projectVersionId: "pv-a481df87dadf", fileHash: hash, mode: "range",
        offset: 0, maxBytes: 131_073,
      })).rejects.toMatchObject({ code: "PLATFORM_FIRMWARE_RANGE_INVALID" });
      const range = await admin.getFirmwareFile({
        projectVersionId: "pv-a481df87dadf", fileHash: hash, mode: "range",
        offset: 0, maxBytes: 131_072,
      });
      expect(await bytes(range)).toHaveLength(64);
      const full = await admin.getFirmwareFile({
        projectVersionId: "pv-a481df87dadf", fileHash: hash, mode: "full",
      });
      expect(createHash("sha256").update(await bytes(full)).digest("hex")).toBe(hash);
    } finally {
      ordinary.close();
      admin.close();
      await harness.close();
    }
  });

  it("covers exactly the ten closed security-assessment relays", async () => {
    const harness = setup();
    const client = clientWithPermission(harness, false);
    try {
      for (const tool of SECURITY_ASSESSMENT_TOOLS) {
        await expect(client.securityAssessment({
          tool,
          projectVersionId: "pv-a481df87dadf",
        })).resolves.toEqual(securityAssessmentFixture(tool, "pv-a481df87dadf"));
      }
      // @ts-expect-error an eleventh arbitrary STP function is forbidden by the closed union.
      const impossible: SecurityAssessmentTool = "stp_arbitrary";
      expect(impossible).toBe("stp_arbitrary");
    } finally {
      client.close();
      await harness.close();
    }
  });
});
