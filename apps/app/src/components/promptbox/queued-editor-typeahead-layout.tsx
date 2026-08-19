import { createContext, useContext } from "react";

export interface QueuedEditorTypeaheadLayout {
  height: number;
  isOpen: boolean;
}

export type QueuedEditorTypeaheadLayoutReporter = (
  layout: QueuedEditorTypeaheadLayout,
) => void;

export const QueuedEditorTypeaheadLayoutContext =
  createContext<QueuedEditorTypeaheadLayoutReporter | null>(null);

export function useQueuedEditorTypeaheadLayoutReporter(): QueuedEditorTypeaheadLayoutReporter | null {
  return useContext(QueuedEditorTypeaheadLayoutContext);
}
