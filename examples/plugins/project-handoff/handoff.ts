import type { PluginBrowserBbSdk } from "@get-bb/plugin-sdk/app";

function inline(value: string): string {
  return value.replace(/[\r\n]+/g, " ").replace(/[\\`*_<>[\]]/g, "\\$&");
}

export async function createProjectHandoff(
  sdk: Pick<PluginBrowserBbSdk, "projects" | "threads">,
  projectId: string,
): Promise<string> {
  const [project, threads] = await Promise.all([
    sdk.projects.get({ projectId }),
    sdk.threads.list({
      projectId,
      archived: false,
      includeHidden: false,
      limit: 100,
    }),
  ]);
  return [
    `# ${inline(project.name)} — project handoff`,
    "",
    `Project: ${inline(project.id)}`,
    "",
    "## Sources",
    ...project.sources.map(
      (source) =>
        `- ${source.isDefault ? "Default checkout" : "Checkout"}: ${inline(source.path)} (machine ${inline(source.hostId)})`,
    ),
    ...(project.sources.length === 0 ? ["No sources configured."] : []),
    "",
    "## Active threads (up to 100)",
    ...threads.map(
      (thread) =>
        `- ${inline(thread.title ?? "Untitled")} — ${inline(thread.status)} — @thread:${thread.id}`,
    ),
    ...(threads.length === 0 ? ["No active threads."] : []),
    "",
    "## Next steps",
    "- Review active threads and record decisions before handing over.",
    "- Confirm the intended checkout and branch with the next owner.",
    "",
  ].join("\n");
}
