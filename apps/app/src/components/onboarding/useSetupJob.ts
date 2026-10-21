import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { sdk } from "@/lib/sdk";
import { appToast } from "@/components/ui/app-toast";

export function useSetupJob() {
  const [timezone] = useState(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone,
  );
  const query = useQuery({
    queryKey: ["setup-recurring-job", timezone],
    queryFn: () => sdk.system.experimental_setupJob({ timezone }),
    staleTime: Infinity,
    retry: false,
  });
  const offer =
    query.data?.offer?.status === "offered" ? query.data.offer : null;
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const shownId = useRef<string | null>(null);
  useEffect(() => {
    if (offer === null || shownId.current === offer.suggestionAnalyticsId)
      return;
    shownId.current = offer.suggestionAnalyticsId;
    void Promise.all([
      sdk.system.exposeHoldout("app_setup_recurring_job"),
      sdk.system.experimental_setupJobShown(offer.suggestionAnalyticsId),
    ]).catch(() => {});
  }, [offer]);

  async function complete(onFinish: () => void, accepted = checked) {
    if (pending.current) return;
    if (offer === null) {
      onFinish();
      return;
    }
    pending.current = true;
    setBusy(true);
    try {
      await sdk.system.experimental_decideSetupJob({
        suggestionAnalyticsId: offer.suggestionAnalyticsId,
        accepted,
      });
      onFinish();
    } catch (error) {
      if (!accepted) onFinish();
      else
        appToast.error(
          error instanceof Error
            ? error.message
            : "Could not create the job. Try again or untick it to continue.",
        );
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return { offer, checked, setChecked, busy, complete };
}
