import { execFile } from "node:child_process";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import { inspectReadiness, probeReadiness } from "./readiness.js";

const exec = promisify(execFile);

it("fingerprints tracked checkout inputs without executing the repository hook", async () => {
  const path = await mkdtemp(join(tmpdir(), "bb-readiness-"));
  const git = (...args: string[]) => exec("git", ["-C", path, ...args]);
  try {
    await git("init");
    await writeFile(join(path, "package-lock.json"), "first");
    await writeFile(join(path, ".bb-env-setup.sh"), "exit 99\n");
    await git("add", ".");
    await git(
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.com",
      "commit",
      "-m",
      "Fixture",
    );
    const first = await inspectReadiness(path);
    expect(first.dirty).toEqual([]);
    expect(first.files.map((file) => file.path)).toEqual([
      ".bb-env-setup.sh",
      "package-lock.json",
    ]);
    expect(first.abi).toBe(
      `${process.platform}/${process.arch}/node-${process.versions.modules}`,
    );
    await writeFile(join(path, "untracked-lock.json"), "ignored");
    await writeFile(join(path, "package-lock.json"), "second");
    const changed = await inspectReadiness(path);
    expect(changed.commit).toBe(first.commit);
    expect(changed.files).toHaveLength(2);
    expect(changed.files[1]?.sha256).not.toBe(first.files[1]?.sha256);
    expect(changed.dirty).toEqual([" M package-lock.json"]);
    await rm(join(path, "package-lock.json"));
    await symlink(".bb-env-setup.sh", join(path, "package-lock.json"));
    await expect(inspectReadiness(path)).rejects.toThrow(
      "Unsupported readiness input file",
    );
  } finally {
    await rm(path, { recursive: true, force: true });
  }
});

it("probes the authenticated server route without following redirects or sending headers to another origin", async () => {
  let calls = 0;
  const server = createServer((request, response) => {
    calls++;
    if (request.url === "/redirect") {
      response.writeHead(302, { location: "/ready" }).end();
      return;
    }
    response
      .writeHead(request.headers.authorization === "fixture-token" ? 200 : 401)
      .end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Missing TCP listener");
  const base = `http://127.0.0.1:${address.port}`;
  const input = {
    type: "host.readiness.probe" as const,
    serverPath: "/ready",
    headers: { authorization: "fixture-token" },
  };
  try {
    expect(await probeReadiness(input, base)).toEqual({
      reachable: true,
      status: 200,
    });
    expect(await probeReadiness({ ...input, headers: {} }, base)).toEqual({
      reachable: false,
      status: 401,
    });
    expect(
      await probeReadiness({ ...input, serverPath: "/redirect" }, base),
    ).toEqual({ reachable: false, status: null });
    expect(
      await probeReadiness(
        { ...input, serverPath: "//example.com/ready" },
        base,
      ),
    ).toEqual({ reachable: false, status: null });
    expect(calls).toBe(3);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
