import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { HelperSerialTransport } from "./transport.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("serial helper protocol", () => {
  it("frames NDJSON through a supervised subprocess and reports helper death", async () => {
    const root = await mkdtemp(join(tmpdir(), "fs122-helper-"));
    directories.push(root);
    const python = join(root, "python3");
    await writeFile(
      python,
      `#!/bin/sh\nif [ "$1" = "-u" ]; then shift; fi\nif [ "$1" = "-c" ]; then shift; exec ${JSON.stringify(process.execPath)} -e "$1"; fi\nexit 2\n`,
      "utf8",
    );
    await chmod(python, 0o755);
    const source = String.raw`
const readline = require("node:readline");
const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  const frame = JSON.parse(line);
  if (frame.op === "open") {
    process.stdout.write(JSON.stringify({ event: "opened" }) + "\n");
    process.stdout.write(JSON.stringify({ event: "data", data: Buffer.from("boot\\n").toString("base64") }) + "\n");
  } else if (frame.op === "write") {
    process.exit(9);
  }
});
`;
    const transport = new HelperSerialTransport({
      pythonCommand: python,
      helperSource: source,
      openTimeoutMs: 2_000,
    });
    const chunks: string[] = [];
    const closed = new Promise<string>((resolve) => transport.onClosed(resolve));
    transport.onData((chunk) => chunks.push(Buffer.from(chunk).toString("utf8")));
    await transport.open({ deviceId: "serial-a", portPath: "/dev/fixture" }, { baud: 115_200 });
    await expect(transport.write(new TextEncoder().encode("AT"))).resolves.toBeUndefined();
    expect(await closed).toContain("helper exited");
    expect(chunks).toEqual([String.raw`boot\n`]);
    await transport.close();
  });
});
