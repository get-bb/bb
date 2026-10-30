import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const cliEntry = fileURLToPath(
  new URL("../../cli/dist/index.js", import.meta.url),
);
const outDir = new URL("../src/docs/generated/", import.meta.url);

const output = execFileSync(
  process.execPath,
  [cliEntry, "guide", "commands", "--json"],
  {
    encoding: "utf8",
    env: {
      ...process.env,
      BB_SERVER_URL: "http://127.0.0.1:1",
      BB_CLI_ERROR_LOG: "0",
    },
  },
);
const parsed = JSON.parse(output);
if (!Array.isArray(parsed.commands) || parsed.commands.length === 0) {
  throw new Error("bb guide commands --json returned no commands");
}

mkdirSync(outDir, { recursive: true });
writeFileSync(
  new URL("cli-commands.json", outDir),
  `${JSON.stringify(parsed.commands, null, 2)}\n`,
);
