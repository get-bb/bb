import type { EnrollmentBootstrap } from "@get-bb/plugin-sdk";

function quote(value: string): string {
  return "'" + value.replaceAll("'", "'\"'\"'") + "'";
}

export function manualEnrollmentCommand(
  bootstrap: EnrollmentBootstrap,
): string {
  return `curl -fsSL -H ${quote(`X-BB-Enrollment: ${bootstrap.credential}`)} ${quote(new URL("/install.sh", bootstrap.serverUrl).href)} | sh`;
}

export function enrolledInstallerScript(
  script: string,
  bootstrap: EnrollmentBootstrap,
): string {
  return `export BB_ENROLLMENT=${quote(JSON.stringify(bootstrap))}\nset -- --bootstrap-env BB_ENROLLMENT\n${script}`;
}
