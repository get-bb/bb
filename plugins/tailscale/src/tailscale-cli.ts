import { experimental_execHostFileCallback as execHostFile } from "@get-bb/plugin-sdk/process";
import { access, constants } from "node:fs/promises";
import path from "node:path";

export const TAILSCALE_CLI_ENV = "BB_TAILSCALE_CLI";

export interface TailscaleRunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface TailscaleCli {
  readonly path: string;
  run(
    args: readonly string[],
    options: { timeoutMs: number },
  ): Promise<TailscaleRunResult>;
}

export type LocateTailscale = () => Promise<TailscaleCli | null>;

export function tailscaleCandidates(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
): string[] {
  const override = env[TAILSCALE_CLI_ENV]?.trim();
  if (override) return [override];
  switch (platform) {
    case "darwin":
      return [
        "/Applications/Tailscale.app/Contents/MacOS/Tailscale",
        "/usr/local/bin/tailscale",
        "/opt/homebrew/bin/tailscale",
      ];
    case "win32":
      return [
        path.win32.join(
          env.ProgramFiles ?? "C:\\Program Files",
          "Tailscale",
          "tailscale.exe",
        ),
      ];
    default:
      return [
        "/usr/bin/tailscale",
        "/usr/local/bin/tailscale",
        "/usr/sbin/tailscale",
      ];
  }
}

async function isExecutable(file: string): Promise<boolean> {
  try {
    await access(
      file,
      process.platform === "win32" ? constants.F_OK : constants.X_OK,
    );
    return true;
  } catch {
    return false;
  }
}

export function execTailscale(file: string): TailscaleCli {
  return {
    path: file,
    run(args, { timeoutMs }) {
      return new Promise((resolve, reject) => {
        execHostFile(
          file,
          args,
          {
            timeout: timeoutMs,
            maxBuffer: 8 * 1024 * 1024,
            encoding: "utf8",
          },
          (error, stdout, stderr) => {
            if (error === null) {
              resolve({ exitCode: 0, stdout, stderr });
              return;
            }
            if (typeof error.code === "number") {
              resolve({ exitCode: error.code, stdout, stderr });
              return;
            }
            if (error.killed) {
              reject(
                new Error(
                  `tailscale ${args.join(" ")} did not finish within ${Math.round(timeoutMs / 1000)}s`,
                ),
              );
              return;
            }
            reject(error);
          },
        );
      });
    },
  };
}

export function systemTailscale(
  options: {
    platform?: NodeJS.Platform;
    env?: NodeJS.ProcessEnv;
  } = {},
): LocateTailscale {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  return async () => {
    for (const candidate of tailscaleCandidates(platform, env)) {
      if (await isExecutable(candidate)) return execTailscale(candidate);
    }
    return null;
  };
}
