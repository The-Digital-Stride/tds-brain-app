// Frozen verbatim copy of parseFrontmatter from the brain's
// tools/members/command-centre/lib/todo-parser.cjs (lines 53-81, copied 2026-11-13).
// The Workbench reads to-do files with this; files the skill writes must read the same here.
// Never edit to make a test pass: if the Workbench changes, copy it again.
'use strict';
function parseFrontmatter(content) {
  if (!content.startsWith('---\n') && !content.startsWith('---\r\n')) {
    return { frontmatter: {}, body: content };
  }
  const lines = content.split(/\r?\n/);
  // Find the closing --- (skip line 0 which is the opener).
  let closeIdx = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === '---') { closeIdx = i; break; }
  }
  if (closeIdx === -1) return { frontmatter: {}, body: content };

  const fm = {};
  for (let i = 1; i < closeIdx; i++) {
    const line = lines[i];
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/);
    if (!m) continue;
    let value = m[2].trim();
    // Strip surrounding quotes.
    if ((value.startsWith('"') && value.endsWith('"'))
        || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    fm[m[1]] = value;
  }
  const body = lines.slice(closeIdx + 1).join('\n').replace(/^\n+/, '');
  return { frontmatter: fm, body };
}
module.exports = { parseFrontmatter };
