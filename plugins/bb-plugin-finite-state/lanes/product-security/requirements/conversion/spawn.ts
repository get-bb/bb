import { getStoredConversionBundle, type EarsConversionBundleMeta } from "./bundle.js";

export interface ConversionSpawnResult {
  bundle: EarsConversionBundleMeta;
  threadId: string;
  prompt: string;
}

export function buildConversionPrompt(meta: EarsConversionBundleMeta, paths: readonly string[]): string {
  const ids = meta.requirementIds.join(", ");
  const targets = paths.map((path) => `- ${path}`).join("\n");
  return `Convert the selected pulled requirements to authored EARS YAML proposals.

Selection: ${ids}
Bounded source bundle: ${meta.bundleId}
Read it only through the paged conversion-bundle service. Never request or paste an unbounded bundle.
Bundle snapshot: ${meta.snapshotDigest} (pulled ${meta.pulledAt})

Use semantic reasoning across all six supported patterns:
- ubiquitous: The <system> shall <response>.
- event_driven: When <trigger>, the <system> shall <response>.
- state_driven: While <state>, the <system> shall <response>.
- unwanted_behavior: If <trigger>, then the <system> shall <response>.
- optional_feature: Where <feature>, the <system> shall <response>.
- complex: use at least two ordered feature, precondition, state, or trigger conditions before the system response.

Mandatory grounding rules:
- Preserve each req_id as the YAML id and write only its exact target path.
- Copy the original description byte-for-byte into source_description.
- Copy every mapped check's pass_criteria and fail_criteria verbatim.
- Reference only existing check and trace slugs supplied by the bundle; use check: null when no check exists.
- Never invent ids, checks, links, evidence, review state, verification status, or any other derived/server-owned field.
- Preserve existing human-edited EARS when a rerun says that requirement's source contract did not change.
- Create local proposal files only. Do not push, sync, apply server state, invoke a push-capable tool, or claim human review.

Exact targets:
${targets}

After writing, report the paths for validation. Completion means a valid local proposal awaiting an explicit human diff review.`;
}

export async function spawnConversionThread(bundleId: string): Promise<ConversionSpawnResult> {
  const bundle = getStoredConversionBundle(bundleId);
  const paths = bundle.sources.map((source) => source.targetPath);
  const prompt = buildConversionPrompt(bundle.meta, paths);
  const spawned = await bundle.deps.spawnOriginPluginThread({
    projectId: bundle.meta.projectId,
    title: `EARS conversion · ${bundle.meta.requirementIds.length} requirements`,
    prompt,
  });
  return { bundle: bundle.meta, threadId: spawned.threadId, prompt };
}
