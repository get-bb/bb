import { z } from "zod";
import type { Env } from "../server/env";

export type ShopifyEnv = Pick<
  Env,
  | "COMMUNITY_SHOPIFY_STORE"
  | "COMMUNITY_STICKER_VARIANT_ID"
  | "SHOPIFY_CLIENT_ID"
  | "SHOPIFY_CLIENT_SECRET"
>;

export type ShopifyConfig = {
  store: string;
  variantId: string;
  clientId: string;
  clientSecret: string;
};

export type CreateResult =
  | { ok: true }
  | { ok: false; kind: "auth" | "unreachable" | "rejected" };

const API_VERSION = "2026-10";
const TIMEOUT_MS = 5000;
const CODE_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

const tokenResponse = z.object({ access_token: z.string() });
const createResponse = z.object({
  data: z.object({
    discountCodeBasicCreate: z.object({
      codeDiscountNode: z.object({ id: z.string() }).nullable(),
      userErrors: z.array(z.unknown()),
    }),
  }),
});
const lookupResponse = z.object({
  data: z.object({
    codeDiscountNodeByCode: z.object({ id: z.string() }).nullable(),
  }),
});

class ShopifyError extends Error {
  constructor(readonly kind: "auth" | "unreachable" | "rejected") {
    super(kind);
  }
}

export function shopifyConfig(env: ShopifyEnv): ShopifyConfig | null {
  const store = env.COMMUNITY_SHOPIFY_STORE ?? "";
  const variantId = env.COMMUNITY_STICKER_VARIANT_ID ?? "";
  if (
    !/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(store) ||
    !/^\d+$/.test(variantId) ||
    !env.SHOPIFY_CLIENT_ID ||
    !env.SHOPIFY_CLIENT_SECRET
  )
    return null;
  return {
    store,
    variantId,
    clientId: env.SHOPIFY_CLIENT_ID,
    clientSecret: env.SHOPIFY_CLIENT_SECRET,
  };
}

export function newStickerCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return `BB-${[...bytes].map((byte) => CODE_ALPHABET[byte % 32]).join("")}`;
}

export function claimUrl(
  config: Pick<ShopifyConfig, "store" | "variantId">,
  code: string,
  email: string,
): string {
  const url = new URL(`https://${config.store}/cart/${config.variantId}:1`);
  url.searchParams.set("discount", code);
  url.searchParams.set("checkout[email]", email);
  return url.href;
}

async function post(url: string, init: RequestInit): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new ShopifyError("unreachable");
  }
  if (response.status >= 500 || response.status === 429)
    throw new ShopifyError("unreachable");
  if (!response.ok) throw new ShopifyError("auth");
  return response.json();
}

async function accessToken(config: ShopifyConfig): Promise<string> {
  const body = tokenResponse.safeParse(
    await post(`https://${config.store}/admin/oauth/access_token`, {
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: config.clientId,
        client_secret: config.clientSecret,
      }),
    }),
  );
  if (!body.success) throw new ShopifyError("auth");
  return body.data.access_token;
}

function graphql(
  config: ShopifyConfig,
  token: string,
  query: string,
  variables: Record<string, unknown>,
): Promise<unknown> {
  return post(`https://${config.store}/admin/api/${API_VERSION}/graphql.json`, {
    headers: {
      "content-type": "application/json",
      "X-Shopify-Access-Token": token,
    },
    body: JSON.stringify({ query, variables }),
  });
}

async function codeExists(
  config: ShopifyConfig,
  token: string,
  code: string,
): Promise<boolean> {
  const body = lookupResponse.safeParse(
    await graphql(
      config,
      token,
      "query StickerCode($code: String!) { codeDiscountNodeByCode(code: $code) { id } }",
      { code },
    ),
  );
  return body.success && body.data.data.codeDiscountNodeByCode !== null;
}

export async function createStickerDiscount(
  config: ShopifyConfig,
  code: string,
  submissionId: string,
  now: number,
): Promise<CreateResult> {
  let token: string;
  try {
    token = await accessToken(config);
  } catch (error) {
    return {
      ok: false,
      kind: error instanceof ShopifyError ? error.kind : "unreachable",
    };
  }
  let failure: ShopifyError = new ShopifyError("rejected");
  try {
    const body = createResponse.safeParse(
      await graphql(
        config,
        token,
        "mutation StickerCode($discount: DiscountCodeBasicInput!) { discountCodeBasicCreate(basicCodeDiscount: $discount) { codeDiscountNode { id } userErrors { code } } }",
        {
          discount: {
            title: `Survey stickers – ${submissionId.slice(0, 8)}`,
            code,
            startsAt: new Date(now - 5 * 60_000).toISOString(),
            context: { all: "ALL" },
            customerGets: {
              value: {
                discountAmount: { amount: "3.00", appliesOnEachItem: false },
              },
              items: {
                products: {
                  productVariantsToAdd: [
                    `gid://shopify/ProductVariant/${config.variantId}`,
                  ],
                },
              },
            },
            usageLimit: 1,
            appliesOncePerCustomer: false,
            combinesWith: {
              orderDiscounts: false,
              productDiscounts: false,
              shippingDiscounts: false,
            },
            tags: ["survey"],
          },
        },
      ),
    );
    const created = body.success
      ? body.data.data.discountCodeBasicCreate
      : null;
    if (created?.codeDiscountNode && !created.userErrors.length)
      return { ok: true };
  } catch (error) {
    if (error instanceof ShopifyError) failure = error;
  }
  try {
    if (await codeExists(config, token, code)) return { ok: true };
  } catch {}
  return { ok: false, kind: failure.kind };
}
