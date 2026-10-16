import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { BuiltinConnectRequestContext } from "@bb/tunnel-contract";
import { createConnectPlugin } from "./plugin.js";

export default function plugin(
  bb: BbPluginApi,
  core?: BuiltinConnectRequestContext,
) {
  return createConnectPlugin({ requestContext: core })(bb);
}
