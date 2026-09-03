Get a notification on your phone when a thread needs you. This plugin sends a push message to the bb mobile app. It fires when an agent asks a question, finishes a turn, or stops on an error.

## What you get

- A push message when a thread waits for your input.
- A push message when a turn finishes and the thread is idle.
- A push message when a thread stops with an error.
- One message per thread when several events arrive close together. A pending question takes priority over the other kinds.

## How it works

The bb mobile app registers its device with the server. The plugin stores each device and sends messages through the Expo push service. Each message opens the thread in the app.

## Settings

- `Expo push relay URL`: the endpoint used for delivery. Change it only if you run your own relay.

## CLI

- `bb push-notifications list [--json]`: show registered devices.
- `bb push-notifications add --token <expo-push-token> --platform <ios|android> --label <device-label>`: register a device.
- `bb push-notifications remove <id>`: remove a device.
- `bb push-notifications status [--json]`: show the relay URL and the last send result.

## Requirements

- The bb mobile app on iOS or Android, signed in to this server.
- The server must reach the Expo push service over the network.
