Reach this bb privately at `https://<machine>.<tailnet>.ts.net` through Tailscale Serve. Your tailnet is the access boundary: only devices on your tailnet that its access rules allow can reach the address, over WireGuard with a real TLS certificate.

## What you get

- **One-click setup.** Settings → Tailscale → **Set up** (or `bb tailscale setup`) runs `tailscale serve --bg --https=443 <bb's loopback address>` on the server's machine. When another service already uses port 443, bb uses its own port instead (for example `https://<machine>.<tailnet>.ts.net:38886`). It never replaces a Serve mapping it didn't create.
- **Adopts what you already have.** If you set up Tailscale Serve for bb by hand, the plugin finds that mapping and uses it as it is.
- **Status** in Settings and `bb tailscale status`: the address, your tailnet, whether the address answers over HTTPS, and what to fix when it doesn't (install or sign in to Tailscale, turn on MagicDNS or HTTPS certificates).
- **No `BB_APP_URL` needed.** Once Serve reaches bb, bb accepts the address as its own, so browsers on your tailnet can open it right away.
- **A machine access route.** Tailscale appears in Settings → Machines → How devices reach this server as a private route; new execution machines on the same tailnet enroll over it when it is the first working route in that order.
- `bb tailscale status`, `bb tailscale setup`, and `bb tailscale teardown`. Add `--json` for machine-readable output.

## How it works

The plugin runs the `tailscale` CLI by its absolute path (the Tailscale app on macOS, `/usr/bin/tailscale` on Linux, `C:\Program Files\Tailscale\tailscale.exe` on Windows) and reads `tailscale status --json` and `tailscale serve status --json` every 30 seconds. It changes Serve only when you set up or remove. It remembers the mapping it created, and **Remove** in Settings or `bb tailscale teardown` removes only that one. Stopping bb or disabling the plugin leaves the mapping in place; use **Remove** to turn it off. Mappings you made yourself are never changed.

## Requirements

Tailscale installed and signed in on the server's machine, with MagicDNS and HTTPS certificates turned on in your tailnet's DNS settings. On Linux, Serve changes need root or an operator: run `sudo tailscale set --operator=$USER` once. Devices that open the address must be on the same tailnet. Do not turn on Tailscale Funnel for bb: that makes it public on the internet.
