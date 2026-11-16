import { useState } from 'react';
import { Icon } from '../../shell/Icon.tsx';
import type { Table } from './types.ts';
import { fmt, isLow, isQuietZero, moneyDigits, sortRows } from './words.ts';

/** Rows shown before "Show all". */
export const TABLE_ROWS = 5;

/**
 * The one report table of the Ad Manager: sortable headers (`aria-sort`), figures formatted per column
 * (money decimals, ROAS, Quality Score), low values flagged in words as well as colour, a Spend bar,
 * five rows then "Show all", and a sticky first column when it scrolls sideways.
 */
export function AmTable({ t, currency }: { t: Table; currency: string }) {
  const [sort, setSort] = useState<{ idx: number; dir: 'asc' | 'desc' }>({
    idx: t.defaultSort ?? 0,
    dir: 'desc',
  });
  const [all, setAll] = useState(false);
  const rows = sortRows(t.rows, sort.idx, sort.dir);
  const shown = all ? rows : rows.slice(0, TABLE_ROWS);
  const choose = (idx: number) =>
    setSort((s) =>
      s.idx === idx
        ? { idx, dir: s.dir === 'asc' ? 'desc' : 'asc' }
        : { idx, dir: t.cols[idx]?.type === 'text' ? 'asc' : 'desc' },
    );
  // Per column, over every row (not only the ones shown), so a figure reads the same when it moves.
  const columns = t.cols.map((c, i) => {
    const values = t.rows.map((r) => r[i]);
    const nums = values.filter((v): v is number => typeof v === 'number');
    return {
      values,
      digits: c.type === 'money' ? moneyDigits(values) : 0,
      isSpend: c.type === 'money' && (c.key === 'spend' || c.label === 'Spend'),
      max: nums.length ? Math.max(...nums.map(Math.abs)) : 0,
    };
  });
  const spendIdx = columns.findIndex((c) => c.isSpend);
  return (
    <>
      <div className="am-scroll">
        <table className="am-table" data-am-table="true">
          <thead>
            <tr>
              {t.cols.map((c, i) => (
                <th
                  key={c.label}
                  scope="col"
                  data-num={c.type === 'text' ? undefined : 'true'}
                  aria-sort={sort.idx === i ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                >
                  <button type="button" className="am-sort" onClick={() => choose(i)}>
                    {c.label}
                    {sort.idx === i ? (
                      <span className="am-sort-icon" data-dir={sort.dir === 'asc' ? 'up' : 'down'}>
                        <Icon name="chevron" size={14} />
                      </span>
                    ) : null}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((r, n) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: rows have no id of their own
              <tr key={n}>
                {r.map((v, i) => {
                  const spent = spendIdx >= 0 ? Number(r[spendIdx]) > 0 : undefined;
                  const col = t.cols[i];
                  const type = col?.type ?? 'text';
                  const meta = columns[i];
                  const text = fmt(v, type, currency, meta?.digits ?? 0);
                  const low = meta ? isLow(v, type, meta.values, spent) : false;
                  // A 0.00x ROAS on a row that spent nothing says nothing, so it reads as quiet as other zeros.
                  const zero = isQuietZero(v, type) || (type === 'x' && spent === false && Number(v) === 0);
                  const share =
                    meta?.isSpend && typeof v === 'number' && meta.max > 0
                      ? (Math.abs(v) / meta.max) * 100
                      : 0;
                  return (
                    <td key={col?.label ?? i} data-num={type === 'text' ? undefined : 'true'}>
                      {share > 0 ? (
                        <span className="am-bar" style={{ width: `${share}%` }} aria-hidden="true" />
                      ) : null}
                      <span
                        className="am-val"
                        data-low={low ? 'true' : undefined}
                        data-zero={zero ? 'true' : undefined}
                      >
                        {text}
                        {low ? <span className="visually-hidden">, low</span> : null}
                      </span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > TABLE_ROWS ? (
        <div className="am-more">
          <button
            type="button"
            className="btn"
            data-variant="quiet"
            data-size="small"
            aria-expanded={all}
            onClick={() => setAll((a) => !a)}
          >
            {all ? 'Show fewer' : `Show all ${rows.length}`}
          </button>
        </div>
      ) : null}
    </>
  );
}
