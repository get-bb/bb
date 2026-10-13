import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { RouteLoadingSkeleton } from "@/components/ui/route-loading-skeleton";
import {
  useRootComposePlacement,
  useSetRootComposeProjectId,
} from "@/lib/root-compose-selection";
import { getRootComposeRoutePath } from "@/lib/route-paths";
import { DEFAULT_THREAD_CREATION_PLACEMENT } from "@/lib/thread-creation-placement";

export function LegacyProjectComposeRedirect({
  projectId,
}: {
  projectId: string;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const setRootComposeProjectId = useSetRootComposeProjectId();
  const [, setPlacement] = useRootComposePlacement();

  useEffect(() => {
    setRootComposeProjectId(projectId);
    setPlacement(DEFAULT_THREAD_CREATION_PLACEMENT);
    navigate(getRootComposeRoutePath(), {
      replace: true,
      state: location.state,
    });
  }, [
    location.state,
    navigate,
    projectId,
    setRootComposeProjectId,
    setPlacement,
  ]);

  return <RouteLoadingSkeleton isBoundedPane={false} />;
}
