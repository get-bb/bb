import { publicApiRoutes } from "@bb/server-contract";
import type { OperationRoutes } from "../kernel/http-door.js";
import type { AppDeps } from "../types.js";

export function registerTerminalRoutes(
  operations: OperationRoutes,
  deps: AppDeps,
): void {
  const routes = publicApiRoutes.terminals;

  operations.implement(routes.list, (query) => {
    const sessions = deps.terminalSessions.listTerminals({ query });
    return { sessions };
  });

  operations.implement(routes.create, async (payload) =>
    deps.terminalSessions.createTerminal({ payload }),
  );

  operations.implement(routes.get, ({ terminalId }) =>
    deps.terminalSessions.getTerminal({
      terminalId,
    }),
  );

  operations.implement(routes.update, ({ terminalId, ...payload }) =>
    deps.terminalSessions.renameTerminal({
      payload,
      terminalId,
    }),
  );

  operations.implement(routes.restart, async ({ terminalId }) =>
    deps.terminalSessions.restartTerminal({
      terminalId,
    }),
  );

  operations.implement(routes.close, async ({ terminalId, ...payload }) =>
    deps.terminalSessions.closeTerminal({
      payload,
      terminalId,
    }),
  );

  operations.implement(routes.input, ({ terminalId, ...payload }) =>
    deps.terminalSessions.sendTerminalInput({
      payload,
      terminalId,
    }),
  );

  operations.implement(routes.resize, ({ terminalId, ...payload }) =>
    deps.terminalSessions.resizeTerminal({
      payload,
      terminalId,
    }),
  );

  operations.implement(routes.output, async ({ terminalId, ...query }) =>
    deps.terminalSessions.readTerminalOutput({
      query,
      terminalId,
    }),
  );
}
