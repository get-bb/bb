import type {
  PublicOperationName,
  PublicOperationOutputSchema,
} from "../public-operations.js";
import { pluginsOutputSchemas } from "./plugins.js";
import { pluginCatalogOutputSchemas } from "./plugin-catalog.js";
import { marketplacesOutputSchemas } from "./marketplaces.js";
import { skillsRegistryOutputSchemas } from "./skills-registry.js";
import { desktopBrowsersOutputSchemas } from "./desktop-browsers.js";
import { environmentsOutputSchemas } from "./environments.js";
import { filePreviewsOutputSchemas } from "./file-previews.js";
import { filesOutputSchemas } from "./files.js";
import { hostsOutputSchemas } from "./hosts.js";
import { projectsOutputSchemas } from "./projects.js";
import { promptHistoryOutputSchemas } from "./prompt-history.js";
import { queueOutputSchemas } from "./queue.js";
import { serverOutputSchemas } from "./server.js";
import { systemOutputSchemas } from "./system.js";
import { terminalsOutputSchemas } from "./terminals.js";
import { threadsOutputSchemas } from "./threads.js";
import { threadSectionsOutputSchemas } from "./thread-sections.js";

export const publicOperationOutputSchemas: {
  readonly [Name in PublicOperationName]: PublicOperationOutputSchema<Name>;
} = {
  ...pluginsOutputSchemas,
  ...pluginCatalogOutputSchemas,
  ...marketplacesOutputSchemas,
  ...skillsRegistryOutputSchemas,
  ...desktopBrowsersOutputSchemas,
  ...environmentsOutputSchemas,
  ...filePreviewsOutputSchemas,
  ...filesOutputSchemas,
  ...hostsOutputSchemas,
  ...projectsOutputSchemas,
  ...promptHistoryOutputSchemas,
  ...queueOutputSchemas,
  ...serverOutputSchemas,
  ...systemOutputSchemas,
  ...terminalsOutputSchemas,
  ...threadsOutputSchemas,
  ...threadSectionsOutputSchemas,
};
