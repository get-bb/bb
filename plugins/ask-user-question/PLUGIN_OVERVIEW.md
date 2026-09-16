Agents on providers without a native question tool can stop and ask you to choose. You answer in the thread, and the agent continues with your choice.

## What you get

- A question card in the thread with two to four options per question. Each option has a label and a description.
- Up to four questions in one card. A question can accept one answer or several answers.
- An "Other" field on every question for free-text input.
- An optional preview under an option, for example a code snippet or a layout mockup.

## How it works

The plugin gives agents an `AskUserQuestion` tool. The tool puts the card in front of you and returns straight away, and your answer reaches the agent as a message: it steers the agent if it is still working, and starts it again if it has already stopped. That is why an answer still lands with agents whose harness will not hold a tool call open while you decide.

If you dismiss the card or do not answer within 30 minutes, an agent that is still working is told to carry on with its own judgement, and one that has already stopped is left alone. Only one card can wait for you at a time. The agent therefore puts all of its questions in one call.

The tool is added only to providers that lack a native question tool. Providers with their own question tool, such as Claude Code, keep their native behavior.
