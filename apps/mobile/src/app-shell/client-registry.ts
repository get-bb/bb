import { createTicketSocketFactory } from "@/lib/device-auth";
import { getDeviceAuthRegistry, getProfileStore } from "@/lib/native";
import { createServerMovedProfileHandler } from "@/lib/profiles/server-moved";
import {
  createProfileClientRegistry,
  type ProfileClientRegistry,
} from "@/lib/sdk";
import { toast } from "@/ui/Toast";

let instance: ProfileClientRegistry | null = null;

export function getAppProfileClientRegistry(): ProfileClientRegistry {
  if (!instance) {
    const serverMoved = createServerMovedProfileHandler({
      store: getProfileStore(),
      notify: (message) => {
        toast.info(message);
      },
    });
    const deviceAuth = getDeviceAuthRegistry();
    instance = createProfileClientRegistry({
      sdk: {
        fetch: (input, init) => deviceAuth.fetch(input, init),
        realtime: {
          socketFactory: createTicketSocketFactory({
            resolveUrl: (url) => deviceAuth.socketUrlResolver(url),
          }),
        },
      },
      onServerMoved: (profileId, moved) => {
        serverMoved.handle(profileId, moved).catch((error: unknown) => {
          toast.error("Could not update the server address", {
            description: error instanceof Error ? error.message : String(error),
          });
        });
      },
    });
  }
  return instance;
}
