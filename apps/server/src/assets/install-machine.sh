#!/bin/sh

set -eu

usage() {
  cat >&2 <<'EOF'
Usage: install.sh --join-code <code> --host-id <host-id> --server <url>

All three options are required.
EOF
  exit 2
}

join_code=
host_id=
server_url=

while [ "$#" -gt 0 ]; do
  case "$1" in
    --join-code|--host-id|--server)
      [ "$#" -ge 2 ] || usage
      [ -n "$2" ] || usage
      case "$1" in
        --join-code) join_code=$2 ;;
        --host-id) host_id=$2 ;;
        --server) server_url=$2 ;;
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

if command -v bb-app >/dev/null 2>&1; then
  bb_app=$(command -v bb-app)
  echo "Using bb-app at $bb_app"
else
  if ! command -v node >/dev/null 2>&1; then
    echo "bb-app installation requires Node.js 20.19 or newer (Node.js 22 LTS is recommended)." >&2
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
  if ! command -v npm >/dev/null 2>&1; then
    echo "bb-app installation requires npm." >&2
    exit 1
  fi
  echo "bb-app was not found; installing the published npm package globally..."
  if ! npm install -g bb-app; then
    echo "Could not install bb-app globally. Fix npm global-install permissions, then rerun this command." >&2
    exit 1
  fi
  if ! command -v bb-app >/dev/null 2>&1; then
    echo "npm installed bb-app, but its global bin directory is not on PATH." >&2
    echo "Add npm's global bin directory to PATH, then rerun this command." >&2
    exit 1
  fi
  bb_app=$(command -v bb-app)
fi

if ! command -v node >/dev/null 2>&1; then
  echo "bb-app requires Node.js, but node is not on PATH." >&2
  exit 1
fi
node_bin=$(command -v node)

data_dir=${BB_DATA_DIR:-"$HOME/.bb"}
mkdir -p "$data_dir"
mkdir -p "$data_dir/logs"

already_joined=no
if [ -f "$data_dir/auth.json" ] && [ -f "$data_dir/config.json" ]; then
  if node -e '
    const fs = require("node:fs");
    const [dataDir, expectedServer, expectedHost] = process.argv.slice(1);
    const auth = JSON.parse(fs.readFileSync(`${dataDir}/auth.json`, "utf8"));
    const config = JSON.parse(fs.readFileSync(`${dataDir}/config.json`, "utf8"));
    const normalize = (value) => String(value).replace(/\/+$/, "");
    process.exit(
      auth.hostId === expectedHost &&
      normalize(config.serverUrl) === normalize(expectedServer) ? 0 : 1
    );
  ' "$data_dir" "$server_url" "$host_id" 2>/dev/null; then
    already_joined=yes
    echo "This machine is already joined to $server_url as $host_id."
  fi
fi

join_pid=
if [ "$already_joined" = no ]; then
  join_log="$data_dir/install-join.log"
  echo "Joining $server_url as $host_id..."
  # Extension point for S10: pass --machine-credential here once the launcher
  # join contract accepts it. The server URL is already scheme-agnostic.
  BB_DATA_DIR="$data_dir" nohup "$bb_app" host-daemon join \
    --join-code "$join_code" \
    --host-id "$host_id" \
    --server-url "$server_url" >"$join_log" 2>&1 &
  join_pid=$!
  echo "$join_pid" >"$data_dir/install-daemon.pid"

  joined=no
  attempts=0
  while [ "$attempts" -lt 60 ]; do
    if [ -f "$data_dir/auth.json" ]; then
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
  service_file="$service_dir/app.getbb.host-daemon.plist"
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
  <key>Label</key><string>app.getbb.host-daemon</string>
  <key>ProgramArguments</key>
  <array>
    <string>$escaped_node_bin</string>
    <string>$escaped_bb_app</string>
    <string>host-daemon</string>
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
  launchctl kickstart -k "gui/$(id -u)/app.getbb.host-daemon"
  echo "Installed and started launch agent: $service_file"
  echo "Uninstall: launchctl bootout gui/$(id -u) '$service_file' && rm '$service_file'"
else
  service_dir="$HOME/.config/systemd/user"
  service_file="$service_dir/bb-host-daemon.service"
  mkdir -p "$service_dir"
  escaped_node_bin=$(systemd_escape "$node_bin")
  escaped_bb_app=$(systemd_escape "$bb_app")
  escaped_server=$(systemd_escape "$server_url")
  escaped_data_dir=$(systemd_escape "$data_dir")
  cat >"$service_file" <<EOF
[Unit]
Description=bb host daemon
After=network-online.target
Wants=network-online.target

[Service]
ExecStart="$escaped_node_bin" "$escaped_bb_app" host-daemon --server-url "$escaped_server"
Environment="BB_DATA_DIR=$escaped_data_dir"
Restart=always
RestartSec=2

[Install]
WantedBy=default.target
EOF
  systemctl --user daemon-reload
  systemctl --user enable --now bb-host-daemon.service
  echo "Installed and started systemd user service: $service_file"
  echo "It starts with your systemd user session."
  echo "Uninstall: systemctl --user disable --now bb-host-daemon.service && rm '$service_file' && systemctl --user daemon-reload"
fi
