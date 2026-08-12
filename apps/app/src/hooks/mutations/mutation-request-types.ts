import type {
  EnvironmentActionRequest,
  EditMessageRequest,
  SendMessageRequest,
} from "@bb/server-contract";

export type RequestEnvironmentActionMutationRequest = {
  id: string;
} & EnvironmentActionRequest;

export interface SendThreadMessageMutationRequest extends SendMessageRequest {
  id: string;
}

export interface EditMessageMutationRequest extends EditMessageRequest {
  id: string;
}
