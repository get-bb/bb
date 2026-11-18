import {
  createDescendantPipe,
  createProcessLifeline,
  trackChildProcesses,
  type ChildProcessTracker,
  type DescendantPipe,
  type LifelineHolder,
  type ProcessLifeline,
} from "@bb/test-helpers/child-processes";

/**
 * Every `ChildProcess` spawned anywhere in this process (Node's
 * `child_process` diagnostics channel) after tracking starts. `children` lists
 * them in spawn order; `running()` excludes those with an exit code or signal;
 * `waitForExit()` resolves once all have exited, including any spawned while
 * waiting; `waitForClose()` also waits for each child's stdio to close, which
 * an unread piped stream can delay indefinitely; `killRunning()` signals the ones still running (SIGKILL by default);
 * `dispose()` stops recording.
 */
export type ExperimentalChildProcessTracker = ChildProcessTracker;

/**
 * A process connected to a lifeline. `pid` is the PID it reported, `label` the
 * label passed to `holdSource`. `exited` resolves and `alive()` turns false when
 * its connection closes, which the operating system does when it exits.
 * `kill(signal)` sends a signal (SIGKILL by default) only while the connection
 * is open, so a recycled PID is never signalled; it returns whether it sent.
 */
export type ExperimentalLifelineHolder = LifelineHolder;

/**
 * A local socket (a named pipe on Windows), at `path`, that processes the test
 * did not spawn itself connect to. `holdSource(label, onHeld?)` is a JavaScript
 * statement, with the path embedded, that connects the Node process running it;
 * embed it in a descendant's script. The optional `onHeld` statement runs once
 * the lifeline has registered the holder, for a script that blocks next.
 * `holders` lists connected processes in connection order, and
 * `waitForHolders(count)` resolves once that many have connected. `close()`
 * kills holders still connected, waits for them to exit, and removes the
 * socket.
 */
export type ExperimentalProcessLifeline = ProcessLifeline;

/**
 * Starts recording the child processes this process spawns, so a test can
 * assert that a process exited from its `ChildProcess` state instead of probing
 * a PID the operating system may have reused. Experimental: see
 * docs/api_to_audit.md.
 */
export function experimental_trackChildProcesses(): ExperimentalChildProcessTracker {
  return trackChildProcesses();
}

/**
 * Creates a lifeline for observing descendants and other processes the test
 * did not spawn, by the lifetime of a connection they hold rather than by PID.
 * Experimental: see docs/api_to_audit.md.
 */
export function experimental_createProcessLifeline(): Promise<ExperimentalProcessLifeline> {
  return createProcessLifeline();
}

/**
 * A POSIX named pipe at `path` for shell descendants that cannot run Node:
 * redirect one into it (`sleep 60 > "$pipe" &`). `opened` resolves once a
 * descendant has opened it for writing, and `closed` once every process holding
 * it has exited. `dispose()` releases a reader no descendant opened and removes
 * the pipe.
 */
export type ExperimentalDescendantPipe = DescendantPipe;

/**
 * Creates a named pipe that observes shell descendants by the lifetime of the
 * write end they inherit, with no startup cost of its own. POSIX only; it
 * throws on Windows. Experimental: see docs/api_to_audit.md.
 */
export function experimental_createDescendantPipe(): Promise<ExperimentalDescendantPipe> {
  return createDescendantPipe();
}
