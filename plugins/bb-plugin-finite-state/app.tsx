// FROZEN. Amend only through AMENDMENTS.md and a CONTRACT_VERSION broadcast.
import { definePluginApp } from "@bb/plugin-sdk/app";
import { createAppContext } from "./lib/app-context.js";
import { registerRemoteServicesApp } from "./lanes/remote/register.app.js";
import { registerSyncApp } from "./lanes/sync/register.app.js";
import { registerFindingsApp } from "./lanes/findings/register.app.js";
import { registerProductSecurityApp } from "./lanes/product-security/register.app.js";
import { registerBomApp } from "./lanes/bom/register.app.js";
import { registerFirmwareApp } from "./lanes/firmware/register.app.js";
import { registerBenchApp } from "./lanes/bench/register.app.js";
import { registerDocumentsApp } from "./lanes/documents/register.app.js";
import { registerAgenticApp } from "./lanes/agentic/register.app.js";
import { registerHardwareApp } from "./lanes/hardware/register.app.js";
import { registerGroundingApp } from "./lanes/grounding/register.app.js";
import { registerAuthoringApp } from "./lanes/authoring/register.app.js";
import { registerDebugBenchApp } from "./lanes/debug-bench/register.app.js";

export default definePluginApp((app) => {
  const ctx = createAppContext();
  registerRemoteServicesApp(app, ctx); // no-op stub — remote services are backend-only
  registerSyncApp(app, ctx); // review/plan panel (/plugins/finite-state/sync)
  registerFindingsApp(app, ctx);
  registerProductSecurityApp(app, ctx);
  registerBomApp(app, ctx);
  registerFirmwareApp(app, ctx); // fileOpener + firmware status chip
  registerBenchApp(app, ctx);
  registerDocumentsApp(app, ctx);
  registerAgenticApp(app, ctx); // cross-cutting directives (::fs-plan) + shared wiring
  registerHardwareApp(app, ctx);
  registerGroundingApp(app, ctx);
  registerAuthoringApp(app, ctx);
  registerDebugBenchApp(app, ctx);
});
