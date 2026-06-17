import type {
  PromptInput,
  ThreadChildOrigin,
  ThreadOriginKind,
} from "@bb/domain";
import type {
  CreateThreadRequest,
  EnvironmentArgs,
  StartedOnBehalfOf,
  ThreadCreateOrigin,
} from "@bb/server-contract";

export interface ThreadCreateServiceRequestInput {
  /** @deprecated Use originKind. */
  childOrigin?: ThreadChildOrigin | null;
  environment: EnvironmentArgs;
  executionInputSources?: CreateThreadRequest["executionInputSources"];
  input: PromptInput[];
  model?: CreateThreadRequest["model"];
  origin: ThreadCreateOrigin | null;
  originKind?: ThreadOriginKind | null;
  parentThreadId?: string;
  permissionMode?: CreateThreadRequest["permissionMode"];
  projectId: string;
  providerId?: CreateThreadRequest["providerId"];
  reasoningLevel?: CreateThreadRequest["reasoningLevel"];
  serviceTier?: CreateThreadRequest["serviceTier"];
  sourceThreadId?: string;
  startedOnBehalfOf: StartedOnBehalfOf | null;
  title?: string;
}

export interface ThreadCreateServiceRequest extends Omit<
  ThreadCreateServiceRequestInput,
  "providerId"
> {
  providerId: string;
}
