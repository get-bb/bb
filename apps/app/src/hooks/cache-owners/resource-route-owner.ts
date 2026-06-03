import { useCallback } from "react";
import { useSetAtom } from "jotai";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import type {
  ChangedMessage,
  EnvironmentChangedMessage,
  ProjectChangedMessage,
  ThreadChangedMessage,
} from "@bb/domain";
import {
  destroyPersistedBrowserViewsForEnvironment,
  destroyPersistedBrowserViewsForThread,
} from "@/components/secondary-panel/browserViewVisibilityCoordinator";
import { collapsedProjectIdsAtom } from "@/components/sidebar/sidebarCollapsedAtoms";
import { getRootComposeRoutePath } from "@/lib/app-route-paths";
import { getDesktopBrowserApi } from "@/lib/bb-desktop";
import { useSetRootComposeProjectId } from "@/lib/root-compose-selection";
import { useAppRoute } from "../useAppRoute";
import { getCachedThreadProjectId } from "./thread-detail-cache-owner";

export type DeletedResourceRouteChangeHandler = (
  message: ChangedMessage,
) => void;

function isDeletedProjectMessage(
  message: ChangedMessage,
): message is ProjectChangedMessage & { id: string } {
  return (
    message.entity === "project" &&
    message.id !== undefined &&
    message.changes.includes("project-deleted")
  );
}

function isDeletedThreadMessage(
  message: ChangedMessage,
): message is ThreadChangedMessage & { id: string } {
  return (
    message.entity === "thread" &&
    message.id !== undefined &&
    message.changes.includes("thread-deleted")
  );
}

function isDeletedEnvironmentMessage(
  message: ChangedMessage,
): message is EnvironmentChangedMessage & { id: string } {
  return (
    message.entity === "environment" &&
    message.id !== undefined &&
    message.changes.includes("environment-deleted")
  );
}

export function useDeletedResourceRouteOwner(): DeletedResourceRouteChangeHandler {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const setCollapsedProjectIdList = useSetAtom(collapsedProjectIdsAtom);
  const setRootComposeProjectId = useSetRootComposeProjectId();
  const { projectId: routeProjectId, threadId: routeThreadId } = useAppRoute();

  return useCallback(
    (message: ChangedMessage) => {
      if (isDeletedProjectMessage(message)) {
        const deletedProjectId = message.id;
        setCollapsedProjectIdList((current) =>
          current.filter((projectId) => projectId !== deletedProjectId),
        );
        if (routeProjectId === deletedProjectId) {
          navigate(getRootComposeRoutePath(), { replace: true });
        }
        return;
      }

      if (!isDeletedThreadMessage(message)) {
        if (isDeletedEnvironmentMessage(message)) {
          destroyPersistedBrowserViewsForEnvironment({
            desktopBrowser: getDesktopBrowserApi(),
            environmentId: message.id,
          });
        }
        return;
      }
      const deletedThreadId = message.id;
      destroyPersistedBrowserViewsForThread({
        desktopBrowser: getDesktopBrowserApi(),
        threadId: deletedThreadId,
      });
      if (routeThreadId !== deletedThreadId) {
        return;
      }

      const projectId = getCachedThreadProjectId({
        queryClient,
        threadId: deletedThreadId,
      });
      if (projectId) {
        setRootComposeProjectId(projectId);
      }
      navigate(getRootComposeRoutePath());
    },
    [
      navigate,
      queryClient,
      routeProjectId,
      routeThreadId,
      setCollapsedProjectIdList,
      setRootComposeProjectId,
    ],
  );
}
