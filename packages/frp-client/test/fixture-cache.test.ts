import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { fetchArchive, FrpBinaryError, frpArchiveFor } from "../src/binary.js";

vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs/promises")>();
  return { ...original, rename: vi.fn(original.rename) };
});

vi.mock("../src/binary.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/binary.js")>();
  return { ...original, fetchArchive: vi.fn(), frpArchiveFor: vi.fn() };
});

const bytes = new Uint8Array([1, 2, 3, 4]);
let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "frp-cache-race-"));
  vi.stubEnv("BB_FRP_CACHE_DIR", dir);
  vi.resetModules();
  vi.mocked(frpArchiveFor).mockReturnValue({
    fileName: "fixture.zip",
    format: "zip",
    binaryName: "frpc.exe",
    member: "fixture/frpc.exe",
    url: "https://example.test/fixture.zip",
    sha256: createHash("sha256").update(bytes).digest("hex"),
  });
  vi.mocked(fetchArchive).mockResolvedValue(bytes);
});

afterEach(async () => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  await fs.rm(dir, { recursive: true, force: true });
});

it("recovers a transient network failure and reuses the verified archive", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout"] });
  vi.mocked(fetchArchive).mockRejectedValueOnce(
    new TypeError("fetch failed", {
      cause: Object.assign(new Error("Connect Timeout Error"), {
        code: "UND_ERR_CONNECT_TIMEOUT",
      }),
    }),
  );
  const { cachedDownload } = await import("../src/testing/frp-fixture.js");
  const download = cachedDownload("win32", "x64");
  const result = download("https://example.test/fixture.zip").then(
    (value) => ({ value }),
    (error: unknown) => ({ error }),
  );
  await vi.waitFor(() => expect(fetchArchive).toHaveBeenCalled());
  await vi.runAllTimersAsync();
  await expect(result).resolves.toEqual({ value: bytes });
  await expect(download("https://example.test/fixture.zip")).resolves.toEqual(
    bytes,
  );
  expect(fetchArchive).toHaveBeenCalledTimes(2);
  expect(
    new Uint8Array(await fs.readFile(path.join(dir, "fixture.zip"))),
  ).toEqual(bytes);
});

it.each([
  { failure: new TypeError("fetch failed"), attempts: 3 },
  {
    failure: new FrpBinaryError("downloading fixture answered HTTP 404"),
    attempts: 1,
  },
])(
  "bounds $failure failures without publishing an archive",
  async ({ failure, attempts }) => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    vi.mocked(fetchArchive).mockRejectedValue(failure);
    const { cachedDownload } = await import("../src/testing/frp-fixture.js");
    const result = cachedDownload(
      "win32",
      "x64",
    )("https://example.test/fixture.zip").catch((error: unknown) => error);
    await vi.waitFor(() => expect(fetchArchive).toHaveBeenCalled());
    await vi.runAllTimersAsync();
    await expect(result).resolves.toBe(failure);
    expect(fetchArchive).toHaveBeenCalledTimes(attempts);
    expect(await fs.readdir(dir)).toEqual([]);
  },
);

it("refuses a corrupt download without retrying or publishing it", async () => {
  vi.mocked(fetchArchive).mockResolvedValue(new Uint8Array([0]));
  const { cachedDownload } = await import("../src/testing/frp-fixture.js");
  await expect(
    cachedDownload("win32", "x64")("https://example.test/fixture.zip"),
  ).rejects.toThrow("does not match its pinned sha256");
  expect(fetchArchive).toHaveBeenCalledTimes(1);
  expect(await fs.readdir(dir)).toEqual([]);
});

it.each([true, false])(
  "accepts a competing cache publisher only when its archive is valid: %s",
  async (valid) => {
    const failure = Object.assign(new Error("rename denied"), {
      code: "EPERM",
    });
    vi.mocked(fs.rename).mockImplementationOnce(
      async (_source, destination) => {
        await fs.writeFile(destination, valid ? bytes : new Uint8Array([0]));
        throw failure;
      },
    );
    const { cachedDownload } = await import("../src/testing/frp-fixture.js");
    const download = cachedDownload("win32", "x64");
    const result = download("https://example.test/fixture.zip");
    if (valid) {
      await expect(result).resolves.toEqual(bytes);
    } else {
      await expect(result).rejects.toBe(failure);
    }
    expect(await fs.readdir(dir)).toEqual(["fixture.zip"]);
  },
);
