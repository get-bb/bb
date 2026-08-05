import type {
  PromptInput,
  ThreadChildOrigin,
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
  /** @deprecated Use originKind. */
  childOrigin?: ThreadChildOrigin | null;
  /**
   * May be the server-resolved "project-default" marker; thread creation
   * resolves it into a concrete environment before any provisioning logic.
   */
  environment: CreateThreadEnvironmentArgs;
  executionInputSources?: CreateThreadRequest["executionInputSources"];
  input: PromptInput[];
  sectionId?: CreateThreadRequest["sectionId"];
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
  /**
   * Present ⇒ bind the new thread to this existing external provider session
   * (ACP session import) and replay its history instead of starting fresh.
   * Set only by the thread-import service; incompatible with source-derived
   * creation (originKind/sourceThreadId) and requires empty input.
   */
  sessionImport?: { providerThreadId: string };
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
  /** Resolved at the create boundary: request value, else inherited/default. */
  visibility: ThreadVisibility;
}
