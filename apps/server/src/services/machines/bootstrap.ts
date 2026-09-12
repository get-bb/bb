import type { MachineBootstrapApi } from "@get-bb/plugin-sdk";
import type { PluginMachineProviderProgress } from "@get-bb/plugin-sdk/machine-provider";
import type { EnrollmentBootstrap, MachineEnrollments } from "./enrollments.js";
import { readFile } from "node:fs/promises";
import { INSTALL_MACHINE_SCRIPT_PATH } from "../../install-machine-asset.js";

const installerScript = `
set -eu
umask 077
BB_ENROLLMENT=$(cat)
export BB_ENROLLMENT
installer_url=$1
installer_file=$(mktemp)
trap 'rm -f "$installer_file"' EXIT HUP INT TERM
node -e 'for (const [name,value] of Object.entries(JSON.parse(process.env.BB_ENROLLMENT).headers ?? {})) console.log("header = " + JSON.stringify(name + ": " + value))' | curl --config - --fail --silent --show-error --location --connect-timeout 10 --max-time 60 "$installer_url" > "$installer_file"
sh "$installer_file" --bootstrap-env BB_ENROLLMENT
`;

function installerCommand(bootstrap: EnrollmentBootstrap) {
  return {
    command: [
      "sh",
      "-c",
      installerScript,
      "bb-machine-install",
      new URL("/install.sh", bootstrap.serverUrl).href,
    ],
    stdin: JSON.stringify(bootstrap),
  };
}

const installerSource = readFile(INSTALL_MACHINE_SCRIPT_PATH, "utf8");

function createOutputReporter(report: PluginMachineProviderProgress) {
  let pending = "";
  const tail: string[] = [];
  const emit = (line: string, terminated: boolean): void => {
    report.log(line + (terminated ? "\n" : ""));
    tail.push(line);
    if (tail.length > 20) tail.shift();
  };
  return {
    onOutput(chunk: string): void {
      pending += chunk;
      for (;;) {
        const match = /\r\n|\r|\n/u.exec(pending);
        if (match === null) return;
        emit(pending.slice(0, match.index), true);
        pending = pending.slice(match.index + match[0].length);
      }
    },
    finish(): void {
      if (pending.length === 0) return;
      emit(pending, false);
      pending = "";
    },
    failureMessage(): string {
      return tail.length === 0
        ? "Machine bootstrap command failed"
        : `Machine bootstrap command failed:\n${tail.join("\n")}`;
    },
  };
}

async function installerStartCommand(hostId: string) {
  return {
    command: ["sh", "-s", "--", "--start", "--host-id", hostId],
    stdin: await installerSource,
  };
}

export function createMachineBootstrapApi(
  enrollments: MachineEnrollments,
): MachineBootstrapApi {
  return {
    async bootstrap(request) {
      request.signal.throwIfAborted();
      request.report.step("Preparing machine enrollment");
      try {
        const enrollment = await enrollments.prepare({
          key: request.key,
          signal: request.signal,
        });
        request.signal.throwIfAborted();
        request.report.step(
          enrollment.state === "enrolled"
            ? "Starting enrolled machine"
            : "Bootstrapping machine",
        );
        const execution = await (enrollment.state === "enrolled"
          ? installerStartCommand(enrollment.hostId)
          : installerCommand(enrollment.bootstrap));
        const output = createOutputReporter(request.report);
        let result;
        try {
          result = await request.executor.exec({
            ...execution,
            timeoutMs: 600_000,
            signal: request.signal,
            onOutput: output.onOutput,
          });
        } catch {
          request.signal.throwIfAborted();
          throw new Error("Machine bootstrap command failed");
        }
        output.finish();
        if (result.exitCode !== 0) throw new Error(output.failureMessage());
        request.signal.throwIfAborted();
        request.report.step("Waiting for machine connection");
        await enrollments.waitForConnection({
          enrollmentId: enrollment.id,
          timeoutMs: 120_000,
          signal: request.signal,
        });
        return { hostId: enrollment.hostId };
      } catch (error) {
        enrollments.clearPending(request.key);
        throw error;
      }
    },
  };
}
