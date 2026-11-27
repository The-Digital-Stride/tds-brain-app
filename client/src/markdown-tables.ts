/**
 * Markdown splits a table row at every `|` that has no backslash, even inside backticks. A campaign name such
 * as `TDS | Search | Brand` then spreads over three cells and the cells past the last column are dropped, so
 * real values vanish. Here a pipe inside backticks is read as text, but only on a line that has more cells
 * than the table has columns: any other line already fits and is left as written.
 */
import { Tokenizer, type TokenizerObject, type Tokens } from 'marked';

// A run of backticks, the shortest text up to a run of the same length, and that run.
const CODE_SPAN = /(?<![\\`])(`+)(?!`)([\s\S]*?[^`])\1(?!`)/g;
const BARE_PIPE = /(?<!\\)\|/g;

function cellCount(line: string): number {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/(?<!\\)\|$/, '')
    .split(BARE_PIPE).length;
}

function fixTable(table: string): string {
  const lines = table.split('\n');
  const columns = cellCount(lines[1] ?? '');
  return lines
    .map((line, i) =>
      i !== 1 && cellCount(line) > columns
        ? line.replace(CODE_SPAN, (span) => span.replace(BARE_PIPE, '\\|'))
        : line,
    )
    .join('\n');
}

/** For `new Marked({ tokenizer })`. Runs only where marked itself finds a table, never in a code block. */
export const tableTokenizer: TokenizerObject = {
  table(src: string): Tokens.Table | undefined | false {
    const found = this.rules.block.table.exec(src)?.[0];
    if (!found) return false;
    const fixed = fixTable(found);
    // False hands the untouched text to marked's own tokenizer.
    if (fixed === found) return false;
    const token = Tokenizer.prototype.table.call(this, fixed);
    if (!token) return false;
    // marked moves on by the length of `raw`, so it must be the text as it was written.
    token.raw = found.replace(/\n+$/, '');
    return token;
  },
};
