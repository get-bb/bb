import { hostname } from "node:os";
import { BbHttpError } from "@bb/sdk";
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
        const serverUrl = getUrl();
        const privateJwk = generateDpopPrivateJwk();
        const result = await createCliBbSdk(
          serverUrl,
        ).experimental_access.pairDevice({
          code: opts.code,
          label: opts.label ?? `bb CLI on ${hostname()}`,
          signer: createNodeDpopSigner(privateJwk),
        });
        saveServerCredential(serverUrl, {
          privateJwk,
          accessToken: result.accessToken,
          accessTokenExpiresAt: result.accessTokenExpiresAt,
          credentialId: result.credential.id,
          label: result.credential.label,
        });
        const summary = {
          server: serverOrigin(serverUrl),
          credential: result.credential,
          storedIn: serverCredentialsPath(),
        };
        if (outputJson(opts, summary)) return;
        console.log(
          `Signed in to ${summary.server} as "${result.credential.label}" (${result.credential.id}).`,
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
