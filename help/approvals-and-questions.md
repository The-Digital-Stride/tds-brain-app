---
id: approvals-and-questions
title: Approvals and questions
area: chats
order: 3
summary: Say yes or no when Claude asks to change something, or answer its questions.
benefit: You stay in control, and Claude never changes things behind your back.
roles: all
related: [talking-to-claude, chats-drawer, home]
since: 0.36.0
reviewed: 2026-11-25
---

## What it does

Sometimes Claude needs to check with you. It shows a card in the chat. You answer, and Claude carries on.

## Why it helps

- Nothing important changes without your say-so.
- You can say no, and tell Claude what to do instead.
- Claude can ask you when it isn't sure, rather than guess.

## How to use it

There are two kinds of card.

An approval card says **Needs your approval**. It names the thing Claude wants to do, such as change a file.

1. Read what Claude wants to do.
2. Press **Allow** to say yes.
3. Press **Don't allow** to say no. Use **If you say no, tell Claude why (optional)** to explain.

![Claude asking permission to change a file, with Allow and Don't allow buttons.](images/approval-card.webp)

When Claude asks a question, a card shows the answers to pick from. Pick one, or use **Or type your own answer**. Then press **Send answer**. Some questions let you pick more than one.

Before Claude merges or pushes work, a card asks **Are you sure you want to merge and push?** That means sending the work to GitHub, where the team shares it. The card lists the changes going out. Press the yes button to go ahead, or **No, not now** to stop. These cards ask every time.

## Good to know

- Some approval cards also offer **Allow for this chat**. That says yes to this kind of change for the rest of that chat. The card says exactly what it covers.
- Claude waits for you. It does not carry on until you answer.
- A force push can overwrite work already on GitHub, so its card starts with a **Take care** warning. The brain's own daily sync doesn't ask.
- Only owners and scouts can change Cortex itself. Ask Claude for a change and it offers to add your idea to the TDS Cortex Feedback project.

## Try this

Ask Claude to "Add a line to my notes file", then press **Don't allow** and say why.
