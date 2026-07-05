import { createServerFn } from "@tanstack/react-start";
import {
  claimHandle,
  createConnectCode,
  createMachineCode,
  disconnectServer,
  getAccountState,
  type AccountState,
} from "./api.js";
import { getEnv } from "./env.js";
import { getSessionUserId } from "./current-user.server.js";

// The ONLY server module the client route imports. Everything here is a
// createServerFn, so the client receives RPC stubs and none of the server-only
// imports (D1, better-auth, cloudflare:workers) land in the client bundle.

export type DashboardState = { authed: false } | ({ authed: true } & AccountState);

export const getDashboard = createServerFn({ method: "GET" }).handler(
  async (): Promise<DashboardState> => {
    const userId = await getSessionUserId();
    if (!userId) return { authed: false };
    return { authed: true, ...(await getAccountState(getEnv(), userId)) };
  },
);

export const claimHandleFn = createServerFn({ method: "POST" })
  .validator((handle: string) => handle)
  .handler(async ({ data: handle }) => {
    const userId = await getSessionUserId();
    if (!userId) return { error: "unauthenticated" };
    return claimHandle(getEnv(), userId, handle);
  });

export const createCodeFn = createServerFn({ method: "POST" }).handler(async () => {
  const userId = await getSessionUserId();
  if (!userId) return { error: "unauthenticated" as const };
  return createConnectCode(getEnv(), userId);
});

export const createMachineCodeFn = createServerFn({ method: "POST" }).handler(async () => {
  const userId = await getSessionUserId();
  if (!userId) return { error: "unauthenticated" as const };
  return createMachineCode(getEnv(), userId);
});

export const disconnectFn = createServerFn({ method: "POST" }).handler(async () => {
  const userId = await getSessionUserId();
  if (!userId) return { error: "unauthenticated" as const };
  return disconnectServer(getEnv(), userId);
});
