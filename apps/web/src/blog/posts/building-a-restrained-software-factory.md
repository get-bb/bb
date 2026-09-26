---
title: Building a (Restrained) Software Factory
date: 2026-09-17
lede: A practical guide to managing a fleet of agents without losing your sanity.
coverSrc: /blog/building-a-restrained-software-factory/cover.jpg
coverAlt: The bb logo made of thread in a textile factory
sourceLabel: This post first appeared as an X Article
sourceHref: https://x.com/sawyerhood/status/2100632943794503909
---

***bb*** is probably best known for [extending itself](https://x.com/sawyerhood/status/2085039905529597982), but extensibility was a much later addition to the app. ***bb*** started as an agent orchestrator whose pitch was: **If you can do it in the editor, an agent in bb can do it too.** A big thing that spun out of this is that agents can orchestrate other agents, and it turns out this becomes a powerful primitive for making bb the command center for all of your agents. Some might even call it a *software factory.*

I know how that sounds. I'm not going to tell you how to tokenmaxx and endlessly fire off your slop cannon. You don't have to have psychosis to automate the repetitive parts of your work: look for what you keep doing by hand, and use the tools at your disposal to make that less painful. The key is observability. bb lets you automate that work while still seeing what every agent is doing, and taking over when you need to.

Here's how I've used bb to build my (restrained) software factory, one thread at a time.

## Level 1: Cross-Provider Sub-Threads

Any agent inside bb can spawn other agents as child threads and talk to them. Those children don't have to use the same provider as the parent.

A basic example: let's say you're using Fable through Claude Code to implement something. You can ask that agent to spawn a GPT-6 Astra worker to review the code. When a thread is spawned as a child of another, the parent gets notified when the child stops working. In our reviewer case then the parent thread can implement the feedback the child has for it.

![A thread under another](/blog/building-a-restrained-software-factory/sub-thread.png)
*A thread under another*

You aren't limited to spawning a single thread at a time! For example you can have a Fable / Astra worker interview you and create the plan for a feature and then have a series of cheaper models (like Meta Muse or GPT Luna) do the implementation for you..

I personally use large fan-out spawning like this sparingly. For most implementation work, a single agent does better than a swarm. Where it can pay off though is when there are a lot of decisions and deep thinking to be made up front, but the implementation itself is pretty straightforward and can use a cheaper model.

## Level 2: Long-Lived Managers

A few months ago I was really excited by the idea of manager agents: you talk to one agent and it does all of the orchestration across other agents for you. I wrote [an article about having a middle manager](https://www.sawyerhood.com/blog/hired-a-middle-manager), and the middleman project was a precursor to bb.

In retrospect I might have had a bit of psychosis and you can't just talk to a single agent to do all of your work (yet). But I do have a few long-lived managers for repetitive tasks I do on a regular basis.

Here are two of these that I use on a daily basis.

### Marketplace Manager

We have a plugin marketplace where people open PRs to submit their plugins to bb. I have a manager that every morning looks through the submissions, installs those plugins into a test bb instance, and clicks through to make sure they work at a basic level. Then it gives me a preliminary yes or no on whether we should allow them into the marketplace.

![The genesis prompt for the Marketplace manager](/blog/building-a-restrained-software-factory/marketplace-manager.jpg)
*The genesis prompt for the Marketplace manager*

It keeps track of those reviews, including the submissions it rejected. If the author updates a submission, it checks the update against the previous review.

Oftentimes a manager grows organically. This started as a one-off thread that I gave instructions to and then over time I imbued it with more parameters and process until I've kept it around as the thread that spawns sub-threads to review all of the submissions every morning.

The main advantage to using a manager vs a skill is that you can give it feedback over time and let it accumulate. At one point it was treating too many things as blockers. I told it what I actually cared about for admission, it updated its review instructions, and it used them in later runs.

### Issue Report Manager

Every morning, another manager collects a summary of recent bb issues for me. It checks for duplicates across every open issue and gives me an overview of recent themes. Maybe we broke something and there are several reports of it. Or maybe there's some longer-term tech debt we should get to.

**A manager is a skill you can talk to.** You tell it what it got wrong and it changes. It's a lot like having a lightweight little OpenClaw for one particular responsibility.

Once I've talked through a few issues or a theme with the issue report manager, I can ask it to take that context and spawn agents to implement fixes and open PRs. One long-running conversation, with context that keeps growing.

Both of these managers run on a schedule through the Automations plugin, which I'll get to below.

### Drag Work Onto a Manager

You can reparent any thread into a manager, or into any other thread, by dragging it. Drop a thread onto a manager and ask it to take care of the next part. It doesn't have to be the agent that started the work. You can use this like Cursor projects. Have a manager that when you drag a thread on it it opens a PR, waits for CI to pass, and merges when it passes.

video:/blog/building-a-restrained-software-factory/drag-thread.mp4|/blog/building-a-restrained-software-factory/drag-thread-poster.jpg|Just drag it!

## Level 3: Plugin-Powered Orchestration

Orchestration works fine out of the box, but if you really want to get into the nitty-gritty, plugins let you customize orchestration the same way you customize the rest of bb.

### Automations

The most basic one is the built-in Automations plugin, and it's one of the building blocks of my managers. You can schedule a thread to wake up every morning / every few hours, and the automation wakes the thread to do the work.

### SlopCop

Next is my own plugin, [SlopCop](https://getbb.app/marketplace/slopcop). It's a GitHub integration that lets you set up rules for events like an issue being opened, a PR being opened, or a certain GitHub handle being mentioned. From there it can spawn a new thread with a prompt template.

I have a SlopCop rule that runs on every GitHub issue. An agent tries to reproduce the issue in a test environment and writes a reproduction report. If the fix is easy enough, the worker opens a PR automatically.

### Workflows

The Workflows plugin lets agents write code that orchestrates other agents, choosing a provider for each worker.

This is another tool I only reach for when I have a specific use case. Large migrations are the classic one. If you need to fix a lint error across every file in a codebase, have Fable write a workflow that spawns a Luna worker per file or small group of files, then collects the changes for verification and PRs.

![Example of a workflow to fix a collection of files](/blog/building-a-restrained-software-factory/workflow.jpg)
*Example of a workflow to fix a collection of files*

I really like using this across providers. Fable in particular is great at writing large workflows, while models like Muse and GPT-Luna punch above their weight for the price and you can have them do lots of repetitive work across the codebase for cheap.

## Give It a Shot

A few months ago I thought I'd talk to one agent and it would run everything. That hasn't happened (yet). What has worked for me is simpler. I've slowly been able to tweak how I work and build out systems that automate the repetitive parts of my day-to-day all while still having control in the end.

The malleability of bb goes deeper than just plugins. The entire system can be the playground for your agents.

- **Site:** [getbb.app](https://getbb.app/)

- **GitHub:** [get-bb/bb](https://github.com/get-bb/bb)
