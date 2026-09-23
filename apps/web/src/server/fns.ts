import { createServerFn } from "@tanstack/react-start";
import { MAX_PER_ACCOUNT } from "@bb/connect-db";
import {
  type LinkApprovalTarget,
  type LinkRequestView,
  approveServerLink,
  denyServerLink,
  getLinkRequestView,
} from "./account.js";
import {
  checkAvailability,
  claimHandle,
  createConnectCode,
  createServer,
  depsFromEnv,
  disconnectServer,
  removeServer,
  revokeMachine,
  getAccountState,
  type AccountState,
  type Deps,
} from "./api.js";
import { getEnv } from "./env.js";
import { getSessionUserId } from "./current-user.server.js";
import { resolveDevEmailPasswordEnabled } from "./local-auth.js";

type DashboardState =
  | { authed: false; emailPasswordEnabled: boolean }
  | ({ authed: true } & AccountState);

async function withSessionUser<T>(
  run: (userId: string, deps: Deps) => Promise<T>,
): Promise<T | { error: "unauthenticated" }> {
  const userId = await getSessionUserId();
  if (!userId) return { error: "unauthenticated" };
  return run(userId, depsFromEnv(getEnv()));
}

function serverIdValidator(input: { serverId: string }): { serverId: string } {
  return { serverId: String(input.serverId) };
}

export const getDashboard = createServerFn({ method: "GET" }).handler(
  async (): Promise<DashboardState> => {
    const env = getEnv();
    const userId = await getSessionUserId();
    if (!userId) {
      return {
        authed: false,
        emailPasswordEnabled: resolveDevEmailPasswordEnabled(env),
      };
    }
    return {
      authed: true,
      ...(await getAccountState(depsFromEnv(env), userId)),
    };
  },
);

export const claimHandleFn = createServerFn({ method: "POST" })
  .validator((handle: string) => String(handle))
  .handler(async ({ data: handle }) =>
    withSessionUser((userId, deps) => claimHandle(deps, userId, handle)),
  );

export const checkAvailabilityFn = createServerFn({ method: "POST" })
  .validator((label: string) => String(label))
  .handler(async ({ data: label }) =>
    withSessionUser((_userId, deps) => checkAvailability(deps, label)),
  );

export const createServerRowFn = createServerFn({ method: "POST" })
  .validator((label: string) => String(label))
  .handler(async ({ data: label }) =>
    withSessionUser((userId, deps) => createServer(deps, userId, label)),
  );

export const createCodeFn = createServerFn({ method: "POST" })
  .validator((input: { serverId?: string; reuse?: boolean } | undefined) => ({
    serverId: typeof input?.serverId === "string" ? input.serverId : undefined,
    reuse: input?.reuse === true,
  }))
  .handler(async ({ data }) =>
    withSessionUser((userId, deps) => createConnectCode(deps, userId, data)),
  );

export const disconnectFn = createServerFn({ method: "POST" })
  .validator(serverIdValidator)
  .handler(async ({ data }) =>
    withSessionUser(async (userId, deps) => {
      if (!data.serverId) return { error: "not-found" as const };
      return disconnectServer(deps, userId, data.serverId);
    }),
  );

export const removeServerFn = createServerFn({ method: "POST" })
  .validator(serverIdValidator)
  .handler(async ({ data }) =>
    withSessionUser(async (userId, deps) => {
      if (!data.serverId) return { error: "not-found" as const };
      return removeServer(deps, userId, data.serverId);
    }),
  );

export const revokeMachineFn = createServerFn({ method: "POST" })
  .validator((machineId: string) => String(machineId))
  .handler(async ({ data: machineId }) =>
    withSessionUser(async (userId, deps) => {
      if (!machineId) return { error: "not-found" as const };
      return revokeMachine(deps, userId, machineId);
    }),
  );

type LinkPageState =
  | { authed: false; emailPasswordEnabled: boolean }
  | { authed: true; view: LinkRequestView };

function linkCodeValidator(input: { code: string }): { code: string } {
  return { code: typeof input?.code === "string" ? input.code : "" };
}

function linkApprovalValidator(input: {
  code: string;
  target: LinkApprovalTarget;
}): { code: string; target: LinkApprovalTarget | null } {
  const code = typeof input?.code === "string" ? input.code : "";
  const target = input?.target;
  if (target?.kind === "new" && typeof target.label === "string") {
    return { code, target: { kind: "new", label: target.label } };
  }
  if (target?.kind === "existing" && typeof target.serverId === "string") {
    return { code, target: { kind: "existing", serverId: target.serverId } };
  }
  return { code, target: null };
}

export const getLinkPageFn = createServerFn({ method: "GET" })
  .validator(linkCodeValidator)
  .handler(async ({ data }): Promise<LinkPageState> => {
    const env = getEnv();
    const userId = await getSessionUserId();
    if (!userId) {
      return {
        authed: false,
        emailPasswordEnabled: resolveDevEmailPasswordEnabled(env),
      };
    }
    return {
      authed: true,
      view: await getLinkRequestView(
        depsFromEnv(env),
        userId,
        data.code,
        MAX_PER_ACCOUNT,
      ),
    };
  });

export const approveLinkFn = createServerFn({ method: "POST" })
  .validator(linkApprovalValidator)
  .handler(async ({ data }) =>
    withSessionUser(async (userId, deps) => {
      if (data.target === null) return { error: "invalid" as const };
      return approveServerLink(deps, userId, data.code, data.target);
    }),
  );

export const denyLinkFn = createServerFn({ method: "POST" })
  .validator(linkCodeValidator)
  .handler(async ({ data }) =>
    withSessionUser((_userId, deps) => denyServerLink(deps, data.code)),
  );
