import { appendFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const directory = process.argv[2] ?? "first-run-results";
await mkdir(directory, { recursive: true });
const reports = await Promise.all(
  (await readdir(directory)).filter((name) => name.endsWith(".json")).map(async (name) =>
    JSON.parse(await readFile(join(directory, name), "utf8")),
  ),
);
const platforms = ["Windows", "macOS"];
const providers = ["claude-code", "codex", "pi"];
const columns = providers.flatMap((provider) => platforms.map((os) => ({ provider, os })));
const rows = [
  ["1. Clean start", ["clean"]],
  ["2. Detect missing", ["detect"]],
  ["3. Install through bb", ["install"]],
  ["4. Launch sign-in; stub credentials", ["signin"]],
  ["5. First turn with fake model", ["turn"]],
  ["6. Relaunch; update", ["relaunch", "update"]],
  ["7. Pi without system npm", ["pi"]],
];
const escape = (value) => String(value).replaceAll("|", "\\|").replace(/[\r\n]+/gu, " ");
function cell(provider, os, keys) {
  const report = reports.find((entry) => entry.os === os);
  if (!report) return "fail — no result artifact; inspect job setup/build logs";
  if (keys[0] === "pi") {
    if (provider !== "pi") return "stubbed — Pi-only case";
    keys = ["piInstall"];
  }
  return keys.map((key) => {
    const entry = report.cells?.[provider]?.[key];
    if (!entry || !["pass", "fail", "stubbed"].includes(entry.status))
      return `fail — missing ${key} evidence`;
    return escape(`${entry.status} — ${key}: ${entry.reason}`);
  }).join("; ");
}
const markdown = [
  "# First-run reliability matrix",
  "",
  "Real packaged bb server, daemon, installation routes and vendor CLIs. Authentication credentials and model responses are synthetic; this does not prove real account authorization or hosted inference.",
  "",
  `| Step | ${columns.map(({ provider, os }) => `${provider} × ${os}`).join(" | ")} |`,
  `| --- | ${columns.map(() => "---").join(" | ")} |`,
  ...rows.map(([label, keys]) => `| ${label} | ${columns.map(({ provider, os }) => cell(provider, os, keys)).join(" | ")} |`),
  "",
  ...reports.map((report) => `${report.os}: ${(report.durationMs / 60_000).toFixed(1)} minutes in the harness; commit ${report.sha ?? "see workflow head"}.`),
  "",
].join("\n");
await writeFile(join(directory, "matrix.md"), markdown);
if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, markdown);
process.stdout.write(markdown);
