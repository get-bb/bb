import type {
  ThreadChangeKind,
  ThreadChangeMetadata,
  ProjectChangeKind,
  EnvironmentChangeKind,
  HostChangeKind,
  SystemChangeKind,
  WorkflowRunChangeKind,
} from "@bb/domain";

export interface DbNotifier {
  notifyThread(
    threadId: string,
    changes: ThreadChangeKind[],
    metadata?: ThreadChangeMetadata,
  ): void;
  notifyProject(projectId: string, changes: ProjectChangeKind[]): void;
  notifyEnvironment(
    environmentId: string,
    changes: EnvironmentChangeKind[],
  ): void;
  notifyHost(hostId: string, changes: HostChangeKind[]): void;
  notifySystem(changes: SystemChangeKind[]): void;
  notifyWorkflowRun(
    workflowRunId: string,
    changes: WorkflowRunChangeKind[],
  ): void;
}

export const noopNotifier: DbNotifier = {
  notifyThread() {},
  notifyProject() {},
  notifyEnvironment() {},
  notifyHost() {},
  notifySystem() {},
  notifyWorkflowRun() {},
};
