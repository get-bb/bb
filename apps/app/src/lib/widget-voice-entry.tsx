import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

export function consumeWidgetVoiceSearch(search: string): {
  shouldOpenVoiceReady: boolean;
  search: string;
} {
  const params = new URLSearchParams(search);
  const shouldOpenVoiceReady = params.get("widgetVoice") === "1";
  if (!shouldOpenVoiceReady) return { shouldOpenVoiceReady, search };
  params.delete("widgetVoice");
  const nextSearch = params.toString();
  return {
    shouldOpenVoiceReady,
    search: nextSearch ? `?${nextSearch}` : "",
  };
}

export function useWidgetVoiceEntry(): boolean {
  const location = useLocation();
  const navigate = useNavigate();
  const [voiceReadyPath, setVoiceReadyPath] = useState<string | null>(null);

  useEffect(() => {
    const consumed = consumeWidgetVoiceSearch(location.search);
    if (!consumed.shouldOpenVoiceReady) {
      setVoiceReadyPath((path) => (path === location.pathname ? path : null));
      return;
    }

    setVoiceReadyPath(location.pathname);
    void navigate(`${location.pathname}${consumed.search}${location.hash}`, {
      replace: true,
      state: location.state,
    });
  }, [
    location.hash,
    location.pathname,
    location.search,
    location.state,
    navigate,
  ]);

  return voiceReadyPath === location.pathname;
}
