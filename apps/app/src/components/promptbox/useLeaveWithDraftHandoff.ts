import { useEffect, useRef, type RefObject } from "react";
import { promptDraftToInput, type PromptDraftState } from "@bb/client-core";
import type { NewThreadRequest } from "@get-bb/plugin-sdk";
import { useLatestRef } from "@/hooks/useLatestRef";

interface UseLeaveWithDraftHandoffArgs {
  buildRequest: (input: NewThreadRequest["input"]) => NewThreadRequest | null;
  getDraft: () => PromptDraftState;
  isSubmittingRef: RefObject<boolean>;
  onLeaveWithDraft:
    | ((request: NewThreadRequest, draft: PromptDraftState) => void)
    | undefined;
}

interface LeaveHandoffInputs {
  buildRequest: UseLeaveWithDraftHandoffArgs["buildRequest"];
  getDraft: UseLeaveWithDraftHandoffArgs["getDraft"];
  onLeaveWithDraft: UseLeaveWithDraftHandoffArgs["onLeaveWithDraft"];
}

export function useLeaveWithDraftHandoff({
  buildRequest,
  getDraft,
  isSubmittingRef,
  onLeaveWithDraft,
}: UseLeaveWithDraftHandoffArgs): void {
  const inputsRef = useLatestRef<LeaveHandoffInputs>({
    buildRequest,
    getDraft,
    onLeaveWithDraft,
  });
  const pendingHandoffRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const pendingHandoff = pendingHandoffRef;
    const latestInputs = inputsRef;
    const submitting = isSubmittingRef;
    if (pendingHandoff.current !== null) {
      clearTimeout(pendingHandoff.current);
      pendingHandoff.current = null;
    }
    return () => {
      const inputs = latestInputs.current;
      const leave = inputs.onLeaveWithDraft;
      if (leave === undefined || submitting.current) return;
      const draft = inputs.getDraft();
      const input = promptDraftToInput(draft);
      if (input.length === 0) return;
      const request = inputs.buildRequest(input);
      if (request === null) return;
      pendingHandoff.current = setTimeout(() => {
        pendingHandoff.current = null;
        leave(request, draft);
      }, 0);
    };
  }, [inputsRef, isSubmittingRef]);
}
