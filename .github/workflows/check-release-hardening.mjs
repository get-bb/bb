import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));

function readRepoFile(relativePath) {
  return readFileSync(resolve(repoRoot, relativePath), "utf8");
}

const failures = [];

function assert(condition, message) {
  if (!condition) {
    failures.push(message);
  }
}

function jobSection(workflow, jobName) {
  const start = workflow.indexOf(`\n  ${jobName}:\n`);
  if (start === -1) {
    return "";
  }

  const rest = workflow.slice(start + 1);
  const nextJob = rest.search(/\n  [A-Za-z0-9_-]+:\n/u);
  return nextJob === -1 ? rest : rest.slice(0, nextJob);
}

function assertGateBeforeCheckout(
  workflow,
  jobName,
  gateName,
  message,
  condition,
) {
  const section = jobSection(workflow, jobName);
  const gate = section.indexOf(`- name: ${gateName}`);
  const checkout = section.indexOf("- name: Checkout repository");

  assert(section.length > 0, `${message}: job is missing`);
  assert(
    gate !== -1 && gate < checkout,
    `${message}: gate must precede checkout`,
  );
  if (condition) {
    assert(section.includes(condition), `${message}: missing ${condition}`);
  }
}

const buildDesktop = readRepoFile(".github/workflows/build-desktop.yml");
for (const jobName of ["macos", "linux", "publish"]) {
  assertGateBeforeCheckout(
    buildDesktop,
    jobName,
    "Require main branch for stable publication",
    `build-desktop/${jobName}`,
    "inputs.publish == true",
  );
}
assert(
  jobSection(buildDesktop, "publish").includes(
    "if: ${{ inputs.publish == true && inputs.release_channel == 'stable' }}",
  ),
  "build-desktop/publish: QA runs must not receive publication permissions",
);
assert(
  buildDesktop.includes(
    "CSC_LINK: ${{ inputs.publish == true && inputs.release_channel == 'stable' && secrets.MACOS_CERTIFICATE_P12 || '' }}",
  ),
  "build-desktop: signing secrets must be withheld from QA packaging",
);
assert(
  buildDesktop.includes(
    "uses: actions/attest-build-provenance@e8998f949152b193b063cb0ec769d69d929409be # v2.4.0",
  ),
  "build-desktop: stable binaries need a pinned provenance action",
);
assert(
  jobSection(buildDesktop, "publish").includes("attestations: write"),
  "build-desktop/publish: artifact-attestation permission is required",
);
const stableDesktopPublish = jobSection(buildDesktop, "publish");
assert(
  stableDesktopPublish.includes("id: attest_linux") &&
    stableDesktopPublish.includes("subject-path: release/linux/*.AppImage"),
  "build-desktop/publish: Linux AppImage attestation must cover published assets",
);
assert(
  stableDesktopPublish.includes("id: attest_macos") &&
    stableDesktopPublish.includes(
      "steps.release_plan.outputs.publish_macos_binaries == 'true'",
    ),
  "build-desktop/publish: macOS attestation must be conditional on published assets",
);

for (const workflowName of [
  "deploy-connect.yml",
  "deploy-demo-server.yml",
  "deploy-web.yml",
]) {
  const workflow = readRepoFile(`.github/workflows/${workflowName}`);
  assertGateBeforeCheckout(
    workflow,
    "deploy",
    "Require main branch",
    workflowName,
    "github.ref != 'refs/heads/main'",
  );
}

const mobileEas = readRepoFile(".github/workflows/mobile-ios-eas.yml");
assertGateBeforeCheckout(
  mobileEas,
  "build",
  "Require main branch for TestFlight submission",
  "mobile-ios-eas/build",
  "inputs.submit == true",
);

const publish = readRepoFile(".github/workflows/publish-bb-app.yml");
for (const jobName of ["publish", "publish-nightly", "publish-plugin-sdk"]) {
  assertGateBeforeCheckout(
    publish,
    jobName,
    "Require main branch",
    `publish-bb-app/${jobName}`,
    "github.ref != 'refs/heads/main'",
  );
}
for (const jobName of [
  "nightly-desktop-macos",
  "nightly-desktop-linux",
  "nightly-desktop-publish",
]) {
  assertGateBeforeCheckout(
    publish,
    jobName,
    jobName === "nightly-desktop-publish"
      ? "Require main branch for manual nightly publication"
      : "Require main branch for manual nightly release",
    `publish-bb-app/${jobName}`,
    "github.event_name == 'workflow_dispatch'",
  );
}
assert(
  !publish.includes("npm@latest"),
  "publish-bb-app: npm@latest is forbidden",
);
assert(
  publish.match(/npm install --global npm@11\.6\.2/g)?.length === 3,
  "publish-bb-app: all three npm jobs must install npm 11.6.2",
);
assert(
  publish.includes(
    "uses: actions/attest-build-provenance@e8998f949152b193b063cb0ec769d69d929409be # v2.4.0",
  ),
  "publish-bb-app: nightly binaries need a pinned provenance action",
);
assert(
  jobSection(publish, "nightly-desktop-publish").includes(
    "attestations: write",
  ),
  "publish-bb-app/nightly-desktop-publish: artifact-attestation permission is required",
);

for (const workflowName of ["mobile-e2e.yml", "mobile-runner-probe.yml"]) {
  assert(
    !readRepoFile(`.github/workflows/${workflowName}`).includes(
      "Require main branch",
    ),
    `${workflowName}: QA workflow must remain branch-flexible`,
  );
}

const rootPackage = JSON.parse(readRepoFile("package.json"));
const overrides = rootPackage.pnpm?.overrides ?? {};
assert(
  overrides["@ungap/structured-clone"] === "1.3.4",
  "package.json: @ungap/structured-clone must be overridden to 1.3.4",
);
assert(
  overrides["@xmldom/xmldom@0.8.13"] === "0.8.15",
  "package.json: @xmldom/xmldom 0.8.x must be overridden to 0.8.15",
);
assert(
  overrides["@xmldom/xmldom@0.9.10"] === "0.9.12",
  "package.json: @xmldom/xmldom 0.9.x must be overridden to 0.9.12",
);

const lockfile = readRepoFile("pnpm-lock.yaml");
const resolvedPackages = lockfile.slice(lockfile.indexOf("\npackages:"));
for (const forbidden of [
  "@ungap/structured-clone@1.3.0",
  "@xmldom/xmldom@0.8.13",
  "@xmldom/xmldom@0.9.10",
  "Potential CWE-502 - Update to 1.3.1 or higher",
  "this version has critical issues, please update to the latest version",
]) {
  const source = forbidden.includes("CWE") ? lockfile : resolvedPackages;
  assert(!source.includes(forbidden), `pnpm-lock.yaml: stale ${forbidden}`);
}

if (failures.length > 0) {
  console.error(failures.map((failure) => `- ${failure}`).join("\n"));
  process.exit(1);
}

console.log("Release workflow and dependency hardening checks passed.");
