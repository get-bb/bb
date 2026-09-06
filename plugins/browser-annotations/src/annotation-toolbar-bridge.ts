export type AnnotationToolbarMode = "grab" | "annotate";

export interface AnnotationControllerInteractionState {
  pickerMode: AnnotationToolbarMode | null;
  reviewOpen: boolean;
  editorOpen: boolean;
  browserControlAvailable: boolean;
}

export interface AnnotationToolbarController {
  getInteractionState(): AnnotationControllerInteractionState;
  subscribe(listener: () => void): () => void;
  startPicker(mode: AnnotationToolbarMode): void;
  cancelPicker(): void;
  startScreenshotEditor(): void;
}

const controllersByTabId = new Map<string, AnnotationToolbarController>();
const registryListeners = new Set<() => void>();

function notifyRegistryChanged(): void {
  for (const listener of [...registryListeners]) listener();
}

export function registerAnnotationToolbarController(
  tabId: string,
  controller: AnnotationToolbarController,
): () => void {
  controllersByTabId.set(tabId, controller);
  notifyRegistryChanged();
  return () => {
    if (controllersByTabId.get(tabId) === controller) {
      controllersByTabId.delete(tabId);
      notifyRegistryChanged();
    }
  };
}

export function getAnnotationToolbarController(
  tabId: string,
): AnnotationToolbarController | null {
  return controllersByTabId.get(tabId) ?? null;
}

export function subscribeAnnotationToolbarRegistry(
  listener: () => void,
): () => void {
  registryListeners.add(listener);
  return () => registryListeners.delete(listener);
}

export const EMPTY_INTERACTION_STATE: AnnotationControllerInteractionState = {
  pickerMode: null,
  reviewOpen: false,
  editorOpen: false,
  browserControlAvailable: false,
};
