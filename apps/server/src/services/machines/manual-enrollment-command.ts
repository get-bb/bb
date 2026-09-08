import type { EnrollmentBootstrap } from "@get-bb/plugin-sdk";

function quote(value: string): string {
  return "'" + value.replaceAll("'", "'\"'\"'") + "'";
}

export function manualEnrollmentCommand(
  bootstrap: EnrollmentBootstrap,
): string {
  return `export BB_ENROLLMENT=${quote(JSON.stringify(bootstrap))}\nif command -v bb >/dev/null 2>&1 && bb machine enroll --help >/dev/null 2>&1; then\n  bb machine enroll --bootstrap-env BB_ENROLLMENT && bb machine start --host-id ${quote(bootstrap.hostId)}\nelse\n  node -e 'for (const [name,value] of Object.entries(JSON.parse(process.env.BB_ENROLLMENT).headers ?? {})) console.log("header = " + JSON.stringify(name + ": " + value))' | curl --config - -fL --progress-meter --connect-timeout 10 --max-time 60 --retry 2 ${quote(new URL("/install.sh", bootstrap.serverUrl).href)} | sh -s -- --bootstrap-env BB_ENROLLMENT\nfi\nunset BB_ENROLLMENT`;
}
