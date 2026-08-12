// FROZEN. Amend only through AMENDMENTS.md and a CONTRACT_VERSION broadcast.
import type { BbPluginApi } from "@bb/plugin-sdk";
import { createPluginContext } from "./lib/context.js";
import { registerRemoteServices } from "./lanes/remote/register.js";
import { registerSync } from "./lanes/sync/register.js";
import { registerFindings } from "./lanes/findings/register.js";
import { registerProductSecurity } from "./lanes/product-security/register.js";
import { registerBom } from "./lanes/bom/register.js";
import { registerFirmware } from "./lanes/firmware/register.js";
import { registerBench } from "./lanes/bench/register.js";
import { registerDocuments } from "./lanes/documents/register.js";
import { registerAgentic } from "./lanes/agentic/register.js";

export default async function plugin(bb: BbPluginApi): Promise<void> {
  const ctx = createPluginContext(bb);
  await registerRemoteServices(bb, ctx); // L1 — owns native settings + connections.status
  registerSync(bb, ctx); // L2
  registerFindings(bb, ctx); // L3
  registerProductSecurity(bb, ctx); // L4
  registerBom(bb, ctx); // L5
  registerFirmware(bb, ctx); // L6
  registerBench(bb, ctx); // L6
  registerDocuments(bb, ctx); // L6
  registerAgentic(bb, ctx); // L7
}
