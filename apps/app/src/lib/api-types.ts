import type { ThreadChildOrigin } from "@bb/domain";
import type { CreateThreadRequest } from "@bb/server-contract";

export type AppCreateThreadRequest = Omit<
  CreateThreadRequest,
  "origin" | "startedOnBehalfOf" | "originKind" | "childOrigin"
> &
  Partial<
    Pick<
      CreateThreadRequest,
      "startedOnBehalfOf" | "originKind" | "childOrigin"
    >
  >;

export interface ThreadListFilters {
  projectId?: string;
  parentThreadId?: string;
  sourceThreadId?: string;
  /** Restrict to threads filed directly under this section. */
  sectionId?: string;
  /** Restrict to loose threads — those not filed under any section. */
  unsectioned?: boolean;
  hasParent?: boolean;
  /** Restrict to threads spawned with this origin. */
  originKind?: ThreadChildOrigin;
  /** @deprecated Use originKind. */
  childOrigin?: ThreadChildOrigin;
  /** App callers must choose active or archived; server omission intentionally means both. */
  archived: boolean;
  limit?: number;
  offset?: number;
}

export interface ThreadSearchFilters {
  query: string;
  limitPerGroup?: number;
}
