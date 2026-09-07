export const SANDBOX_PROJECTS_DIR = "/workspace";

export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

export function projectDirectoryName(projectName: string): string {
  const slug = projectName
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 64);
  return slug.length > 0 ? slug : "project";
}

export function projectClonePath(projectName: string): string {
  return `${SANDBOX_PROJECTS_DIR}/${projectDirectoryName(projectName)}`;
}

export function prerequisitesScript(): string {
  return [
    "set -eu",
    "missing=",
    "for tool in node npm git curl make g++; do",
    '  command -v "$tool" >/dev/null 2>&1 || missing="$missing $tool"',
    "done",
    'if [ -z "$missing" ]; then',
    '  echo "prerequisites already present; skipping apt"',
    "  exit 0",
    "fi",
    'echo "installing missing prerequisites:$missing"',
    "apt-get update -qq",
    "DEBIAN_FRONTEND=noninteractive apt-get install -y -qq ca-certificates curl git build-essential nodejs npm",
  ].join("\n");
}

export function providerAuthenticationScript(
  providerId: string,
  environmentVariables: Readonly<Record<string, string>>,
): string | null {
  if (providerId !== "codex") return null;
  if ((environmentVariables.CODEX_ACCESS_TOKEN ?? "").length > 0) {
    return [
      "set -eu",
      "printenv CODEX_ACCESS_TOKEN | codex login --with-access-token",
    ].join("\n");
  }
  if ((environmentVariables.OPENAI_API_KEY ?? "").length > 0) {
    return [
      "set -eu",
      "printenv OPENAI_API_KEY | codex login --with-api-key",
    ].join("\n");
  }
  return null;
}

export function shellCommand(script: string): string[] {
  return ["sh", "-c", script];
}
