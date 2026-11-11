import type { AppPermissionMode } from '../../shared/contract.ts';

const SENTENCES: Record<AppPermissionMode, string> = {
  default: 'Claude asks before it changes a file or runs a command.',
  acceptEdits:
    'Claude creates, changes, moves and deletes files in the brain folder without asking, and asks before other commands.',
  auto: "Claude Code's own safety check decides. Claude saves and changes files in the brain folder without asking, and those changes sync to the team. Risky steps are blocked or put to you.",
};

export function approvalsSentence(mode: AppPermissionMode): string {
  return SENTENCES[mode];
}
