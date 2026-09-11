import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { enrollMachine } from "./machine-enrollment.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((dir) => rm(dir, { recursive: true, force: true })),
  );
});
const bundle = () => ({
  hostId: "host_test",
  serverUrl: "https://server.example",
  credential: "private-bootstrap",
  expiresAt: Date.now() + 60_000,
});
async function harness() {
  const dir = await mkdtemp(join(tmpdir(), "bb-machine-enrollment-test-"));
  directories.push(dir);
  const fetchFn = vi.fn<typeof fetch>(async () =>
    Response.json(
      { hostId: "host_test", hostKey: "private-durable" },
      { status: 201 },
    ),
  );
  const env: NodeJS.ProcessEnv = {
    BB_DATA_DIR: dir,
    BB_ENROLLMENT: JSON.stringify(bundle()),
    PATH: "/nonexistent",
  };
  return {
    dir,
    fetchFn,
    env,
    run: () =>
      enrollMachine(
        { bootstrapEnv: "BB_ENROLLMENT" },
        { env, fetchFn, homeDir: dir },
      ),
  };
}

describe("machine enroll", () => {
  it("retries a lost exchange with replacement bootstrap while preserving the reserved identity", async () => {
    const h = await harness();
    h.fetchFn.mockRejectedValueOnce(new Error("Response lost"));
    await expect(h.run()).rejects.toThrow("Could not exchange");
    await expect(readFile(join(h.dir, "auth.json"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    h.env.BB_ENROLLMENT = JSON.stringify({
      ...bundle(),
      credential: "replacement-bootstrap",
    });
    await expect(h.run()).resolves.toEqual({ hostId: "host_test" });
    expect(h.fetchFn).toHaveBeenCalledTimes(2);
    expect(h.fetchFn.mock.calls[1]?.[1]?.headers).toMatchObject({
      authorization: "Bearer replacement-bootstrap",
    });
    expect((await stat(join(h.dir, "auth.json"))).mode & 0o777).toBe(0o600);
  });

  it("exchanges through authorization, persists private credentials, and no-ops on same identity with expired material", async () => {
    const h = await harness();
    expect(await h.run()).toEqual({ hostId: "host_test" });
    expect(h.env.BB_ENROLLMENT).toBeUndefined();
    expect(h.fetchFn.mock.calls[0]?.[1]?.headers).toMatchObject({
      authorization: "Bearer private-bootstrap",
    });
    expect((await stat(join(h.dir, "auth.json"))).mode & 0o777).toBe(0o600);
    const port = Number(
      (await readFile(join(h.dir, "host-daemon-port"), "utf8")).trim(),
    );
    expect(port).toBeGreaterThan(0);
    expect(port).toBeLessThanOrEqual(65535);
    h.env.BB_ENROLLMENT = JSON.stringify({ ...bundle(), expiresAt: 1 });
    expect(await h.run()).toEqual({ hostId: "host_test" });
    expect(h.fetchFn).toHaveBeenCalledOnce();
  });

  it("refuses a different host or server before exchanging credentials", async () => {
    const h = await harness();
    await writeFile(
      join(h.dir, "auth.json"),
      JSON.stringify({ hostId: "host_other", hostKey: "existing" }),
    );
    await expect(h.run()).rejects.toThrow("different machine identity");
    expect(h.fetchFn).not.toHaveBeenCalled();
    expect(await readFile(join(h.dir, "auth.json"), "utf8")).toContain(
      "existing",
    );
  });

  it("rejects invalid and expired bundles without exposing their input", async () => {
    const h = await harness();
    h.env.BB_ENROLLMENT = '{"credential":"do-not-echo"';
    await expect(h.run()).rejects.toThrow(
      /^Invalid machine enrollment bootstrap$/,
    );
    h.env.BB_ENROLLMENT = JSON.stringify({ ...bundle(), version: 2 });
    await expect(h.run()).rejects.toThrow(
      /^Invalid machine enrollment bootstrap$/,
    );
    h.env.BB_ENROLLMENT = JSON.stringify({ ...bundle(), expiresAt: 1 });
    await expect(h.run()).rejects.toThrow("expired");
    expect(h.fetchFn).not.toHaveBeenCalled();
  });

  it("suppresses secret-bearing remote errors and permits a retry", async () => {
    const h = await harness();
    h.fetchFn.mockRejectedValueOnce(new Error("private-bootstrap"));
    await expect(h.run()).rejects.toThrow(
      /^Could not exchange machine enrollment credential$/,
    );
    h.env.BB_ENROLLMENT = JSON.stringify(bundle());
    await expect(h.run()).resolves.toEqual({ hostId: "host_test" });
  });

  it("persists provider headers and sends them directly on enrollment without redemption", async () => {
    const h = await harness();
    const headers = { "x-access-token": "private-provider-header" };
    h.env.BB_ENROLLMENT = JSON.stringify({ ...bundle(), headers });
    await h.run();
    expect(h.fetchFn).toHaveBeenCalledOnce();
    expect(String(h.fetchFn.mock.calls[0]?.[0])).toBe(
      "https://server.example/internal/hosts/enroll",
    );
    expect(h.fetchFn.mock.calls[0]?.[1]?.headers).toMatchObject(headers);
    expect(
      JSON.parse(await readFile(join(h.dir, "config.json"), "utf8")),
    ).toMatchObject({ serverHeaders: headers });
  });
});

it("accepts delivered direct and Connect bundles from file and environment", async () => {
  for (const kind of ["direct", "connect"] as const) {
    for (const source of ["file", "env"]) {
      const h = await harness();
      const headers =
        kind === "connect"
          ? { "x-bb-connect-machine": "private-connect" }
          : undefined;
      const value = {
        ...bundle(),
        serverUrl: "https://test.getbb.app",
        headers,
      };
      const path = join(h.dir, "bootstrap.json");
      await writeFile(path, JSON.stringify(value));
      h.env.BB_ENROLLMENT = JSON.stringify(value);
      h.fetchFn.mockImplementation(async () =>
        Response.json(
          { hostId: "host_test", hostKey: "private-durable" },
          { status: 201 },
        ),
      );
      await expect(
        enrollMachine(
          source === "file"
            ? { bootstrapFile: path }
            : { bootstrapEnv: "BB_ENROLLMENT" },
          { env: h.env, homeDir: h.dir, fetchFn: h.fetchFn },
        ),
      ).resolves.toEqual({ hostId: "host_test" });
      const enroll = h.fetchFn.mock.calls.find(([url]) =>
        String(url).includes("/internal/hosts/enroll"),
      );
      expect(
        new Headers(enroll?.[1]?.headers).get("x-bb-connect-machine"),
      ).toBe(kind === "connect" ? "private-connect" : null);
      expect(h.fetchFn).toHaveBeenCalledOnce();
    }
  }
});
