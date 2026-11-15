---
id: helpers
title: Helpers
area: chats
order: 6
summary: Claude can hand parts of a big job to helpers and put the results together.
benefit: Big jobs finish faster, and simple parts run on a cheaper, quicker level.
roles: all
related: [levels, what-claude-did, chats-drawer, approvals-and-questions]
since: 0.38.0
reviewed: 2026-11-15
---

## What it does

A helper is a smaller Claude that works on one part of a job. Claude hands out the parts, then puts the results together for you.

## Why it helps

- A job with several clients or sources can be split up.
- Simple parts run on a quicker, cheaper level. See [Levels](help:levels).
- You get one answer, not several chats to join up.

## How to use it

You don't start helpers yourself. Claude brings them in only when a job is big enough to need them.

1. Open the [Chats drawer](help:chats-drawer). Under a chat that has helpers, you'll see a **Helpers** fold with a count.
2. Open it to see each helper. A line shows what it's doing, its level and model, and how long it has run.
3. Click a helper to open the chat it is working for.

When a helper finishes, its line says **Done**. It says **Failed** if something went wrong, or **Stopped** if it was stopped.

## Good to know

- Most requests need no helpers at all.
- A helper's report shows in the **What Claude did** fold under the reply. See [What Claude did](help:what-claude-did).
- A helper asks before a command or connector only as often as your terminal would. See [Approvals and questions](help:approvals-and-questions).
- If you close a chat, any helpers still working stop too. Cortex asks you first.

## Try this

Ask "Compare last month's results for Acme Heating and Northwind". Then watch the Chats drawer for helpers.
