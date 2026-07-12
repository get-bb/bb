#!/bin/sh

set -eu

usage() {
  cat >&2 <<'EOF'
Usage: install.sh --join-code <code> --host-id <host-id> --server <url> [--machine-code <code>]

The first three options are required. --machine-code is required through bb connect.
EOF
  exit 2
}

join_code=
host_id=
server_url=
machine_code=

while [ "$#" -gt 0 ]; do
  case "$1" in
    --join-code|--host-id|--server|--machine-code)
      [ "$#" -ge 2 ] || usage
      [ -n "$2" ] || usage
      case "$1" in
        --join-code) join_code=$2 ;;
        --host-id) host_id=$2 ;;
        --server) server_url=$2 ;;
        --machine-code) machine_code=$2 ;;
      esac
      shift 2
      ;;
    -h|--help) usage ;;
    *)
      echo "Unknown option: $1" >&2
      usage
      ;;
  esac
done

[ -n "$join_code" ] || usage
[ -n "$host_id" ] || usage
[ -n "$server_url" ] || usage

case "$(uname -s)" in
  Darwin) platform=darwin ;;
  Linux) platform=linux ;;
  *)
    echo "bb machine installation supports macOS and Linux only." >&2
    exit 1
    ;;
esac

if ! command -v node >/dev/null 2>&1; then
  echo "bb-app requires Node.js 20.19 or newer (Node.js 22 LTS is recommended), but node is not on PATH." >&2
  exit 1
fi
node_version=$(node -p 'process.versions.node')
node_supported=$(node -e '
  const [major, minor] = process.versions.node.split(".").map(Number);
  process.exit(major > 20 || (major === 20 && minor >= 19) ? 0 : 1);
' && echo yes || echo no)
if [ "$node_supported" != yes ]; then
  echo "Node.js $node_version is too old; bb-app requires Node.js 20.19 or newer (Node.js 22 LTS is recommended)." >&2
  exit 1
fi
node_bin=$(command -v node)

require_npm() {
  if ! command -v npm >/dev/null 2>&1; then
    echo "bb-app installation requires npm." >&2
    exit 1
  fi
}

server_host=$(node -e '
  const url = new URL(process.argv[1]);
  process.stdout.write(url.host.replace(/[^a-zA-Z0-9.-]/gu, "-"));
' "$server_url") || {
  echo "Could not parse the server URL $server_url." >&2
  exit 1
}
service_slug=$(printf '%s' "$server_host" | tr '.' '-')

# Each server gets its own data dir and daemon instance, so one machine can
# serve several bb servers and a full local bb install keeps ~/.bb to itself.
data_dir=${BB_DATA_DIR:-"$HOME/.bb-machines/$server_host"}
mkdir -p "$data_dir"
mkdir -p "$data_dir/logs"

# The server's own build is always installed when it offers one: version
# strings cannot distinguish unpublished builds, so an existing bb-app is
# trusted only when the server provides no package (404) or is unreachable.
package_url="${server_url%/}/install/bb-app.tgz"
package_dir=$(mktemp -d "${TMPDIR:-/tmp}/bb-app.XXXXXX")
package_file="$package_dir/bb-app.tgz"
package_status=$(curl -sS -L -o "$package_file" -w '%{http_code}' "$package_url" 2>/dev/null) || package_status=000

bb_app=
if [ "$package_status" -ge 200 ] && [ "$package_status" -lt 300 ]; then
  require_npm
  echo "Installing the server's bb-app build..."
  if ! npm install -g "$package_file"; then
    rm -rf "$package_dir"
    echo "Could not install bb-app globally. Fix npm global-install permissions, then rerun this command." >&2
    exit 1
  fi
elif command -v bb-app >/dev/null 2>&1; then
  bb_app=$(command -v bb-app)
  if [ "$package_status" = 404 ]; then
    echo "The server does not provide its bb-app package; using bb-app at $bb_app"
  else
    echo "Warning: could not download the server's bb-app package (HTTP $package_status); using bb-app at $bb_app" >&2
  fi
elif [ "$package_status" = 404 ]; then
  require_npm
  echo "The server does not provide its bb-app package; installing bb-app from the npm registry..."
  if ! npm install -g bb-app; then
    rm -rf "$package_dir"
    echo "Could not install bb-app globally. Fix npm global-install permissions, then rerun this command." >&2
    exit 1
  fi
else
  rm -rf "$package_dir"
  echo "Could not download the server's bb-app package from $package_url (HTTP $package_status)." >&2
  exit 1
fi
rm -rf "$package_dir"

if [ -z "$bb_app" ]; then
  if ! command -v bb-app >/dev/null 2>&1; then
    echo "npm installed bb-app, but its global bin directory is not on PATH." >&2
    echo "Add npm's global bin directory to PATH, then rerun this command." >&2
    exit 1
  fi
  bb_app=$(command -v bb-app)
fi

if [ -n "$machine_code" ]; then
  connect_apex=$(node -e '
    const url = new URL(process.argv[1]);
    const labels = url.hostname.split(".");
    if (labels.length < 3) process.exit(2);
    url.hostname = labels.slice(1).join(".");
    url.pathname = "/";
    url.search = "";
    url.hash = "";
    process.stdout.write(url.origin);
  ' "$server_url") || {
    echo "Could not derive the bb connect apex from $server_url." >&2
    exit 1
  }
  echo "Authorizing this machine with bb connect..."
  redeem_response=$(curl -fsS \
    -X POST \
    -H 'content-type: application/json' \
    --data "{\"code\":\"$machine_code\"}" \
    "$connect_apex/api/connect/redeem-machine") || {
    echo "Could not redeem the bb connect machine code." >&2
    exit 1
  }
  printf '%s' "$redeem_response" | node -e '
    let input = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => { input += chunk; });
    process.stdin.on("end", () => {
      const body = JSON.parse(input);
      if (typeof body.credential !== "string" || !body.credential.startsWith("bbcm_")) {
        process.exit(2);
      }
      if (typeof body.machineId !== "string" || body.machineId.length === 0) {
        process.exit(2);
      }
      const fs = require("node:fs");
      const path = require("node:path");
      const [dataDir, serverUrl] = process.argv.slice(1);
      const configPath = path.join(dataDir, "config.json");
      let config = {};
      try { config = JSON.parse(fs.readFileSync(configPath, "utf8")); }
      catch (error) { if (error.code !== "ENOENT") throw error; }
      config.serverUrl = serverUrl;
      config.machineCredential = body.credential;
      config.connectMachineId = body.machineId;
      const temporary = `${configPath}.${process.pid}.tmp`;
      fs.writeFileSync(temporary, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
      fs.renameSync(temporary, configPath);
    });
  ' "$data_dir" "$server_url" || {
    echo "The bb connect machine-code response was invalid." >&2
    exit 1
  }
