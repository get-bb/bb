import { createContext, useContext } from "react";

export interface OpenAttachmentRequest {
  name: string;
  path: string;
  projectId: string;
}

export const AttachmentOpenerContext = createContext<
  ((request: OpenAttachmentRequest) => void) | null
>(null);

export function useAttachmentOpener() {
  return useContext(AttachmentOpenerContext);
}
