import type { HostDaemonSkillTreeManifest } from "@bb/host-daemon-contract";

export interface SkillTreeTransport {
  fetchManifest(treeHash: string): Promise<HostDaemonSkillTreeManifest>;
  fetchContent(
    treeHash: string,
    paths: readonly string[],
  ): Promise<AsyncIterable<Uint8Array>>;
}
