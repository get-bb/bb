import type { SendMessageResponse } from "@bb/server-contract";
import type { SendThreadMessageMutationRequest } from "@/hooks/mutations/mutation-request-types";

export interface SendMessageMutationLike {
  isPending: boolean;
  mutateAsync: (
    request: SendThreadMessageMutationRequest,
  ) => Promise<SendMessageResponse>;
}
