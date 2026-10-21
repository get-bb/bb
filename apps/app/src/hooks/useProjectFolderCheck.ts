import { useEffect, useRef, useState } from "react";
import { BbHttpError } from "@bb/sdk/browser";
import { sdk } from "@/lib/sdk";

export function useProjectFolderCheck(
  hostId: string | null,
  path: string | null,
) {
  const request = useRef<AbortController | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [isMissing, setIsMissing] = useState(false);

  useEffect(() => {
    setIsMissing(false);
    setIsChecking(false);
    return () => {
      request.current?.abort();
      request.current = null;
    };
  }, [hostId, path]);

  const check = async (): Promise<boolean> => {
    if (request.current !== null) return false;
    if (hostId === null || path === null) return true;
    const controller = new AbortController();
    request.current = controller;
    setIsChecking(true);
    setIsMissing(false);
    try {
      await sdk.hosts.directory({ hostId, path, signal: controller.signal });
    } catch (error) {
      if (
        !controller.signal.aborted &&
        error instanceof BbHttpError &&
        error.code === "ENOENT"
      ) {
        setIsMissing(true);
        return false;
      }
    } finally {
      if (request.current === controller) {
        request.current = null;
        setIsChecking(false);
      }
    }
    return !controller.signal.aborted;
  };

  return { check, isChecking, isMissing };
}

export function missingProjectFolderMessage(hostName: string | null): string {
  return `This folder isn't on ${hostName || "this machine"}. It may have been moved or deleted.`;
}
