import { describeMutationErrorToast } from "@/lib/query/mutation-errors";
import { createProfileQueryClient } from "@/lib/query/query-client";
import {
  createProfileClientRegistry,
  type ProfileClientRegistry,
} from "@/lib/sdk";
import { toast } from "@/ui/Toast";

let instance: ProfileClientRegistry | null = null;

interface MutationToastOptions {
  description?: string;
}

export function getAppProfileClientRegistry(): ProfileClientRegistry {
  if (!instance) {
    instance = createProfileClientRegistry({
      createQueryClient: () =>
        createProfileQueryClient({
          onMutationError: (error, mutation) => {
            const described = describeMutationErrorToast(error, mutation.meta);
            if (!described) return;
            const options: MutationToastOptions = {};
            if (described.description) {
              options.description = described.description;
            }
            toast.error(described.title, options);
          },
        }),
    });
  }
  return instance;
}
