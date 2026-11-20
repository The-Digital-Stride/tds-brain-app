# Brain change request: cover the Ads bridge in the write gate

For: whoever looks after `~/agencybrain/.claude/hooks/gads-write-gate.cjs` (Pete). The app never edits the brain,
so this is a request, not something the app does.

## The gap

The write gate makes the person click to allow a proposal decision (`proposals.cjs approve|reject|request-changes`)
and checks a live `apply.cjs --confirmed`. The TDS Brain App's bridge, `.claude/skills/tdsapp-ads/scripts/tdsapp-ads.cjs`,
takes the same steps with the details as JSON on stdin (`tdsapp-ads.cjs decide`, `apply`, ...). The gate's patterns
don't match those commands, so if Claude ran the bridge from a chat there would be no click. Only the skill's written
rules say Claude must not. This is true of the copy already in the brain (v0.2), not new in v0.3.

The app itself runs the bridge directly, not through Claude's Bash tool, so the hook never sees the app's own calls.
Adding these patterns can't break Ad Manager.

## Suggested patch

Add after section 1 (proposal decisions) in `gads-write-gate.cjs`:

```js
// 1b. The TDS Brain App's Ads bridge takes the same decisions as JSON on stdin. Ad Manager runs it without a
//     shell, so this only fires when Claude runs it from a chat. Applying is never Claude's to do: refuse it.
const bridge = cmd.match(/tdsapp-ads\.cjs\b[^\n;&|]*\b(decide|decided|client-approved|sign-monthly|apply)\b/);
if (bridge) {
  if (bridge[1] === 'apply') {
    deny('Apply refused: a live change to Google Ads is made with Apply now in Ad Manager (TDS Cortex), never from a chat.', { kind: 'tdsapp-ads-apply', cmd });
  }
  ask(`ADS BRIDGE ${bridge[1].toUpperCase()}. This is your decision, not Claude's: allow only if you have read the proposal or report and mean to do this yourself. Ad Manager in TDS Cortex is the usual place.`, { kind: 'tdsapp-ads-decision', cmd });
}
```

`dry-run` stays unprompted, as it changes nothing in Google Ads (the same as `apply.cjs` without `--confirmed`).

## Already done on the app side (v0.51.0, bridge v0.3)

- The skill's description no longer lists "approve proposal …" or "sign off the October report" as phrases to act
  on, and says Claude never runs `decide`, `decided`, `client-approved`, `sign-monthly` or `apply` from a chat.
