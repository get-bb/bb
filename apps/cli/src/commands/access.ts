import { hostname } from "node:os";
import { BbHttpError, type AccessCredential } from "@bb/sdk";
import { createNodeDpopSigner, generateDpopPrivateJwk } from "@bb/sdk/node";
import { Command } from "commander";
import { action } from "../action.js";
import { createCliBbSdk } from "../client.js";
import { outputJson } from "../command-result.js";
import {
  forgetServerCredential,
  saveServerCredential,
  serverCredentialsPath,
  serverOrigin,
} from "../server-credentials.js";
import { openUrlInBrowser } from "../open-url.js";
import { resolveServerAuthorization } from "../server-auth.js";
import { columnWidths, printBorderlessTable } from "../table.js";

interface JsonOptions {
  json?: boolean;
}

interface PairOptions extends JsonOptions {
  url?: string;
  open?: boolean;
}

interface LoginOptions extends JsonOptions {
  code: string;
  label?: string;
}

function formatTime(ms: number): string {
  return new Date(ms).toLocaleString();
}

function pairingLink(origin: string, code: string): string {
  return `${new URL(origin).origin}/pair#code=${code}`;
}

async function signInWithPairingCode(
  serverUrl: string,
  code: string,
  label: string | undefined,
): Promise<{ server: string; credential: AccessCredential; storedIn: string }> {
  const privateJwk = generateDpopPrivateJwk();
  const result = await createCliBbSdk(serverUrl).experimental_access.pairDevice(
    {
      code,
      label: label ?? `bb CLI on ${hostname()}`,
      signer: createNodeDpopSigner(privateJwk),
    },
  );
  saveServerCredential(serverUrl, {
    privateJwk,
    accessToken: result.accessToken,
    accessTokenExpiresAt: result.accessTokenExpiresAt,
    credentialId: result.credential.id,
    label: result.credential.label,
  });
  return {
    server: serverOrigin(serverUrl),
    credential: result.credential,
    storedIn: serverCredentialsPath(),
  };
}

function describeRequireSignIn(requireSignIn: boolean): string {
  return requireSignIn
    ? "Sign-in is required: every browser, phone and computer other than the server machine signs in with a pairing code."
    : "Sign-in is not required: anyone who can reach this bb can use it without signing in.";
}

