import { createFileRoute, redirect } from "@tanstack/react-router";

import { getPublicMarketplace } from "../marketplace/marketplace-server.js";
import { builtinPluginDestination } from "../plugin-guide/builtin-plugin-destination.js";

export const Route = createFileRoute("/marketplace/builtin/$plugin")({
  loader: async ({ params }) => {
    const destination = builtinPluginDestination(
      await getPublicMarketplace(),
      params.plugin,
    );
    if (destination.kind === "marketplace") {
      throw redirect({
        to: "/marketplace/$pluginId",
        params: { pluginId: destination.pluginId },
      });
    }
    throw redirect({ href: destination.href });
  },
});
