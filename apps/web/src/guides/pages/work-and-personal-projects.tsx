import { ProductShot, PromptBlock, Substeps } from "../guide-blocks";
import { withIntake } from "../prompt-intake";
import type { Guide, GuideShot } from "../guide-types";
import { meta } from "./work-and-personal-projects.meta";

const shot = (name: string, alt: string): GuideShot => ({
  src: `/guides/work-and-personal-projects/${name}.png`,
  alt,
  width: 2048,
  height: 1280,
});

const WORK_PROJECTS = shot(
  "work-projects",
  "The Projects settings in a separate bb instance, showing only the Work project",
);

const AGENT_PROMPT = withIntake(
  [
    { label: "Computer", hint: "the computer that will run both instances" },
    {
      label: "Projects",
      hint: "the work folders and personal folders to add; leave existing bb data untouched",
    },
    {
      label: "Switching",
      hint: "use two local browser tabs; remote registration and the signed-in server switcher are outside this setup",
    },
  ],
  `Set up two bb instances with separate work and personal project lists and threads. This setup organizes project records only. Provider-account separation has not been verified by this guide. Do not sign in to providers, import credentials, or start agent turns in the new instances.
Guide: https://getbb.app/guides/work-and-personal-projects

This is a two-instance setup, not built-in profiles or a security boundary. Both instances still have the OS user's file and tool access. Do not claim provider credentials are isolated. Keep the new Codex homes and account pools empty; account sign-in and routing verification are a separate follow-up. Never inspect, print, copy, or import my existing credentials. Stop if company policy requires stronger isolation.

1. Read the current bb Startup Flags documentation, the account-pool skill's accounts-and-routing.md, and the server-switcher skill. Check the installed launcher help for --data-dir, --server-port, and --host-daemon-port. Inspect occupied ports and existing instance paths without reading credentials. Propose two NEW persistent data directories, two separate Codex homes, and four unused ports. Do not copy an existing data directory or overwrite an existing config.
Check: the paths and ports are distinct, and neither instance uses my existing bb data or ~/.codex directory.

2. Create owner-only directories for each instance and its Codex home. In each new Codex home's config.toml, set cli_auth_credentials_store = "file" so fallback credentials have an explicit location. Explain that any auth.json created there contains access tokens and must stay private. Keep those files out of Git.
Launch each instance with its own CODEX_HOME and explicit --data-dir, --server-port and --host-daemon-port values, in a persistent terminal. The server AND its host daemon must get the matching environment. Start from a sanitized environment: remove inherited bb thread/server/host targeting, BB_ACCOUNT_POOL_PARENT_URL, BB_ACCOUNT_POOL_PARENT_TOKEN, CODEX_OPENAI_BASE_URL, CODEX_POOL_AUTH_TOKEN, OPENAI_BASE_URL, OPENAI_API_KEY and other provider auth overrides. Do not log their values. Do not change HOME. Bind to loopback; do not expose an unauthenticated server.
Check: both local URLs return the app, each server reports its intended data directory, and each host uses its intended CODEX_HOME. With those homes and no inherited auth overrides, run codex login status; both must report not logged in before any sign-in. A different result is a stop, not permission to reuse the account.

3. For every bb command, explicitly target the intended server and clear inherited BB_CLI, BB_THREAD_ID, BB_PROJECT_ID, BB_ENVIRONMENT_ID and host targeting. Verify the target before any mutation. On EACH new server, run bb plugin enable account-pool, bb pool parent isolate, and bb pool routing codex. Read bb pool parent, bb pool config and bb pool status --json.
Check: parentMode is isolate on both. No parent is serving either pool. If a parent is detected, verify its routing is neutralized before starting an agent. Do not disable or bypass Account Pooler to get around a failure.

4. Add only the approved folders to each instance. Check bb project create --help before creating anything. Do not move files or change Git/SSH credentials. Keep both account pools and native Codex homes empty. Do not sign in, import accounts or start test threads.
Check: each project list contains only its intended projects. Record account attribution, unavailable-credential behavior, refresh and signed-in parent routing as unverified; do not mark credential separation complete.

5. Keep the two local URLs available in separate browser tabs. Open work → personal → work and check the destination and project list each time. Do not register either server for remote access or configure the signed-in Server Switcher as part of this setup.
Check: each local link reaches the intended instance. State that account routing remains unverified; navigating to the right project list does not prove credential separation.

If any step fails, stop and report the command, redacted error, and next action. Do not push, publish, migrate existing data or send messages. Stop only the PIDs you recorded for this setup, never processes by name.
Reply with the two clickable local URLs, data and Codex-home paths, terminal IDs and restart instructions, project-list and local-tab results, the shared-OS limitations, and the account checks that remain unverified. State that these instances are for project organization only until a separate account-routing check passes.`,
);

