// Frozen verbatim copy of parse() and the title rule from ~/.plaud-reminders/todo-sync.mjs
// (Ian's Reminders sync, copied 2026-11-13). Never edit to make a test pass.
'use strict';
const cleanTitle = (s) => String(s || '').replace(/^\s*\[check\]\s*/i, '').replace(/\s+/g, ' ').trim().replace(/\.$/, '').slice(0, 200);
function parse(content) {
  const fm = {};
  const lines = content.split(/\r?\n/);
  if (lines[0] !== '---') return { fm, lines, close: -1 };
  const close = lines.indexOf('---', 1);
  for (let i = 1; i < close; i++) {
    const m = lines[i].match(/^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/);
    if (m) fm[m[1]] = m[2].trim().replace(/^(['"])(.*)\1$/, '$2');
  }
  return { fm, lines, close };
}
// Title as readTodos() derives it (fm.title, else the first H1, else the file name).
function titleOf(content, file) { const { fm } = parse(content); const h1 = content.match(/^#\s+(.+?)\s*$/m); return cleanTitle(fm.title || (h1 && h1[1]) || file.replace(/\.md$/, '')); }
module.exports = { parse, cleanTitle, titleOf };