export function registerAccessCommands(
  program: Command,
  getUrl: () => string,
): void {
  const access = program
    .command("access")
    .description(
      "Sign other devices in to this bb, and list or sign out signed-in devices",
    );

  access
    .command("pair")
    .description(
      "Make a one-time code (10 minutes) that signs another browser, phone or CLI in to this bb",
    )
    .option(
      "--url <origin>",
      "Also print a sign-in link for this address (for example https://box.tail1234.ts.net)",
    )
    .option(
      "--open",
      "Open the sign-in link in this computer's browser (signs it in to BB_SERVER_URL, or --url)",
    )
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (opts: PairOptions) => {
        const pairing =
          await createCliBbSdk(getUrl()).experimental_access.createPairing();
        const linkOrigin = opts.url ?? (opts.open ? getUrl() : undefined);
        const link =
          linkOrigin === undefined
            ? null
            : pairingLink(linkOrigin, pairing.code);
        if (opts.open && link !== null) openUrlInBrowser(link);
        if (outputJson(opts, { ...pairing, link })) return;
        console.log(`Pairing code: ${pairing.code}`);
        console.log(`Expires: ${formatTime(pairing.expiresAt)}`);
        console.log(
          "Open bb on the other device and enter this code, or run `bb access login --code <code>` there.",
        );
        if (link !== null) console.log(`Sign-in link: ${link}`);
      }),
    );

  access
    .command("login")
    .description(
      "Sign this CLI in to the server at BB_SERVER_URL with a pairing code",
    )
    .requiredOption("--code <code>", "Pairing code from `bb access pair`")
    .option("--label <label>", "Name shown in the signed-in devices list")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (opts: LoginOptions) => {
        const summary = await signInWithPairingCode(
          getUrl(),
          opts.code,
          opts.label,
        );
        if (outputJson(opts, summary)) return;
        console.log(
          `Signed in to ${summary.server} as "${summary.credential.label}" (${summary.credential.id}).`,
        );
        console.log(`The sign-in is stored in ${summary.storedIn}.`);
      }),
    );

  access
    .command("logout")
    .description(
      "Sign this CLI out of the server at BB_SERVER_URL and forget its sign-in",
    )
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (opts: JsonOptions) => {
        const serverUrl = getUrl();
        const result = await createCliBbSdk(serverUrl)
          .experimental_access.signOut()
          .catch((error: unknown) => {
            if (error instanceof BbHttpError && error.status === 401) {
              return { signedOut: false };
            }
            throw error;
          });
        const forgotten = forgetServerCredential(serverUrl);
        if (outputJson(opts, { ...result, forgotten })) return;
        if (!result.signedOut && !forgotten) {
          console.log(
            `This CLI was not signed in to ${serverOrigin(serverUrl)}.`,
          );
          return;
        }
        console.log(`Signed out of ${serverOrigin(serverUrl)}.`);
      }),
    );

  access
    .command("status")
    .description("Show how this CLI is let in to the server at BB_SERVER_URL")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (opts: JsonOptions) => {
        const session =
          await createCliBbSdk(getUrl()).experimental_access.session();
        if (outputJson(opts, session)) return;
        const via =
          session.via === "local"
            ? "this computer runs the server"
            : session.via === "connect"
              ? "bb connect"
              : session.via === "credential"
                ? `signed-in device ${session.credentialId ?? ""}`.trim()
                : session.via === "machine"
                  ? "an enrolled machine's credential"
                  : session.via === "open"
                    ? "no sign-in needed, because this bb doesn't require one (`bb access require-sign-in on` changes that)"
                    : null;
        console.log(
          via === null
            ? session.problem === "credential_requires_https"
              ? "Not signed in: this sign-in was made over HTTPS and is not accepted over plain HTTP."
              : "Not signed in. Run `bb access pair` on the server machine, then `bb access login --code <code>` here."
            : `Signed in: ${via}.`,
        );
      }),
    );

  access
    .command("require-sign-in [state]")
    .description(
      "Show, or turn on or off, whether every device other than the server machine must sign in (on|off). Turning it on from a CLI that isn't signed in signs it in first",
    )
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (state: string | undefined, opts: JsonOptions) => {
        const serverUrl = getUrl();
        if (state === undefined) {
          const session =
            await createCliBbSdk(serverUrl).experimental_access.session();
          if (
            outputJson(opts, {
              server: serverOrigin(serverUrl),
              requireSignIn: session.requireSignIn,
            })
          )
            return;
          console.log(describeRequireSignIn(session.requireSignIn));
          return;
        }
        if (state !== "on" && state !== "off") {
          throw new Error(
            `Expected "on" or "off", got "${state}". Run \`bb access require-sign-in\` to see the current setting.`,
          );
        }
        const enabled = state === "on";
        const signedInThisCli =
          enabled && resolveServerAuthorization(serverUrl).kind === "none"
            ? await signInWithPairingCode(
                serverUrl,
                (
                  await createCliBbSdk(
                    serverUrl,
                  ).experimental_access.createPairing()
                ).code,
                undefined,
              )
            : null;
        const result = await createCliBbSdk(
          serverUrl,
        ).experimental_access.setRequireSignIn({ enabled });
        if (
          outputJson(opts, {
            server: serverOrigin(serverUrl),
            requireSignIn: result.requireSignIn,
            signedInThisCli: signedInThisCli?.credential ?? null,
          })
        )
          return;
        if (signedInThisCli !== null) {
          console.log(
            `Signed this CLI in as "${signedInThisCli.credential.label}" (${signedInThisCli.credential.id}) so it keeps working; the sign-in is stored in ${signedInThisCli.storedIn}.`,
          );
        }
        console.log(describeRequireSignIn(result.requireSignIn));
      }),
    );

  access
    .command("list")
    .description("List the devices signed in to this bb")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (opts: JsonOptions) => {
        const { credentials } =
          await createCliBbSdk(getUrl()).experimental_access.listCredentials();
        if (outputJson(opts, { credentials })) return;
        if (credentials.length === 0) {
          console.log(
            "No devices are signed in. The server machine never needs to sign in.",
          );
          return;
        }
        const rows = credentials.map((credential) => [
          credential.current
            ? `${credential.label} (this CLI)`
            : credential.label,
          credential.id,
          credential.kind,
          credential.origin,
          formatTime(credential.lastUsedAt),
        ]);
        printBorderlessTable(
          {
            head: ["Device", "ID", "Kind", "Signed in at", "Last used"],
            colWidths: columnWidths(rows, [6, 2, 4, 12, 9]),
            trimTrailingWhitespace: true,
          },
          rows,
        );
      }),
    );

  access
    .command("revoke <id>")
    .description("Sign a device out of this bb (see `bb access list`)")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (id: string, opts: JsonOptions) => {
        const result = await createCliBbSdk(
          getUrl(),
        ).experimental_access.revokeCredential({ id });
        if (outputJson(opts, { id, ...result })) return;
        console.log(`Signed ${id} out.`);
      }),
    );
}
