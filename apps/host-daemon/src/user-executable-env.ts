/**
 * Process options for tools the user expects BB to resolve like their shell
 * does. OS/service utilities deliberately do not use this policy, so a user
 * login-shell PATH cannot shadow commands such as `scutil` or `osascript`.
 */
export function userExecutableProcessOptions(shellEnv: NodeJS.ProcessEnv): {
  shellPath?: string;
} {
  const shellPath = shellEnv.PATH;
  return shellPath === undefined ? {} : { shellPath };
}
