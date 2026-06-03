import { Check, Send } from "lucide-react";
import type { HeaderProps } from "../types";

function notifyLabel(operationStatus: HeaderProps["operationStatus"]): string {
  if (operationStatus === "sending") {
    return "Sending…";
  }
  if (operationStatus === "sent") {
    return "Sent";
  }
  return "Notify manager";
}

export function Header(props: HeaderProps) {
  const notifyDisabled = props.operationStatus === "sending";

  return (
    <header className="app-header">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true">
          <Check size={16} strokeWidth={3} />
        </span>
        <div className="brand-copy">
          <h1>Todo</h1>
          <p title={props.appId}>{props.appId}</p>
        </div>
      </div>
      <div className="header-actions">
        <button
          className="secondary-button"
          type="button"
          disabled={notifyDisabled}
          onClick={() => {
            void props.onNotifyManager();
          }}
        >
          <Send size={14} strokeWidth={2} aria-hidden="true" />
          <span>{notifyLabel(props.operationStatus)}</span>
        </button>
      </div>
    </header>
  );
}
