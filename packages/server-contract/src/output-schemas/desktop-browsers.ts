import {
  desktopBrowserBrokerProofSchema,
  desktopBrowserResultSchemas,
} from "@bb/host-daemon-contract";
import { z } from "zod";
import {
  experimentalDesktopBrowserConnectionSchema,
  experimentalDesktopBrowserInstancesSchema,
  experimentalDesktopBrowserLeaseSchema,
} from "../api/desktop-browsers.js";
import type { GroupOutputSchemas } from "../public-operations.js";

const okSchema = z.object({ ok: z.literal(true) });

export const desktopBrowsersOutputSchemas: GroupOutputSchemas<"desktopBrowsers"> =
  {
    "desktopBrowsers.brokerProof": desktopBrowserBrokerProofSchema,
    "desktopBrowsers.listInstances": experimentalDesktopBrowserInstancesSchema,
    "desktopBrowsers.listTabs":
      desktopBrowserResultSchemas["desktop.browser.list_tabs"],
    "desktopBrowsers.createTab":
      desktopBrowserResultSchemas["desktop.browser.create_tab"],
    "desktopBrowsers.acquireControl": experimentalDesktopBrowserLeaseSchema,
    "desktopBrowsers.openConnection":
      experimentalDesktopBrowserConnectionSchema,
    "desktopBrowsers.releaseControl": okSchema,
    "desktopBrowsers.closeTab": okSchema,
    "desktopBrowsers.revealTab": okSchema,
    "desktopBrowsers.captureTab":
      desktopBrowserResultSchemas["desktop.browser.capture_tab"],
    "desktopBrowsers.listImportSources":
      desktopBrowserResultSchemas["desktop.browser.list_import_sources"],
    "desktopBrowsers.importCookies":
      desktopBrowserResultSchemas["desktop.browser.import_cookies"],
  };
