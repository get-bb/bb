import { z } from "zod";

const rpcSuccessSchema = z.object({
  ok: z.literal(true),
  result: z.object({
    cookie: z.object({
      domain: z.string().min(1),
      expiresAt: z.number().int().positive(),
      name: z.string().min(1),
      value: z.string().min(1),
    }),
  }),
});

export interface DesktopCookieInstaller {
  set(details: {
    domain: string;
    expirationDate: number;
    httpOnly: boolean;
    name: string;
    path: string;
    sameSite: "lax";
    secure: boolean;
    url: string;
    value: string;
  }): Promise<void>;
}

export async function installConnectDesktopSession(args: {
  cookieInstaller: DesktopCookieInstaller;
  fetchImpl?: typeof fetch;
  localServerUrl: string;
  remoteServerUrl: string;
}): Promise<boolean> {
  const fetchImpl = args.fetchImpl ?? globalThis.fetch;
  const rpcUrl = new URL(
    "/api/v1/plugins/connect/rpc/createDesktopSession",
    args.localServerUrl,
  );
  let response: Response;
  try {
    response = await fetchImpl(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "null",
    });
  } catch {
    return false;
  }
  if (!response.ok) return false;

  const parsed = rpcSuccessSchema.safeParse(await response.json());
  if (!parsed.success) return false;
  const { cookie } = parsed.data.result;
  const remoteOrigin = new URL(args.remoteServerUrl).origin;
  await args.cookieInstaller.set({
    domain: cookie.domain,
    expirationDate: cookie.expiresAt / 1000,
    httpOnly: true,
    name: cookie.name,
    path: "/",
    sameSite: "lax",
    secure: remoteOrigin.startsWith("https://"),
    url: remoteOrigin,
    value: cookie.value,
  });
  return true;
}
