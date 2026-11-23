/**
 * One table of claude.ai addresses, shared by every test of the artifact-address rule (the shared reader,
 * the server route and the `tdsapp-files` skill's own copy of the pattern), so they cannot drift apart.
 * Plan 2026-11-23-claude-artifacts-in-projects, decisions 3, 7, 8 and 10.
 *
 * `clean` is what `cleanArtifactUrl` returns for the input: the trimmed address without query or
 * fragment, or null when it is refused.
 */
export interface ArtifactUrlCase {
  input: string;
  clean: string | null;
}

export const ARTIFACT_URL_CASES: readonly ArtifactUrlCase[] = [
  { input: 'https://claude.ai/artifact/AbC123', clean: 'https://claude.ai/artifact/AbC123' },
  { input: 'https://claude.ai/artifact/AbC123/', clean: 'https://claude.ai/artifact/AbC123/' },
  { input: 'https://claude.ai/artifact/AbC-123', clean: 'https://claude.ai/artifact/AbC-123' },
  {
    input: 'https://claude.ai/code/artifact/0b5c3c2e-1111-4a2b-9c3d-123456789abc',
    clean: 'https://claude.ai/code/artifact/0b5c3c2e-1111-4a2b-9c3d-123456789abc',
  },
  { input: '  https://claude.ai/artifact/AbC123  ', clean: 'https://claude.ai/artifact/AbC123' },
  { input: 'https://claude.ai/artifact/AbC123?utm=x', clean: 'https://claude.ai/artifact/AbC123' },
  { input: 'https://claude.ai/artifact/AbC123#top', clean: 'https://claude.ai/artifact/AbC123' },
  { input: 'https://claude.ai/artifact/AbC123?a=1#b', clean: 'https://claude.ai/artifact/AbC123' },
  { input: '', clean: null },
  { input: '   ', clean: null },
  { input: 'http://claude.ai/artifact/AbC123', clean: null },
  { input: 'javascript:alert(1)', clean: null },
  { input: 'data:text/html,<p>x</p>', clean: null },
  { input: 'https://claude.ai.evil.com/artifact/AbC123', clean: null },
  { input: 'https://evilclaude.ai/artifact/AbC123', clean: null },
  { input: 'https://claude.ai@evil.com/artifact/AbC123', clean: null },
  { input: 'https://evil.com/?https://claude.ai/artifact/AbC123', clean: null },
  { input: 'https://www.claude.ai/artifact/AbC123', clean: null },
  { input: 'https://claude.ai/artifact/', clean: null },
  { input: 'https://claude.ai/artifact/AbC123/extra', clean: null },
  { input: 'https://claude.ai/artifacts/AbC123', clean: null },
  { input: 'https://claude.ai/artifact/AbC 123', clean: null },
  { input: `https://claude.ai/artifact/${'a'.repeat(65)}`, clean: null },
  { input: 'https://claude.ai/artifact/AbC123"><script>', clean: null },
  { input: 'https://claude.ai/artifact/AbC123\nx', clean: null },
];