export const guide: Guide = {
  ...meta,
  description:
    "Give work and side projects their own project lists and conversations. Ask an agent to set up two bb instances, then open the one you need. Provider-account separation is not verified by this guide.",
  heroTop: null,
  concept: (
    <div>
      <ProductShot shot={WORK_PROJECTS} />
    </div>
  ),
  agentPrompt: AGENT_PROMPT,
  requirement:
    "a computer that can run both instances and permission to organize the chosen project folders",
  steps: [
    {
      id: "step-1",
      title: "Ask your agent to set up two instances",
      lead: "You describe what belongs to work and what belongs to you. Your agent handles the setup.",
      body: (
        <>
          <p>
            Choose <strong>Copy for agent</strong> above and paste it into a bb
            thread. Your agent asks about your computer and project folders
            before creating anything.
          </p>
          <PromptBlock
            name="Ask your agent"
            prompt="Keep my work and personal project lists in separate bb instances. Leave my current setup alone. Ask which folders belong in each one. Do not sign in or start agent turns in the new instances; account separation needs a separate check."
          />
          <p>
            This creates two bb instances, not built-in profiles. Separate bb
            data directories keep their project records, threads, and server
            settings apart. Provider logins need separate configuration too.
          </p>
        </>
      ),
      shot: WORK_PROJECTS,
      options: [],
    },
    {
      id: "step-2",
      title: "Keep account setup separate",
      lead: "This account setup still needs an end-to-end check. For now, use these instances only to organize projects, not to separate work and personal credentials.",
      body: (
        <>
          <Substeps>
            <li>Open each local link your agent gives you.</li>
            <li>
              Open <strong>Settings → Account Pooler [Experimental]</strong>
              and check that no accounts have been added.
            </li>
            <li>
              Keep provider sign-in and agent turns out of this setup. Account
              routing needs its own verification before you use either instance
              for agent work.
            </li>
          </Substeps>
          <p>
            Separate project lists do not prove that your accounts are separate.
            Do not use this setup for work until a test turn confirms the
            intended account and the check with unavailable credentials passes.
          </p>
          <p>
            Account Pooler selects accounts by availability; it does not assign
            accounts to projects. Putting both accounts in one pool would not
            keep work tied to one account. An empty or bypassed pool can fall
            back to the machine's provider credentials, which is why the setup
            prompt also separates the native Codex configuration and checks
            inherited routing.
          </p>
        </>
      ),
      shot: shot(
        "account-pool",
        "Account Pooler settings in the fresh work instance, with Sign in to Codex and no accounts added yet",
      ),
      options: [],
    },
    {
      id: "step-3",
      title: "Switch with your two local links",
      lead: "Keep a work tab and a personal tab open, and check which one you are using.",
      body: (
        <>
          <Substeps>
            <li>
              Keep the work and personal links in separate browser tabs. Check
              the destination before starting a thread.
            </li>
            <li>
              Open <strong>Settings → Projects</strong> in each tab and confirm
              that it shows the intended project list.
            </li>
            <li>
              Switch back to the work tab and check its address and projects
              again before sending a request.
            </li>
          </Substeps>
          <p>
            This guide uses local browser tabs. Remote registration and the
            signed-in Server Switcher flow are separate setup tasks.
          </p>
        </>
      ),
      shot: WORK_PROJECTS,
      options: [],
    },
    {
      id: "step-4",
      title: "Check your project lists",
      lead: "Confirm each local link opens the project list you intended.",
      body: (
        <>
          <Substeps>
            <li>
              Open <strong>Settings → Projects</strong>. The work instance
              should list your work projects; the personal instance should list
              your personal projects.
            </li>
            <li>
              Leave accounts unconfigured. Before starting agent work, a
              separate check must verify the intended account in each instance
              and what happens when its credentials are unavailable.
            </li>
            <li>
              Switch back and check again. Keep the local links and restart
              instructions your agent gives you.
            </li>
          </Substeps>
          <p>
            Both instances still run as the same OS user. They can reach the
            same files, Git and SSH credentials, and other shared tools. This
            setup does not enforce a security boundary. Ask your company which
            environment it permits for work.
          </p>
        </>
      ),
      shot: WORK_PROJECTS,
      options: [],
    },
  ],
  troubleshooting: [
    {
      question:
        "Both instances seem to use the same account. What should I check?",
      answer: (
        <p>
          Open Account Pooler in each instance and confirm that only the
          intended account is enabled. Ask your agent to check native Codex
          configuration, inherited provider variables, and parent-pool routing.
          A separate bb data directory alone does not separate provider
          credentials. Stop work until a test turn confirms the account used.
        </p>
      ),
    },
    {
      question:
        "The second instance was started by an agent in the first. Does that matter?",
      answer: (
        <p>
          Yes. Nested bb servers can inherit the parent's Account Pooler
          routing. The setup prompt asks your agent to remove that inheritance
          and set each new pool to isolate from its parent. The empty-pool setup
          was checked; signed-in routing has not been verified. Do not treat
          these settings as proof of account separation.
        </p>
      ),
    },
    {
      question: "Why doesn't the server switcher show my second instance?",
      answer: (
        <p>
          In a browser, Server Switcher lists the servers registered to your bb
          account, not every instance running on the computer. Ask your agent to
          check registration and sign-in, or open the instance's local link. In
          the desktop app, check its configured server list.
        </p>
      ),
    },
    {
      question:
        "An instance stops working after I close its terminal or restart the computer.",
      answer: (
        <p>
          Ask your agent to restart that instance using its recorded data
          directory, provider configuration, and ports. Keeping a tab open does
          not keep the server running. Ask for a persistent launch setup if you
          want it to start with the computer.
        </p>
      ),
    },
  ],
  faq: [
    {
      question: "Is this the same as browser profiles?",
      answer: (
        <p>
          No. This creates separate bb data directories, not built-in profiles
          or a security boundary. Provider-account separation is not verified by
          this guide.
        </p>
      ),
    },
    {
      question: "Which settings are separate?",
      answer: (
        <p>
          Each data directory has its own bb database, including projects,
          threads, and server settings, plus its plugin state. The setup also
          gives Codex separate native configuration directories. OS credentials,
          filesystem access, shared repository instructions, and other tools are
          not automatically separated.
        </p>
      ),
    },
    {
      question:
        "Can I put both accounts in one pool and assign one to each project?",
      answer: (
        <p>
          Account Pooler does not provide that project-to-account mapping. It
          chooses an eligible account according to priority and availability.
          The proposed setup uses one account per instance, but its sign-in and
          routing checks are not yet complete.
        </p>
      ),
    },
    {
      question: "Does this separate every agent provider?",
      answer: (
        <p>
          No. This guide organizes project records and leaves provider accounts
          unconfigured. Providers have their own credential stores and
          environment settings; verify those separately before using agents in
          either context.
        </p>
      ),
    },
    {
      question: "Will this move my existing projects or conversations?",
      answer: (
        <p>
          The setup prompt leaves existing bb data alone and creates two new
          instances. Adding a project points at a folder; it does not move its
          files. Moving existing conversations or data is a separate task.
        </p>
      ),
    },
    {
      question: "Do I need a bb account for two local instances?",
      answer: (
        <p>
          The local links let you open the instances directly. Browser-based
          Server Switcher uses your bb account's registered servers. That bb
          account is distinct from the ChatGPT accounts used by your agents.
        </p>
      ),
    },
  ],
  closer: {
    title: "Give each part of your day its own place",
    body: "Ask your agent to set up two project lists, then open the local link you need. Account setup is a separate follow-up.",
  },
};
