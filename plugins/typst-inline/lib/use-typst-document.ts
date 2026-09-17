import { useEffect, useRef, useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { TypstArtifactSource, typstInlineRpcContract } from "../server.js";
import { decodeBase64 } from "./base64.js";
import { sourceKey } from "./artifact-source.js";
import type { TypstPage } from "./typst-pages.js";
import {
  loadTypstDocument,
  resetTypstDocument,
  typstDocumentKey,
  type TypstDocument,
} from "./typst-artifact.js";

export type TypstDocumentState =
  | { status: "missing-file" }
  | { status: "loading"; file: string }
  | {
      status: "ready";
      document: TypstDocument;
      file: string;
      pages: readonly TypstPage[];
      svg: string;
    }
  | { status: "error"; file: string; message: string };

export interface TypstDocumentHandle {
  reload: () => void;
  state: TypstDocumentState;
}

export function useTypstDocument(input: {
  file: string;
  source: TypstArtifactSource | null;
}): TypstDocumentHandle {
  const rpc = useRpc<typeof typstInlineRpcContract>();
  const { file, source } = input;
  const [reloadToken, setReloadToken] = useState(0);
  const documentKeyRef = useRef<string | null>(null);
  const [state, setState] = useState<TypstDocumentState>(() =>
    file.length > 0 && source !== null
      ? { status: "loading", file }
      : { status: "missing-file" },
  );

  useEffect(() => {
    if (file.length === 0 || source === null) {
      setState({ status: "missing-file" });
      return;
    }
    let cancelled = false;
    setState({ status: "loading", file });

    void (async () => {
      try {
        const artifact = await rpc.call("prepareArtifact", { source, file });
        const request = {
          mainPath: `/${artifact.file}`,
          source: artifact.content,
          readDependency: async (path: string) => {
            const dependency = await rpc.call("readArtifactFile", {
              source,
              file: path.replace(/^\/+/, ""),
            });
            return dependency.contentEncoding === "utf8"
              ? new TextEncoder().encode(dependency.content)
              : decodeBase64(dependency.content);
          },
        };
        const documentKey = typstDocumentKey({
          content: artifact.content,
          file: artifact.file,
          source: sourceKey(source),
        });
        documentKeyRef.current = documentKey;
        const document = loadTypstDocument(documentKey, request);
        const svg = await document.svg;
        const pages = await document.pages();
        if (cancelled) return;
        setState({
          status: "ready",
          document,
          file: artifact.file,
          pages,
          svg,
        });
      } catch (error) {
        if (cancelled) return;
        setState({
          status: "error",
          file,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [file, reloadToken, rpc, source]);

  const reload = (): void => {
    const documentKey = documentKeyRef.current;
    if (documentKey !== null) resetTypstDocument(documentKey);
    setReloadToken((token) => token + 1);
  };

  return { reload, state };
}
