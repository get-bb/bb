import { execHostFile } from "@bb/process-utils";
import { reportCommandResult } from "../command-result.js";
import {
  runPublishCheck,
  type PublishCheckEnvironment,
  type PublishCheckReport,
  type PublishSourceKind,
} from "./check.js";

const COMMAND_TIMEOUT_MS = 60_000;
const FETCH_TIMEOUT_MS = 10_000;

export function createPublishCheckEnvironment(): PublishCheckEnvironment {
  return {
    async run(command, args, cwd) {
      try {
        const { stdout } = await execHostFile(command, args, {
          cwd,
          timeout: COMMAND_TIMEOUT_MS,
          killSignal: "SIGKILL",
          maxBuffer: 16 * 1024 * 1024,
          env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
        });
        return { exitCode: 0, stdout };
      } catch (error) {
        const code =
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          typeof error.code === "number"
            ? error.code
            : -1;
        const stdout =
          typeof error === "object" &&
          error !== null &&
          "stdout" in error &&
          typeof error.stdout === "string"
            ? error.stdout
            : "";
        return { exitCode: code === 0 ? -1 : code, stdout };
      }
    },
    async fetchJson(url) {
      try {
        const response = await fetch(url, {
          headers: { accept: "application/json" },
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });
        if (!response.ok) return { status: response.status, body: null };
        return { status: response.status, body: await response.json() };
      } catch {
        return null;
      }
    },
  };
}

const SEVERITY_LABELS = {
  error: "error",
  warning: "warning",
  info: "note",
} as const;

export function formatPublishCheck(report: PublishCheckReport): string[] {
  const lines: string[] = [];
  const listing = report.listing;
  if (listing !== null) {
    lines.push(
      `${listing.displayName ?? listing.packageName} (id ${listing.id}, version ${listing.version || "unset"})`,
    );
    lines.push(
      `  Source:      ${report.sourceKey ?? report.source}${report.github === null ? "" : `, tags ${report.github.tagPrefix}vX.Y.Z`}`,
    );
    lines.push(
      `  Category:    ${listing.category ?? "missing"}${listing.secondaryCategories.length === 0 ? "" : ` (also ${listing.secondaryCategories.join(", ")})`}`,
    );
    lines.push(
      `  Tags:        ${listing.tags.length === 0 ? "none" : listing.tags.join(", ")}`,
    );
    lines.push(`  Icon:        ${listing.icon ?? "missing"}`);
    lines.push(`  Screenshots: ${listing.screenshots.length}`);
    lines.push(
      `  Overview:    ${listing.hasOverview ? "PLUGIN_OVERVIEW.md" : "none"}`,
    );
    if (report.github !== null) {
      lines.push(
        `  Release:     ${report.github.headTag ?? (report.github.releaseTag === null ? "no release tag" : `${report.github.releaseTag} (HEAD is not tagged)`)}`,
      );
    }
    if (report.npm?.publishedVersion != null) {
      lines.push(`  On npm:      ${report.npm.publishedVersion}`);
    }
    lines.push("");
  }
  for (const finding of report.findings) {
    lines.push(
      `${SEVERITY_LABELS[finding.severity]} [${finding.code}] ${finding.message}`,
    );
  }
  if (report.findings.length > 0) lines.push("");
  lines.push(
    report.ok
      ? "Ready to publish. Listings are not reviewed by BB. Next steps:"
      : "Not ready to publish. Next steps:",
  );
  report.nextSteps.forEach((step, index) => {
    lines.push(`  ${index + 1}. ${step}`);
  });
  lines.push("This check never pushes, tags, or publishes anything.");
  return lines;
}

export async function runPublishCheckCommand(args: {
  directory: string;
  source: PublishSourceKind | null;
  offline: boolean;
  json: boolean;
}): Promise<void> {
  const report = await runPublishCheck({
    directory: args.directory,
    source: args.source,
    offline: args.offline,
    environment: createPublishCheckEnvironment(),
  });
  const errors = report.findings.filter(
    (finding) => finding.severity === "error",
  ).length;
  reportCommandResult({ json: args.json }, report, {
    text: formatPublishCheck(report),
    failure: report.ok
      ? null
      : {
          message: `${errors} problem${errors === 1 ? "" : "s"} would keep the plugin out of the marketplace.`,
          code: "publish_check_failed",
          hint: null,
        },
  });
}
