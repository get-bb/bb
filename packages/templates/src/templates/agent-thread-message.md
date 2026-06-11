---
kind: prompt
title: Agent Thread Message
summary: Wraps a bb CLI message from one agent thread to another.
intent: Tell the receiving agent which thread sent the message without prompting an unnecessary reply.
editingNotes: Keep only sender identity in the prefix; reply instructions cause agents to acknowledge messages that do not need responses.
variables:
  senderThreadId: The thread ID that sent the message.
  messageText: The original message text sent by the agent.
---
[bb message from thread:{{senderThreadId}}]

{{messageText}}
