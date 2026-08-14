import type { ServerLogger, ServerRuntimeConfig } from "../../types.js";
import { runWithConnectRemote } from "../../request-context.js";
import { runtimeErrorLogFields } from "./error-log-fields.js";

export interface DeferAfterResponseArgs {
  config: Pick<ServerRuntimeConfig, "isDevelopment">;
  context?: Record<string, boolean | number | string | null | undefined>;
  logger: Pick<ServerLogger, "warn">;
  name: string;
  work: () => Promise<void>;
}

export function deferAfterResponse(args: DeferAfterResponseArgs): void {
  setImmediate(() => {
    runWithConnectRemote(false, () => {
      void args.work().catch((error) => {
        args.logger.warn(
          {
            ...args.context,
            ...runtimeErrorLogFields(args.config, error),
          },
          `${args.name} failed`,
        );
      });
    });
  });
}
