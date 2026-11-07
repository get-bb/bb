import { useSyncExternalStore } from "react";
import { defineSplit } from "@/lib/define-split";
import {
  getApplicationUrlConfirmation,
  subscribeApplicationUrlConfirmation,
} from "@/lib/application-url";

const ApplicationUrlDialogSplit = defineSplit<{ open: boolean }>({
  id: "application-url-dialog",
  tier: "intent",
  load: () =>
    import("./ApplicationUrlDialogView").then(
      (module) => module.ApplicationUrlDialogView,
    ),
  loading: () => null,
  mountWhen: ({ open }) => open,
  keepMounted: true,
});

export function ApplicationUrlDialog() {
  const confirmation = useSyncExternalStore(
    subscribeApplicationUrlConfirmation,
    getApplicationUrlConfirmation,
  );
  return <ApplicationUrlDialogSplit open={confirmation !== null} />;
}
