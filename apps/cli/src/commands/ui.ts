import { Command } from "commander";
import { action } from "../action.js";
import { outputJson, type JsonOutputOptions } from "./helpers.js";

interface UiState {
  active: "prod" | "fork";
  status: "idle" | "building" | "ready" | "error" | "needs-rebase";
  seeded: boolean;
  lastBuiltAt: string | null;
  error: string | null;
  version: string | null;
  conflictFiles: string[];
  /** Absolute path of the editable fork workspace (edit src/ + package.json here). */
  sourceDir?: string;
  /** False when the "UI forking" experiment is off (commands are disabled). */
  enabled?: boolean;
}

interface UiApplyResult {
  ok: boolean;
  state: UiState;
  log?: string;
  error?: string;
  typeErrors?: string;
}

function printTypeErrors(typeErrors: string | undefined): void {
  if (!typeErrors) return;
  console.error("");
  console.error("Type errors (the build still serves — fix these):");
  console.error(typeErrors);
}

interface UiUpdateResult {
  ok: boolean;
  state: UiState;
  upToDate?: boolean;
  conflictFiles?: string[];
  error?: string;
}

interface UiUpdateOptions extends JsonOutputOptions {
  continue?: boolean;
  abort?: boolean;
}

interface UiForkOptions extends JsonOutputOptions {
  reset?: boolean;
}

async function callUi<T>(
  baseUrl: string,
  path: string,
  method: "GET" | "POST",
): Promise<T> {
  const response = await fetch(`${baseUrl}/api/v1/ui/${path}`, { method });
  if (response.status === 404) {
    throw new Error(
      "The UI source feature is not enabled on this server (no build toolchain found). " +
        "Run from a source checkout or a build that ships the app source.",
    );
  }
  const text = await response.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(
      `Unexpected response from /api/v1/ui/${path} (${response.status}): ${text.slice(0, 200)}`,
    );
  }
  // `apply` returns 422 with a structured { ok: false, log } on build failure —
  // let it through so the caller can print the build log. Any other non-2xx is
  // a real server error.
  if (!response.ok && response.status !== 422) {
    const message =
      typeof body === "object" && body !== null && "message" in body
        ? String((body as { message: unknown }).message)
        : `HTTP ${response.status}`;
    throw new Error(`/api/v1/ui/${path} failed: ${message}`);
  }
  return body as T;
}

function printState(state: UiState): void {
  console.log(`Active:      ${state.active}`);
  console.log(`Status:      ${state.status}`);
  console.log(`Seeded:      ${state.seeded ? "yes" : "no"}`);
  console.log(`Last built:  ${state.lastBuiltAt ?? "(never)"}`);
  if (state.sourceDir) {
    console.log(`Fork dir:    ${state.sourceDir}  (edit src/ + package.json here)`);
  }
  if (state.error) {
    console.log(`Error:       ${state.error}`);
  }
}

export function registerUiCommands(
  program: Command,
  getUrl: () => string,
): void {
  const ui = program
    .command("ui")
    .description(
      "Edit and live-reload the bb frontend (the user-editable UI source)",
    );

  ui.command("status")
    .description("Show which UI is active and the last build status")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (opts: JsonOutputOptions) => {
        const state = await callUi<UiState>(getUrl(), "status", "GET");
        if (outputJson(opts, state)) return;
        if (state.enabled === false) {
          console.log(
            'UI forking is disabled. Enable the "UI forking" experiment in ' +
              "Settings → Experiments to use bb ui.",
          );
          console.log("");
        }
        printState(state);
      }),
    );

  ui.command("fork")
    .description(
      "Create your editable copy of the UI and switch to it. First run seeds " +
        "it (installs + builds); --reset discards edits and re-seeds.",
    )
    .option("--reset", "Discard fork edits and re-seed from the shipped UI")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (opts: UiForkOptions) => {
        const result = await callUi<UiApplyResult>(
          getUrl(),
          opts.reset ? "fork?reset=1" : "fork",
          "POST",
        );
        if (outputJson(opts, result)) return;
        if (result.ok) {
          console.log("Forked the UI and switched to it. Reloading clients.");
          printState(result.state);
          printTypeErrors(result.typeErrors);
          return;
        }
        console.error(result.error ?? "Fork failed");
        if (result.log) {
          console.error("");
          console.error(result.log);
        }
        process.exitCode = 1;
      }),
    );

  ui.command("apply")
    .description("Rebuild your UI fork after editing it, and live-reload clients")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (opts: JsonOutputOptions) => {
        const result = await callUi<UiApplyResult>(getUrl(), "apply", "POST");
        if (outputJson(opts, result)) return;
        if (result.ok) {
          console.log("Applied. Reloading connected clients.");
          printState(result.state);
          printTypeErrors(result.typeErrors);
          return;
        }
        console.error(result.error ?? "Build failed");
        if (result.log) {
          console.error("");
          console.error(result.log);
        }
        process.exitCode = 1;
      }),
    );

  ui.command("prod")
    .description("Switch back to the shipped UI (your fork stays on disk)")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (opts: JsonOutputOptions) => {
        const state = await callUi<UiState>(getUrl(), "prod", "POST");
        if (outputJson(opts, state)) return;
        console.log("Switched to the shipped UI. Reloading connected clients.");
        printState(state);
      }),
    );

  ui.command("update")
    .description(
      "Rebase your UI edits onto a newer shipped UI. On conflict, falls back " +
        "to the shipped UI and reports the files to resolve.",
    )
    .option("--continue", "Continue the rebase after resolving conflicts")
    .option("--abort", "Abort an in-progress rebase")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (opts: UiUpdateOptions) => {
        const mode = opts.continue
          ? "continue"
          : opts.abort
            ? "abort"
            : "start";
        const result = await callUi<UiUpdateResult>(
          getUrl(),
          `update?mode=${mode}`,
          "POST",
        );
        if (outputJson(opts, result)) return;
        if (result.upToDate) {
          console.log("Already up to date with the shipped UI.");
          return;
        }
        if (result.ok) {
          console.log(
            mode === "abort"
              ? "Aborted the rebase."
              : "Updated UI source onto the new shipped UI and rebuilt.",
          );
          printState(result.state);
          return;
        }
        console.error(`Update needs attention: ${result.error ?? "unknown"}`);
        if (result.conflictFiles && result.conflictFiles.length > 0) {
          console.error("");
          console.error("Conflicts in:");
          for (const file of result.conflictFiles) {
            console.error(`  ${file}`);
          }
          console.error("");
          console.error(
            "Resolve them in the UI source, then run: bb ui update --continue",
          );
        }
        process.exitCode = 1;
      }),
    );
}
