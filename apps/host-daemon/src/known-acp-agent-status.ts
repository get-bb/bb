import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const COMMAND_CHECK_TIMEOUT_MS = 5_000;

export interface KnownAcpAgentExecutableQuery {
  id: string;
  executableName: string;
}

export interface KnownAcpAgentExecutableStatus {
  id: string;
  executableName: string;
  installed: boolean;
  executablePath: string | null;
}

async function executablePath(
  executableName: string,
  env: NodeJS.ProcessEnv,
): Promise<string | null> {
  try {
    const lookup = process.platform === "win32" ? "where" : "which";
    const { stdout } = await execFileAsync(lookup, [executableName], {
      env,
      timeout: COMMAND_CHECK_TIMEOUT_MS,
    });
    return (
      stdout
        .split(/\r?\n/u)
        .find((line) => line.trim())
        ?.trim() ?? null
    );
  } catch {
    return null;
  }
}

export async function getKnownAcpAgentsStatus(args: {
  agents: readonly KnownAcpAgentExecutableQuery[];
  env?: NodeJS.ProcessEnv;
}): Promise<{ agents: KnownAcpAgentExecutableStatus[] }> {
  const env = args.env ?? process.env;
  return {
    agents: await Promise.all(
      args.agents.map(async (agent) => {
        const resolvedPath = await executablePath(agent.executableName, env);
        return {
          ...agent,
          installed: resolvedPath !== null,
          executablePath: resolvedPath,
        };
      }),
    ),
  };
}
