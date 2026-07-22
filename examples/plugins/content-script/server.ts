import type { BbPluginApi } from "@bb/plugin-sdk";

export default function contentScriptExample(bb: BbPluginApi) {
  bb.log.info("Content script example loaded");
}
