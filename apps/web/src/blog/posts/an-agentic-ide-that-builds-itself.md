---
title: An Agentic IDE That Builds Itself
date: 2026-08-05
lede: I'm excited to show something I've been working on recently: **bb**, an agentic IDE that builds itself.
coverSrc: /blog/an-agentic-ide-that-builds-itself/header.png
coverAlt: The bb mark on a dark grid
sourceLabel: This post first appeared as an X Article
sourceHref: https://x.com/sawyerhood/status/2085039905529597982
---

This started as a passion project by [@_ymichael](https://x.com/_ymichael), and over time I changed from being an early user to a contributor. **bb** really worked for me in a way no other agent orchestrator has before and I think you'll like it too.

Your first question is: ok, there are dozens of these, why this one?

tweet:https://x.com/brian_lovin/status/2084345751266857079

## No Two Installs Look Alike

Software of a previous generation looks something like this: there is a team somewhere who is solving a pain point for you. They might not solve it perfectly, but they are solving the problem for a set of people well enough and the economies of scale make it so that it is more efficient to buy their software vs building it yourself.

Software now is cheaper than ever before and I think those previous assumptions might no longer hold true. Software that you use needs to get the fundamentals right and be malleable enough to adapt to your use case.

This is where **bb** shines. It is a full agent orchestrator with solid fundamentals. It has a beautiful timeline and works with any coding agent using your own subscriptions. But the thing that sets it apart is that you can extend it in any way you see fit. Here is **bb** the first time you open it:

![bb the first time you open it](/blog/an-agentic-ide-that-builds-itself/first-open.jpg)
*Threads on the left! I've never seen this before.*

Here is my **bb**:

![A customized bb with a task system inside the IDE](/blog/an-agentic-ide-that-builds-itself/custom.jpg)
*Yes, I've cloned Linear inside of my IDE.*

Same install. Your imagination is the limit. Here is a set of things that people have added to **bb** all by just asking it to build it for them:

- **A task management system.** A full GUI for managing issues and agents automatically know how to read, create, and filter them.
- **A tiling thread management system.** A way to spatially navigate between all of your threads in two dimensions.

tweet:https://x.com/sawyerhood/status/2083215357872120216

- **Automated code review.** A GitHub webhook that watches a repo for new PRs, pulls them, reviews them, and uses Codex computer use to test them end to end.
- **A markdown editor.** An Obsidian-like vault for markdown that you and your agents can edit. I'm writing this post in it right now.
- **A digital audio workstation.** I have a surface that lets me upload samples and prompt agents to create code using [Strudel](https://strudel.cc/workshop/getting-started/) to do music production inside of **bb**.

[![A DAW inside my agent orchestrator](/blog/an-agentic-ide-that-builds-itself/daw.jpg)](https://x.com/sawyerhood/status/2085039905529597982)
*A DAW inside my agent orchestrator.*

Moreover, much of the functionality that ships with **bb** was built using the same extension system that you can use to have **bb** customize itself: provider agnostic workflows, the ask user question tool, side chat, crons, inline previews, and remote access are all plugins.

## The Code Is Yours

**bb** is an open source, MIT licensed agent orchestrator. It works with all of the popular coding agents out of the box (Codex, Claude Code, Cursor, etc) and any agent that supports ACP, on your own subscriptions.

Clone it, run it, and then ask it for something it does not do yet.

I have not gone back to a tool I cannot change. I don't think I will.

- **Site:** [getbb.app](https://getbb.app)
- **GitHub:** [get-bb/bb](https://github.com/get-bb/bb)