fi

auth_matches_host() {
  node -e '
    const fs = require("node:fs");
    const [dataDir, expectedHost] = process.argv.slice(1);
    const auth = JSON.parse(fs.readFileSync(`${dataDir}/auth.json`, "utf8"));
    process.exit(auth.hostId === expectedHost ? 0 : 1);
  ' "$data_dir" "$host_id" 2>/dev/null
}

already_joined=no
if [ -f "$data_dir/auth.json" ]; then
  if ! auth_matches_host; then
    echo "$data_dir already holds credentials for a different host, not $host_id." >&2
    echo "If this machine was removed from the server, delete $data_dir and rerun this command." >&2
    exit 1
  fi
  if [ -f "$data_dir/config.json" ] && node -e '
    const fs = require("node:fs");
    const [dataDir, expectedServer] = process.argv.slice(1);
    const config = JSON.parse(fs.readFileSync(`${dataDir}/config.json`, "utf8"));
    const normalize = (value) => String(value).replace(/\/+$/, "");
    process.exit(normalize(config.serverUrl) === normalize(expectedServer) ? 0 : 1);
  ' "$data_dir" "$server_url" 2>/dev/null; then
    already_joined=yes
    echo "This machine is already joined to $server_url as $host_id."
  fi
fi

join_pid=
if [ "$already_joined" = no ]; then
  join_log="$data_dir/install-join.log"
  echo "Joining $server_url as $host_id..."
  BB_DATA_DIR="$data_dir" nohup "$bb_app" host-daemon join \
    --auto-update \
    --join-code "$join_code" \
    --host-id "$host_id" \
    --server-url "$server_url" >"$join_log" 2>&1 &
  join_pid=$!
  echo "$join_pid" >"$data_dir/install-daemon.pid"

  joined=no
  attempts=0
  while [ "$attempts" -lt 60 ]; do
    if [ -f "$data_dir/auth.json" ] && auth_matches_host; then
      joined=yes
      break
    fi
    if ! kill -0 "$join_pid" 2>/dev/null; then
      wait "$join_pid" || true
      echo "bb host daemon exited before enrollment completed. See $join_log" >&2
      exit 1
    fi
    attempts=$((attempts + 1))
    sleep 1
  done
  if [ "$joined" != yes ]; then
    kill "$join_pid" 2>/dev/null || true
    wait "$join_pid" 2>/dev/null || true
    echo "Timed out waiting for enrollment. See $join_log" >&2
    exit 1
  fi
  echo "Joined successfully."
