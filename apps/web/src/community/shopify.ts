import { z } from "zod";
import type { Env } from "../server/env";

export type ShopifyEnv = Pick<
  Env,
  | "COMMUNITY_SHOPIFY_STORE"
  | "COMMUNITY_STICKER_VARIANT_ID"
  | "SHOPIFY_CLIENT_ID"
  | "SHOPIFY_CLIENT_SECRET"
>;

type ShopifyConfig = {
  store: string;
  variantId: string;
  clientId: string;
  clientSecret: string;
};

type CreateResult = { ok: true } | { ok: false; reason: string };

const API_VERSION = "2026-10";
const TIMEOUT_MS = 5000;
const CODE_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

const tokenResponse = z.object({
  access_token: z.string(),
  expires_in: z.number(),
});
const userErrors = z.array(z.object({ code: z.string().nullable() }));
const createResponse = z.object({
  data: z.object({
    discountCodeBasicCreate: z.object({
      codeDiscountNode: z.object({ id: z.string() }).nullable(),
      userErrors,
    }),
  }),
});
const graphqlErrors = z.object({
  errors: z.array(
    z.object({ extensions: z.object({ code: z.string() }).optional() }),
  ),
});
const lookupResponse = z.object({
  data: z.object({
    codeDiscountNodeByCode: z.object({ id: z.string() }).nullable(),
  }),
});

let cachedToken: { key: string; token: string; expiresAt: number } | null =
  null;

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
  config: ShopifyConfig,
  code: string,
  email: string,
): string {
  const url = new URL(`https://${config.store}/cart/${config.variantId}:1`);
  url.searchParams.set("discount", code);
  url.searchParams.set("checkout[email]", email);
  return url.href;
}

export function resetShopifyTokenCache(): void {
  cachedToken = null;
}

async function accessToken(config: ShopifyConfig) {
  const key = `${config.store}:${config.clientId}`;
  const now = Date.now();
  if (cachedToken?.key === key && cachedToken.expiresAt - 60_000 > now)
    return cachedToken.token;
  const response = await fetch(
    `https://${config.store}/admin/oauth/access_token`,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: config.clientId,
        client_secret: config.clientSecret,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: "error",
    },
  );
  if (!response.ok) throw new Error(`token_${response.status}`);
  const body = tokenResponse.parse(await response.json());
  cachedToken = {
    key,
    token: body.access_token,
    expiresAt: now + body.expires_in * 1000,
  };
  return body.access_token;
}

async function graphql(
  token: string,
  config: ShopifyConfig,
  query: string,
  variables: Record<string, unknown>,
): Promise<unknown> {
  const response = await fetch(
    `https://${config.store}/admin/api/${API_VERSION}/graphql.json`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Shopify-Access-Token": token,
      },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: "error",
    },
  );
  if (response.status === 401 || response.status === 403) cachedToken = null;
  if (!response.ok) throw new Error(`graphql_${response.status}`);
  const body: unknown = await response.json();
  const failure = graphqlErrors.safeParse(body);
  if (failure.success && failure.data.errors.length)
    throw new Error(
      `graphql_${failure.data.errors[0]?.extensions?.code ?? "error"}`,
    );
  return body;
}

async function codeExists(token: string, config: ShopifyConfig, code: string) {
  const body = lookupResponse.parse(
    await graphql(
      token,
      config,
      "query StickerCode($code: String!) { codeDiscountNodeByCode(code: $code) { id } }",
      { code },
    ),
  );
  return body.data.codeDiscountNodeByCode !== null;
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
    return { ok: false, reason: reasonOf(error) };
  }
  try {
    const body = createResponse.parse(
      await graphql(
        token,
        config,
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
    const result = body.data.discountCodeBasicCreate;
    if (result.codeDiscountNode && !result.userErrors.length)
      return { ok: true };
    if (await codeExists(token, config, code)) return { ok: true };
    return {
      ok: false,
      reason: result.userErrors.map((error) => error.code).join(",") || "none",
    };
  } catch (error) {
    try {
      if (await codeExists(token, config, code)) return { ok: true };
    } catch {}
    return { ok: false, reason: reasonOf(error) };
  }
}

function reasonOf(error: unknown): string {
  if (error instanceof Error && /^(token|graphql)_/.test(error.message))
    return error.message;
  if (error instanceof Error && error.name === "TimeoutError") return "timeout";
  return "unavailable";
}
