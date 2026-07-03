import type {
  PromptInput,
  ThreadChildOrigin,
  ThreadOriginKind,
} from "@bb/domain";
import type {
  CreateThreadEnvironmentArgs,
  CreateThreadRequest,
  EnvironmentArgs,
  StartedOnBehalfOf,
  ThreadCreateOrigin,
} from "@bb/server-contract";

export interface ThreadCreateServiceRequestInput {
  /** @deprecated Use originKind. */
  childOrigin?: ThreadChildOrigin | null;
  /**
   * May be the server-resolved "project-default" marker; thread creation
   * resolves it into a concrete environment before any provisioning logic.
   */
  environment: CreateThreadEnvironmentArgs;
  executionInputSources?: CreateThreadRequest["executionInputSources"];
  input: PromptInput[];
  folderId?: CreateThreadRequest["folderId"];
  model?: CreateThreadRequest["model"];
  origin: ThreadCreateOrigin | null;
  /** Plugin attribution; paired with origin "plugin". */
  originPluginId?: CreateThreadRequest["originPluginId"];
  originKind?: ThreadOriginKind | null;
  parentThreadId?: string;
  permissionMode?: CreateThreadRequest["permissionMode"];
  projectId: string;
  providerId?: CreateThreadRequest["providerId"];
  reasoningLevel?: CreateThreadRequest["reasoningLevel"];
  serviceTier?: CreateThreadRequest["serviceTier"];
  sourceSeqEnd?: CreateThreadRequest["sourceSeqEnd"];
  sourceThreadId?: string;
  startedOnBehalfOf: StartedOnBehalfOf | null;
  title?: string;
}

export interface ThreadCreateServiceRequest extends Omit<
  ThreadCreateServiceRequestInput,
  "environment" | "providerId"
> {
  environment: EnvironmentArgs;
  providerId: string;
  titleFallback: string | null;
}
