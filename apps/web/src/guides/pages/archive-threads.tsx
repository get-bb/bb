import { ProductShot } from "../guide-blocks";
import { withIntake } from "../prompt-intake";
import type { Guide } from "../guide-types";
import { meta } from "./archive-threads.meta";

export const guide: Guide = {
  ...meta,
  description:
    "Archive finished threads to clear their workspaces off your disk. Every conversation is kept. bb can also archive old threads for you and show what's using your storage.",
  heroTop: null,
  concept: (
    <ProductShot
      shot={{
        src: "/guides/archive-threads/archive-menu-final.png",
        alt: "The thread menu in bb with Archive available",
        width: 2048,
        height: 1280,
      }}
    />
  ),
  agentPrompt: withIntake(
    [{ label: "Inactive for", hint: "days with no activity before archiving" }],
    "Default: 30 days.\n\nHelp me archive threads I'm done with. Guide: https://getbb.app/guides/archive-threads\n\n1. List my threads with `bb thread list --json`. It returns a limited window, so use `bb thread count` for the total and say if the list doesn't cover every thread. Find threads with no activity (updatedAt) for more than the agreed number of days that aren't pinned and aren't archived. Show me the list with titles, projects and last activity.\n2. Before archiving any thread, check every thread that would be archived with it, including the threads under it and any thread set to archive with it. Skip that thread if any affected thread is pinned, recently active, running, or excluded by the checks below. If you can't verify the complete affected set, skip it and say why. Skip personal workspaces by default: their files are deleted on archive and can't be restored. For each affected thread in a worktree, check for unsaved work: `bb environment status <environment id> --json` shows uncommitted changes (workspace.workingTree.hasUncommittedChanges), and `git log @{u}..` in the worktree shows commits that aren't pushed. List threads with unsaved or unpushed work separately and skip them and every thread above them that would archive them. Treat a failed check or missing upstream as unknown, not safe. Recheck the complete affected set immediately before archiving.\n3. Show me the complete affected set and the exclusions. After I confirm that exact set, archive only the eligible roots with `bb thread archive <id>` (this also archives the threads under them).\n4. Tell me how many you archived and which you skipped and why.",
  ),
  requirement: null,
  steps: [
    {
      id: "step-1",
      title: "Archive threads you've finished",
      lead: "Archive a thread when its work is done. You keep the conversation, and its worktree comes off your disk.",
      body: (
        <>
          <h3>{"Before you start"}</h3>
          <ul>
            <li>
              <strong>{"Commit or push work you want to keep."}</strong>
              {
                " Archiving clears a thread's worktree after 5 minutes, and uncommitted changes in it can't be recovered."
              }
            </li>
          </ul>
          <ul>
            <li>
              {"Open the thread's menu and choose "}
              <strong>{"Archive"}</strong>
              {
                '. If it has threads under it, bb asks first: "Its N child threads will be archived too."'
              }
            </li>
            <li>
              {"Changed your mind? Choose "}
              <strong>{"Undo"}</strong>
              {
                ' on the "Thread archived" message. It shows for 10 seconds; after that, unarchive from '
              }
              <strong>{"Settings → Archived threads"}</strong>
              {"."}
            </li>
            <li>
              {"To find an archived thread later, open "}
              <strong>{"Settings → Archived threads"}</strong>
              {"."}
            </li>
          </ul>
          <p>
            <strong>
              {"Option: ask an agent to archive inactive threads."}
            </strong>
            {
              " Copy the prompt above into a thread. The agent checks every thread that would be archived, including the threads under each one, and skips personal workspaces by default. It checks for unsaved work and archives only the set you confirm."
            }
          </p>
          <h3>{"What archiving keeps, and what it clears"}</h3>
          <table>
            <tbody>
              <tr>
                <td>
                  <strong>{"Kept"}</strong>
                </td>
                <td>
                  {
                    "The whole conversation. You can open, search, and unarchive it any time."
                  }
                </td>
              </tr>
              <tr>
                <td>
                  <strong>{"Cleared 5 minutes after it stops"}</strong>
                </td>
                <td>
                  {
                    "A worktree the thread made (the separate copy of your project it worked in). When the last thread on it is archived and has stopped, bb waits 5 minutes, then stops every process inside it and deletes the folder, including installed packages and build output. The branch stays, so committed work survives."
                  }
                </td>
              </tr>
              <tr>
                <td>
                  <strong>{"Not touched"}</strong>
                </td>
                <td>
                  {"Your project folder, when the thread worked in "}
                  <strong>{"Project checkout"}</strong>
                  {"."}
                </td>
              </tr>
              <tr>
                <td>
                  <strong>{"Stopped after 30 seconds"}</strong>
                </td>
                <td>
                  {
                    "The thread's running turn and its terminals keep running for 30 seconds, then stop. Unarchive within that time to keep them running."
                  }
                </td>
              </tr>
            </tbody>
          </table>
          <p>
            {
              "If you change your mind within 5 minutes, unarchive the thread and nothing is cleared. After that, unarchive it and choose "
            }
            <strong>{"Restore workspace"}</strong>
            {" to rebuild the worktree on its branch."}
          </p>
        </>
      ),
      shot: {
        src: "/guides/archive-threads/archive-menu-final.png",
        alt: "The thread menu in bb with Archive available",
        width: 2048,
        height: 1280,
      },
      options: [],
    },
    {
      id: "step-2",
      title: "Let bb archive old threads for you (Experimental)",
      lead: "Storage & retention archives threads after a stretch with no activity, so your list stays short without you doing it. It's an experimental plugin, off by default.",
      body: (
        <>
          <ol>
            <li>
              {"Turn on "}
              <strong>{"Storage & retention"}</strong>
              {": in "}
              <strong>{"Settings → Installed plugins"}</strong>
              {", or ask an agent to turn it on."}
            </li>
            <li>{"Open it from the sidebar."}</li>
            <li>
              {"Under "}
              <strong>{"Automatic retention"}</strong>
              {", set "}
              <strong>{"Archive inactive threads"}</strong>
              {" to a period, such as 30 days. It starts at "}
              <strong>{"Never"}</strong>
              {", and checks hourly once set."}
            </li>
          </ol>
          <p>
            {
              "When Storage & retention is on, pinned threads are never archived or deleted. Threads that automations use are protected only if you pin them."
            }
          </p>
          <p>
            <strong>{"Option: delete archived threads after a while."}</strong>{" "}
            <strong>{"Delete archived threads"}</strong>
            {
              " removes them for good after the period you choose, conversation included. Leave it at "
            }
            <strong>{"Never"}</strong>
            {" if you want to keep every conversation."}
          </p>
        </>
      ),
      shot: {
        src: "/guides/archive-threads/automatic-retention-controls.png",
        alt: "Storage & retention in bb with Automatic retention and Archive inactive threads",
        width: 1320,
        height: 520,
      },
      options: [],
    },
    {
      id: "step-3",
      title: "See what's using your storage",
      lead: "Storage & retention shows how much space bb's files take on each machine, and offers cleanups.",
      body: (
        <>
          <ul>
            <li>
              <strong>{"Clear archived files"}</strong>
              {
                " removes files that archived threads saved. Their conversations and uploaded attachments are kept."
              }
            </li>
            <li>
              <strong>{"Delete large files"}</strong>
              {" removes files of 10 MB or more from archived threads."}
            </li>
            <li>
              <strong>{"Retry cleanup"}</strong>
              {" removes worktrees that should have been cleared but weren't."}
            </li>
            <li>
              <strong>{"Remove orphans"}</strong>
              {" removes storage left behind by threads that no longer exist."}
            </li>
          </ul>
          <p>
            {
              "Each of these deletes files for good, so read the list before you confirm."
            }
          </p>
          <h3>{"What bb does on its own"}</h3>
          <p>{"You don't have to set these up. bb:"}</p>
          <ul>
            <li>
              {
                "Removes a worktree 5 minutes after its last thread is archived, or right away when it's deleted. Project folders and worktrees you added from an existing folder are left alone."
              }
            </li>
            <li>
              {
                "Removes leftover files from threads and attachments that no longer exist, every minute."
              }
            </li>
            <li>
              {
                "After 7 days, cuts tool output longer than about 32,000 characters down to its first and last 2,000 characters."
              }
            </li>
            <li>
              {
                "Keeps only its most recent log files: a new one each day or at 10 MB, and the last 5."
              }
            </li>
            <li>
              {
                "Frees unused space in its database every hour. No data is deleted."
              }
            </li>
            <li>
              {
                "Stops agents that have been idle for about 30 minutes, to free memory."
              }
            </li>
          </ul>
        </>
      ),
      shot: {
        src: "/guides/archive-threads/storage-cleanup-final.png",
        alt: "Storage & retention in bb showing storage and cleanup controls",
        width: 1320,
        height: 608,
      },
      options: [],
    },
    {
      id: "step-4",
      title: "Keep a compressed copy of old conversations (optional)",
      lead: "If you want archived conversations out of bb but still on hand, a script can save each one to a compressed file.",
      body: (
        <>
          <p>
            {
              'Ask an agent: "Create a bb script automation that runs weekly and saves every thread archived more than 90 days ago to a compressed file in ~/bb-archive, one file per thread, using '
            }
            <code>{"bb thread log <id> --all --format json"}</code>
            {". Don't delete anything.\""}
          </p>
          <p>
            {
              "The files are a copy. bb's own database doesn't get smaller until a thread is deleted. Shrinking archived conversations inside bb, without losing them, is tracked in "
            }
            <a href="https://github.com/get-bb/bb/issues/5730">
              {"issue #5730"}
            </a>
            {"."}
          </p>
        </>
      ),
      shot: {
        src: "/guides/archive-threads/archive-prompt.png",
        alt: "A bb thread with a prompt to keep compressed copies of archived conversations",
        width: 2048,
        height: 1800,
      },
      options: [],
    },
  ],
  troubleshooting: [
    {
      question: "A worktree is still on disk after archiving.",
      answer: (
        <>
          <p>
            {
              "It's cleared 5 minutes after the last thread using it is archived and has stopped. If it's still there, use "
            }
            <strong>{"Retry cleanup"}</strong>
            {
              " in Storage & retention. Worktrees you added from an existing folder are left as they are."
            }
          </p>
        </>
      ),
    },
    {
      question: "You need files back from an archived thread.",
      answer: (
        <>
          <p>
            {"Unarchive it, then choose "}
            <strong>{"Restore workspace"}</strong>
            {
              ". bb rebuilds the worktree on its branch. Uncommitted changes from before can't be restored."
            }
          </p>
        </>
      ),
    },
    {
      question: "A thread in a personal workspace lost its files.",
      answer: (
        <>
          <p>
            {
              "Personal workspaces are cleared on archive and can't be restored. Save files you need into a project first."
            }
          </p>
        </>
      ),
    },
  ],
  faq: [
    {
      question: "Does archiving delete my conversation?",
      answer: (
        <>
          <p>{"No. Only deleting does."}</p>
        </>
      ),
    },
    {
      question: "Does archiving make bb's database smaller?",
      answer: (
        <>
          <p>
            {
              "No. It clears worktrees from your disk, but conversations stay in the database. (bb's hourly cleanup only frees space that's already unused.) "
            }
            <a href="https://github.com/get-bb/bb/issues/5730">
              {"Issue #5730"}
            </a>
            {" tracks shrinking archived conversations."}
          </p>
        </>
      ),
    },
    {
      question: "Does it free memory?",
      answer: (
        <>
          <p>
            {
              "Archiving stops the thread's running turn, its terminals, and anything running in its worktree. bb also stops agents that have been idle for about 30 minutes."
            }
          </p>
        </>
      ),
    },
  ],
  closer: {
    title: "Finish threads, keep conversations.",
    body: "Archive when the work's done, let bb archive the rest, and check your storage now and then.",
  },
};
