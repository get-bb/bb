import { expect, it } from "vitest";
import { z } from "zod";

import { createCodexAppServerConnection } from "./app-server-connection.js";

// Echoes every request as a result whose string contains a raw U+2028.
const FAKE_SERVER = `
  process.stdin.setEncoding("utf8");
  let buffered = "";
  process.stdin.on("data", (chunk) => {
    buffered += chunk;
    let index;
    while ((index = buffered.indexOf("\\n")) !== -1) {
      const line = buffered.slice(0, index);
      buffered = buffered.slice(index + 1);
      const { id } = JSON.parse(line);
      const text = "before\\u2028after";
      process.stdout.write(JSON.stringify({ id, result: { text } }) + "\\n");
    }
  });
`;

it("keeps a JSON line intact when it contains U+2028", async () => {
  const connection = createCodexAppServerConnection({
    command: process.execPath,
    args: ["-e", FAKE_SERVER],
    cwd: process.cwd(),
    env: process.env,
    recordThreadId: null,
    onNotification: () => {},
    onRequest: () => {},
    onExit: () => {},
  });
  try {
    const result = await connection.request({
      method: "thread/resume",
      params: {},
      resultSchema: z.object({ text: z.string() }),
      timeoutMs: 5_000,
    });
    expect(result.text).toBe("before\u2028after");
  } finally {
    connection.kill();
  }
});
