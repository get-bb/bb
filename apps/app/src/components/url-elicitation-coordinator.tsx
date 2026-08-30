import { useEffect } from "react";
import { appToast } from "@/components/ui/app-toast";
import { useOpenUrlByPreference } from "@/lib/url-open-routing";
import { wsManager } from "@/lib/ws";

export function UrlElicitationCoordinator() {
  const openUrl = useOpenUrlByPreference();

  useEffect(
    () =>
      wsManager.onUrlElicitation((signal) => {
        let settled = false;
        const respond = (action: "accept" | "decline" | "cancel") => {
          if (settled) {
            return;
          }
          settled = true;
          wsManager.respondToUrlElicitation(signal.elicitationId, action);
        };
        appToast.message("Authorization required", {
          description: signal.message,
          duration: Infinity,
          action: {
            label: "Open",
            onClick: () => {
              respond(openUrl(signal.url) ? "accept" : "cancel");
            },
          },
          cancel: {
            label: "Cancel",
            onClick: () => respond("decline"),
          },
          onDismiss: () => respond("cancel"),
        });
      }),
    [openUrl],
  );

  return null;
}
