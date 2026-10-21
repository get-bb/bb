import { z } from "zod";

const word = z.string().regex(/^[a-z0-9-]+$/u);
const contributions = z.object({
  cliCommands: z.array(
    z.object({
      pluginId: z
        .string()
        .min(1)
        .regex(/^[^\s\u0000]+$/u),
      name: word,
      commands: z.array(
        z.object({
          experimental_readOnlyCommandPath: z.array(word).min(1).optional(),
        }),
      ),
    }),
  ),
});

export async function loadPluginReadPaths(
  baseUrl: string,
  corePaths: ReadonlySet<string>,
  signal: AbortSignal,
): Promise<ReadonlySet<string>> {
  const response = await fetch(`${baseUrl}/api/v1/plugins/contributions`, {
    signal,
  });
  if (!response.ok)
    throw new Error(
      `Failed to read plugin CLI declarations: ${response.status}`,
    );
  const parsed = contributions.parse(await response.json());
  const paths = new Set<string>();
  for (const plugin of parsed.cliCommands) {
    for (const command of plugin.commands) {
      const words = command.experimental_readOnlyCommandPath;
      if (!words) continue;
      paths.add(["plugin", "run", plugin.pluginId, ...words].join(" "));
      if (
        ![...corePaths].some(
          (path) => path === plugin.name || path.startsWith(`${plugin.name} `),
        )
      )
        paths.add([plugin.name, ...words].join(" "));
    }
  }
  return paths;
}
