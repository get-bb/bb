import type {
  PromptInput,
  ThreadOriginKind,
  ThreadVisibility,
} from "@bb/domain";
import type {
  CreateThreadEnvironmentArgs,
  CreateThreadRequest,
  EnvironmentArgs,
  StartedOnBehalfOf,
  ThreadCreateOrigin,
} from "@bb/server-contract";

export interface ThreadCreateServiceRequestInput {
  environment: CreateThreadEnvironmentArgs;
  executionInputSources?: CreateThreadRequest["executionInputSources"];
  /**
   * Epoch ms the first turn should dispatch at. Present ⇒ the thread is
   * created idle with no turn and the first turn becomes a dispatch hold.
   */
  holdUntil?: CreateThreadRequest["holdUntil"];
  input: PromptInput[];
  sectionId?: CreateThreadRequest["sectionId"];
  model?: CreateThreadRequest["model"];
  origin: ThreadCreateOrigin | null;
  originPluginId?: CreateThreadRequest["originPluginId"];
  originKind?: ThreadOriginKind | null;
  parentThreadId?: string;
  permissionMode?: CreateThreadRequest["permissionMode"];
  /** Side-channel input for dispatch gates, keyed by plugin id. */
  pluginInputs?: CreateThreadRequest["pluginInputs"];
  projectId: string;
  providerId?: CreateThreadRequest["providerId"];
  reasoningLevel?: CreateThreadRequest["reasoningLevel"];
  serviceTier?: CreateThreadRequest["serviceTier"];
  sourceSeqEnd?: CreateThreadRequest["sourceSeqEnd"];
  sourceThreadId?: string;
  startedOnBehalfOf: StartedOnBehalfOf | null;
  title?: string;
  visibility?: ThreadVisibility;
}

export interface ThreadCreateServiceRequest extends Omit<
  ThreadCreateServiceRequestInput,
  "environment" | "providerId"
> {
  environment: EnvironmentArgs;
  providerId: string;
  titleFallback: string | null;
  visibility: ThreadVisibility;
}
