import {
  createContext,
  useContext,
  useLayoutEffect,
  useRef,
  type RefObject,
} from "react";

interface FilePreviewScrollState {
  positionsRef: RefObject<Map<string, number>>;
  scrollKey: string;
}

export const FilePreviewScrollContext =
  createContext<FilePreviewScrollState | null>(null);

export function useFilePreviewScrollRestoration() {
  const bodyRef = useRef<HTMLDivElement>(null);
  const state = useContext(FilePreviewScrollContext);
  const positionsRef = state?.positionsRef;
  const scrollKey = state?.scrollKey;

  useLayoutEffect(() => {
    const container = bodyRef.current?.closest(
      "[data-file-preview-scroll-container]",
    );
    if (
      !(container instanceof HTMLElement) ||
      !positionsRef ||
      scrollKey === undefined
    ) {
      return;
    }

    container.scrollTop = positionsRef.current.get(scrollKey) ?? 0;
    const savePosition = () =>
      positionsRef.current.set(scrollKey, container.scrollTop);
    container.addEventListener("scroll", savePosition);
    return () => {
      container.removeEventListener("scroll", savePosition);
    };
  }, [positionsRef, scrollKey]);

  return bodyRef;
}
