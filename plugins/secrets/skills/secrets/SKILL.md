---
name: secrets
description: Securely request API keys, access tokens, passwords, webhook secrets, or other credentials from the user and write them to a workspace dotenv file without exposing their values to the agent.
---

# Request workspace secrets securely

Use `bb secret request` whenever work needs a credential. Do not ask the user to paste a secret into chat.

Batch every currently known variable into one request. Inspect documentation or `.env.example` to identify variable names, but do not read or print an existing secret-bearing env file.

```bash
bb secret request OPENAI_API_KEY RESEND_API_KEY \
  --purpose "Configure application credentials" \
  --describe OPENAI_API_KEY "OpenAI API key used by the server" \
  --describe RESEND_API_KEY "Resend API key used for transactional email" \
  --write-env .env.local
```

Always provide the exact `--write-env` destination, a concise purpose, and one short plain-language description per variable. Never place secret values in argv, prompts, comments, logs, or follow-up messages.

After success, trust the command's path and added/updated/unchanged counts. Never verify by running `cat`, `sed`, `env`, or another command that would reveal the completed file.

If the command reports duplicate dotenv assignments, fix the file structure without reading values and rerun the request. If it reports repeated write conflicts, rerun the same request; do not ask the user to paste values. Plugin CLI commands may require workspace-write or full permission when a readonly sandbox blocks loopback access.
