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
  version: 2,
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
    await writeFile(join(h.dir, "enrollment.lock"), "stale-lock");
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

  it("recovers a dead process lock and refuses a live owner", async () => {
    const h = await harness();
    await writeFile(join(h.dir, "enrollment.lock"), String(process.pid));
    await expect(h.run()).rejects.toThrow("holds the local identity lock");
    expect(h.fetchFn).not.toHaveBeenCalled();
    await writeFile(join(h.dir, "enrollment.lock"), "2147483647");
    h.env.BB_ENROLLMENT = JSON.stringify(bundle());
    await expect(h.run()).resolves.toEqual({ hostId: "host_test" });
  });

  it("rejects invalid and expired bundles without exposing their input", async () => {
    const h = await harness();
    h.env.BB_ENROLLMENT = '{"credential":"do-not-echo"';
    await expect(h.run()).rejects.toThrow(
      /^Invalid machine enrollment bootstrap$/,
    );
    h.env.BB_ENROLLMENT = JSON.stringify({ ...bundle(), expiresAt: 1 });
    await expect(h.run()).rejects.toThrow("expired");
    expect(h.fetchFn).not.toHaveBeenCalled();
  });

  it("suppresses secret-bearing remote errors and releases the identity lock", async () => {
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

it.each([1, 2])(
  "accepts delivered v%s direct and Connect bundles from file and environment",
  async (version) => {
    for (const kind of ["direct", "connect"]) {
      for (const source of ["file", "env"]) {
        const h = await harness();
        const headers =
          kind === "connect"
            ? { "x-bb-connect-machine": "private-connect" }
            : undefined;
        const value = {
          ...bundle(),
          version,
          serverUrl: "https://test.getbb.app",
          ...(version === 1
            ? {
                client:
                  kind === "direct"
                    ? { kind }
                    : {
                        kind,
                        machineCode: "legacy-code",
                        expiresAt: Date.now() + 60000,
                      },
              }
            : { headers }),
        };
        const path = join(h.dir, "bootstrap.json");
        await writeFile(path, JSON.stringify(value));
        h.env.BB_ENROLLMENT = JSON.stringify(value);
        h.fetchFn.mockImplementation(async (url) =>
          String(url).includes("/redeem-machine")
            ? Response.json({
                credential: "private-connect",
                serverUrl: value.serverUrl,
              })
            : Response.json(
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
        expect(
          h.fetchFn.mock.calls.filter(([url]) =>
            String(url).includes("redeem-machine"),
          ),
        ).toHaveLength(version === 1 && kind === "connect" ? 1 : 0);
      }
    }
  },
);

it("reuses a v1 Connect upgrade after the enrollment response is lost", async () => {
  const h = await harness();
  const value = {
    ...bundle(),
    version: 1,
    serverUrl: "https://test.getbb.app",
    client: {
      kind: "connect",
      machineCode: "legacy",
      expiresAt: Date.now() + 60000,
    },
  };
  h.env.BB_ENROLLMENT = JSON.stringify(value);
  h.fetchFn
    .mockResolvedValueOnce(
      Response.json({
        credential: "private-connect",
        serverUrl: value.serverUrl,
      }),
    )
    .mockRejectedValueOnce(new Error("Response lost"));
  await expect(h.run()).rejects.toThrow("Could not exchange");
  h.env.BB_ENROLLMENT = JSON.stringify(value);
  await h.run();
  expect(
    h.fetchFn.mock.calls.filter(([url]) =>
      String(url).includes("redeem-machine"),
    ),
  ).toHaveLength(1);
});
