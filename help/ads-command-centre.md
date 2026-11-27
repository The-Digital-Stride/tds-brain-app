---
id: ads-command-centre
title: Ads Command Centre
area: getting-around
order: 8
summary: Check an account's data, then start its regular Google Ads jobs.
benefit: You see every regular job in one place and start each one with a single press.
roles: all
related: [ad-manager, ads-account-summary, workbench]
since: 0.50.0
reviewed: 2026-11-24
---

## What it does

Ads Command Centre is for running a client's Google Ads account. The top panel shows whether the account's data is ready. Below it, each job is a card, sorted by how often it runs: daily, weekly, fortnightly, monthly or quarterly. The Daily standup leads the Daily column.

## Why it helps

- Every job is optional, so you run the checks you need, when you need them.
- Every job starts a fresh Claude chat that already has what it needs.

## How to use it

1. Open **Workbench**, then **Ads**, and choose **Ads Command Centre**.
2. Read the data panel. Green means every file is ready. Amber means something is stale or the daily fetch has a problem. Red means a file is missing. Press **Show files** to see each one.
3. Use the colour key. A report pulls information together, insights find what to do, actions make a change, and the standup is a multi-agent debate.
4. A **Stopped** badge on a card means its last run was stopped or failed.
5. Press **Run**. The chat opens over the page, and **Hide chat** takes you back. The card says **Running**.
6. A card shows when it last ran. After a stopped run, **Last good run** opens the last one that finished.
7. On the Daily standup card, press **Rate calls** to score each call it made.
8. Press **All accounts' standups** to see each client's latest standup, worst first. Press a client to switch to it.
9. A task that saved a report shows **Open result** on its card, when the app saw the report being saved.

## Good to know

- A red or amber panel doesn't block you. Jobs that need the missing files will just have gaps.
- A teammate's run shows with their name.
- The Daily standup has no **Open result**.
- The newest buttons need the updated Ads skill in the Brain.
- **Refresh** at the top reloads the account.
- If you have typed scores or notes in **Rate calls** and try to leave, Cortex asks first. Press **Keep editing** to go back.

## Try this

Open the data panel and read which files are ready.
