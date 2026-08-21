import type { BbPluginApi } from "@get-bb/plugin-sdk";

/** Plugin API Tester currently contributes only frontend UI. */
export default function plugin(bb: BbPluginApi) {
  void bb;
}
