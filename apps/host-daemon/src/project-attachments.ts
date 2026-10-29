export interface FetchProjectAttachmentArgs {
  expectedSizeBytes?: number;
  maxBytes: number;
  path: string;
  projectId: string;
  threadId: string;
}

export interface FetchedProjectAttachment {
  content: AsyncIterable<Uint8Array>;
}

export type FetchProjectAttachment = (
  args: FetchProjectAttachmentArgs,
) => Promise<FetchedProjectAttachment>;
