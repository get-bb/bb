import { createFromSource } from "fumadocs-core/search/server";

import { source } from "./source";

export const docsSearch = createFromSource(source, { language: "english" });
