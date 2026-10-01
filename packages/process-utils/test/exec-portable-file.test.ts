import { expect, it } from "vitest";
import { execPortableFile } from "../src/index.js";

const options = {
  cwd: process.cwd(),
  env: process.env,
  maxBuffer: 1024,
  timeout: 5_000,
};

it.each(["stdout", "stderr"])(
  "bounds buffered %s and stops the child",
  async (stream) => {
    await expect(
      execPortableFile(
        process.execPath,
        [
          "-e",
          `
    process.${stream}.write("x".repeat(2048));
    setInterval(() => {}, 1000);
  `,
        ],
        options,
      ),
    ).rejects.toMatchObject({
      code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER",
      message: `${stream} maxBuffer length exceeded`,
      [stream]: "x".repeat(1024),
    });
  },
);

it("streams split UTF-8 stderr and closes stdin after writing the input", async () => {
  const chunks: string[] = [];
  const output = await execPortableFile(
    process.execPath,
    [
      "-e",
      `
    const fs = require("node:fs");
    process.stdout.write(fs.readFileSync(0, "utf8"));
    const message = Buffer.from("é日本語");
    process.stderr.write(message.subarray(0, 1));
    setTimeout(() => process.stderr.write(message.subarray(1)), 50);
  `,
    ],
    {
      ...options,
      input: "hello 日本語",
      onStderr: (chunk) => chunks.push(chunk),
    },
  );
  expect(output).toEqual({ stdout: "hello 日本語", stderr: "é日本語" });
  expect(chunks.join("")).toBe("é日本語");
});

it("cancels a running command and retains the output received before cancellation", async () => {
  const controller = new AbortController();
  await expect(
    execPortableFile(
      process.execPath,
      [
        "-e",
        `
    process.stderr.write("ready");
    setInterval(() => {}, 1000);
  `,
      ],
      {
        ...options,
        signal: controller.signal,
        onStderr: () => controller.abort("cancelled by caller"),
      },
    ),
  ).rejects.toMatchObject({
    name: "AbortError",
    code: "ABORT_ERR",
    cause: "cancelled by caller",
    stderr: "ready",
  });
});
