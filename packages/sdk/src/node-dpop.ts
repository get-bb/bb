import {
  createHash,
  createPrivateKey,
  generateKeyPairSync,
  randomUUID,
  sign,
} from "node:crypto";
import { z } from "zod";
import type { DpopPublicJwk, DpopSigner } from "./dpop.js";

export const dpopPrivateJwkSchema = z
  .object({
    kty: z.literal("EC"),
    crv: z.literal("P-256"),
    x: z.string().min(1),
    y: z.string().min(1),
    d: z.string().min(1),
  })
  .strict();
export type DpopPrivateJwk = z.infer<typeof dpopPrivateJwkSchema>;

export function generateDpopPrivateJwk(): DpopPrivateJwk {
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  return dpopPrivateJwkSchema.parse(privateKey.export({ format: "jwk" }));
}

export function createNodeDpopSigner(privateJwk: DpopPrivateJwk): DpopSigner {
  const key = createPrivateKey({ key: privateJwk, format: "jwk" });
  const publicJwk: DpopPublicJwk = {
    kty: "EC",
    crv: "P-256",
    x: privateJwk.x,
    y: privateJwk.y,
  };
  return {
    publicJwk,
    async sign(data) {
      return sign("sha256", data, { key, dsaEncoding: "ieee-p1363" });
    },
    async sha256(data) {
      return createHash("sha256").update(data).digest();
    },
    randomId() {
      return randomUUID();
    },
  };
}
