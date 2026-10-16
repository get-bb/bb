import { mkdtemp, writeFile, readdir, rm } from "node:fs/promises";
import { availableParallelism, tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { execPortableFile } from "../src/exec-portable-file.js";
import { localProcessCapacities } from "../src/vcs-process-scheduler.js";

it("admits only the background share of git children while a foreground status can still start", async () => {
  const background = localProcessCapacities(availableParallelism())[2]!;
  const directory = await mkdtemp(path.join(tmpdir(), "bb-vcs-admission-"));
  const script = path.join(directory, "hold.cjs");
  const finished = path.join(directory, "release");
  await writeFile(
    script,
    `const fs = require("node:fs"); const path = require("node:path"); fs.writeFileSync(path.join(${JSON.stringify(directory)}, "started-"+process.argv[2]), ""); const t = setInterval(() => { if(fs.existsSync(${JSON.stringify(finished)})) { clearInterval(t); } }, 10); setTimeout(() => process.exit(0), 10000).unref();`,
  );
  const alias = `!"${process.execPath.replaceAll("\\", "/")}" "${script.replaceAll("\\", "/")}"`;
  const tasks = Array.from({ length: 12 }, (_, i) =>
    execPortableFile(
      "git",
      ["-c", `alias.bb-admission=${alias}`, "bb-admission", String(i)],
      {
        cwd: directory,
        env: process.env,
        maxBuffer: 1024,
        timeout: 15000,
        priority: "background",
      },
    ),
  );
  try {
    await expect
      .poll(
        async () =>
          (await readdir(directory)).filter((name) =>
            name.startsWith("started-"),
          ).length,
      )
      .toBeGreaterThanOrEqual(background);
    const foreground = await execPortableFile("git", ["--version"], {
      cwd: directory,
      env: process.env,
      maxBuffer: 1024,
      timeout: 5000,
      priority: "interactive",
    });
    expect(foreground.stdout).toContain("git version");
    expect(
      (await readdir(directory)).filter((name) => name.startsWith("started-"))
        .length,
    ).toBe(background);
  } finally {
    await writeFile(finished, "");
    await Promise.allSettled(tasks);
    await rm(directory, { recursive: true, force: true });
  }
}, 20000);

it("releases admission after real git exit, spawn, and timeout failures", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "bb-vcs-failure-"));
  const options = { cwd, env: process.env, maxBuffer: 1024, timeout: 100 };
  const alias = `!"${process.execPath.replaceAll("\\", "/")}" -e "setTimeout(() => {}, 30000)"`;
  try {
    const results = await Promise.allSettled([
      execPortableFile("git", ["bb-no-such-command"], options),
      execPortableFile(path.join(cwd, "git"), ["--version"], options),
      ...Array.from({ length: 6 }, () =>
        execPortableFile(
          "git",
          ["-c", `alias.bb-delay=${alias}`, "bb-delay"],
          options,
        ),
      ),
    ]);
    expect(results.every((result) => result.status === "rejected")).toBe(true);
    for (const result of results.slice(2)) {
      expect(result).toMatchObject({
        status: "rejected",
        reason: { killed: true, signal: "SIGTERM" },
      });
    }
    const recovered = await Promise.all(
      Array.from({ length: 6 }, () =>
        execPortableFile("git", ["--version"], { ...options, timeout: 5000 }),
      ),
    );
    expect(
      recovered.every((result) => result.stdout.startsWith("git version")),
    ).toBe(true);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}, 20000);
