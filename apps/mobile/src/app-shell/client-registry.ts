import { describeMutationErrorToast } from "@/lib/query/mutation-errors";
import { createProfileQueryClient } from "@/lib/query/query-client";
import {
  createProfileClientRegistry,
  type ProfileClientRegistry,
} from "@/lib/sdk";
import { toast } from "@/ui/Toast";

let instance: ProfileClientRegistry | null = null;

/**
 * App-wide profile client registry. Every profile QueryClient it builds
 * routes failed mutations (those that did not opt out with
 * `meta.showErrorToast: false`) to the global error toast, with
 * `meta.errorMessage` as the headline — the same contract as the web app's
 * mutation cache, so data hooks never toast themselves.
 */
export function getAppProfileClientRegistry(): ProfileClientRegistry {
  if (!instance) {
    instance = createProfileClientRegistry({
      createQueryClient: () =>
        createProfileQueryClient({
          onMutationError: (error, mutation) => {
            const described = describeMutationErrorToast(error, mutation.meta);
            if (!described) return;
            toast.error(described.title, {
              ...(described.description
                ? { description: described.description }
                : {}),
            });
          },
        }),
    });
  }
  return instance;
}
