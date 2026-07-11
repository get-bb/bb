import type { HostDaemonSkillTree } from "@bb/host-daemon-contract";

export type FetchSkillTree = (treeHash: string) => Promise<HostDaemonSkillTree>;
