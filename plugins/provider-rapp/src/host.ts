import { defineRpcContract } from "@get-bb/plugin-sdk";
import { experimental_defineHostEntry } from "@get-bb/plugin-sdk/host";

export { experimental_providerBridge } from "./bridge.js";

export default experimental_defineHostEntry({
  contract: defineRpcContract({}),
  handlers: {},
});
