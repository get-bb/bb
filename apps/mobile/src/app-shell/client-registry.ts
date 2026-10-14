import { getProfileStore, getSealedDeviceIdentityStore } from "@/lib/native";
import { describeThisDevice } from "@/lib/device-label";
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
    instance = createProfileClientRegistry({
      onServerMoved: (profileId, moved) => {
        serverMoved.handle(profileId, moved).catch((error: unknown) => {
          toast.error("Could not update the server address", {
            description: error instanceof Error ? error.message : String(error),
          });
        });
      },
      sealed: {
        identity: () => getSealedDeviceIdentityStore().load(),
        deviceName: describeThisDevice(),
        onPinned: async (profileId, trust) => {
          await getProfileStore().updateProfile(profileId, { sealed: trust });
        },
      },
    });
  }
  return instance;
}