fi

# Tests and source-development smoke runs can leave the enrolled daemon in the
# foreground-supervised process without modifying the user's service manager.
if [ "${BB_INSTALL_SKIP_SERVICE:-0}" = 1 ]; then
  if [ -n "$join_pid" ]; then
    echo "Service installation skipped; daemon PID $join_pid is still running."
  else
    echo "Service installation skipped."
  fi
  exit 0
fi

if [ -n "$join_pid" ]; then
  kill "$join_pid" 2>/dev/null || true
  wait "$join_pid" 2>/dev/null || true
fi
rm -f "$data_dir/install-daemon.pid"

xml_escape() {
  printf '%s' "$1" | sed \
    -e 's/&/\&amp;/g' \
    -e 's/</\&lt;/g' \
    -e 's/>/\&gt;/g' \
    -e 's/"/\&quot;/g' \
    -e "s/'/\\\&apos;/g"
}

systemd_escape() {
  printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' -e 's/%/%%/g'
}

if [ "$platform" = darwin ]; then
  service_dir="$HOME/Library/LaunchAgents"
  service_label="app.getbb.host-daemon.$service_slug"
  service_file="$service_dir/$service_label.plist"
  mkdir -p "$service_dir"
  escaped_node_bin=$(xml_escape "$node_bin")
  escaped_bb_app=$(xml_escape "$bb_app")
  escaped_server=$(xml_escape "$server_url")
  escaped_data_dir=$(xml_escape "$data_dir")
  cat >"$service_file" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$service_label</string>
  <key>ProgramArguments</key>
  <array>
    <string>$escaped_node_bin</string>
    <string>$escaped_bb_app</string>
    <string>host-daemon</string>
    <string>--auto-update</string>
    <string>--server-url</string>
    <string>$escaped_server</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict><key>BB_DATA_DIR</key><string>$escaped_data_dir</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$escaped_data_dir/logs/launchd.log</string>
  <key>StandardErrorPath</key><string>$escaped_data_dir/logs/launchd.log</string>
</dict>
</plist>
EOF
  launchctl bootout "gui/$(id -u)" "$service_file" >/dev/null 2>&1 || true
  launchctl bootstrap "gui/$(id -u)" "$service_file"
  launchctl kickstart -k "gui/$(id -u)/$service_label"
  echo "Installed and started launch agent: $service_file"
  echo "Uninstall: launchctl bootout gui/$(id -u) '$service_file' && rm '$service_file'"
else
  service_dir="$HOME/.config/systemd/user"
  service_name="bb-host-daemon-$service_slug"
  service_file="$service_dir/$service_name.service"
  mkdir -p "$service_dir"
  escaped_node_bin=$(systemd_escape "$node_bin")
  escaped_bb_app=$(systemd_escape "$bb_app")
  escaped_server=$(systemd_escape "$server_url")
  escaped_data_dir=$(systemd_escape "$data_dir")
  cat >"$service_file" <<EOF
[Unit]
Description=bb host daemon for $server_host
After=network-online.target
Wants=network-online.target

[Service]
ExecStart="$escaped_node_bin" "$escaped_bb_app" host-daemon --auto-update --server-url "$escaped_server"
Environment="BB_DATA_DIR=$escaped_data_dir"
Restart=always
RestartSec=2

[Install]
WantedBy=default.target
EOF
  systemctl --user daemon-reload
  systemctl --user enable --now "$service_name.service"
  echo "Installed and started systemd user service: $service_file"
  echo "It starts with your systemd user session."
  echo "Uninstall: systemctl --user disable --now $service_name.service && rm '$service_file' && systemctl --user daemon-reload"
fi
