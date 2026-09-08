import type {
  EnrollmentBootstrap,
  MachineBootstrapApi,
  MachineEnrollments,
  MachineInstallerCommand,
} from "@get-bb/plugin-sdk";

const installerScript = `
set -eu
umask 077
BB_ENROLLMENT=$(cat)
export BB_ENROLLMENT
installer_url=$1
installer_file=$(mktemp)
trap 'rm -f "$installer_file"' EXIT HUP INT TERM
curl --fail --silent --show-error --location --connect-timeout 10 --max-time 60 "$installer_url" > "$installer_file"
sh "$installer_file" --bootstrap-env BB_ENROLLMENT
`;

const preinstalledScript = `
set -eu
BB_ENROLLMENT=$(cat)
export BB_ENROLLMENT
bb_bin="$HOME/.local/bin/bb"
if [ ! -x "$bb_bin" ]; then bb_bin=$(command -v bb); fi
"$bb_bin" machine enroll --bootstrap-env BB_ENROLLMENT
unset BB_ENROLLMENT
"$bb_bin" machine start --host-id "$1"
`;

export function installerCommand(
  bootstrap: EnrollmentBootstrap,
): MachineInstallerCommand {
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

export function createMachineBootstrapApi(
  enrollments: MachineEnrollments,
): MachineBootstrapApi {
  return {
    enrollments,
    prepareEnrollment: enrollments.prepare,
    waitForConnection: enrollments.waitForConnection,
    installerCommand,
    async bootstrap(request) {
      request.signal.throwIfAborted();
      request.report.step("Preparing machine enrollment");
      const enrollment = await enrollments.prepare({
        key: request.key,
        access: request.access,
      });
      request.signal.throwIfAborted();
      request.report.step(
        enrollment.state === "enrolled"
          ? "Starting enrolled machine"
          : "Bootstrapping machine",
      );
      const execution =
        enrollment.state === "enrolled"
          ? {
              command: [
                "sh",
                "-c",
                'bb_bin="$HOME/.local/bin/bb"; if [ ! -x "$bb_bin" ]; then bb_bin=$(command -v bb); fi; exec "$bb_bin" machine start --host-id "$1"',
                "bb-machine-start",
                enrollment.hostId,
              ],
            }
          : request.daemon.kind === "install"
            ? installerCommand(enrollment.bootstrap)
            : {
                command: [
                  "sh",
                  "-c",
                  preinstalledScript,
                  "bb-machine-bootstrap",
                  enrollment.hostId,
                ],
                stdin: JSON.stringify(enrollment.bootstrap),
              };
      try {
        const result = await request.executor.exec({
          ...execution,
          timeoutMs: 600_000,
          signal: request.signal,
        });
        if (result.exitCode !== 0)
          throw new Error("Machine bootstrap command failed");
      } catch {
        request.signal.throwIfAborted();
        throw new Error("Machine bootstrap command failed");
      }
      request.signal.throwIfAborted();
      request.report.step("Waiting for machine connection");
      return enrollments.waitForConnection({
        enrollmentId: enrollment.id,
        timeoutMs: 120_000,
        signal: request.signal,
      });
    },
  };
}
