import { act, fireEvent, screen } from '@testing-library/react';

/** The text of an option row, without the visually-hidden ", chosen" the current value carries. */
const plain = (name: string) => name.replace(/, chosen$/, '');

/** Opens the SearchSelect named `label` the way a person does: focus it, then click it. */
export function openPicker(label: string): HTMLInputElement {
  const input = screen.getByRole('combobox', { name: label }) as HTMLInputElement;
  act(() => input.focus());
  fireEvent.click(input);
  return input;
}

/**
 * Drives a SearchSelect (`client/src/shell/SearchSelect.tsx`) as a person would: opens the list from
 * the box named `label`, then clicks the row called `optionName` (the first one, when Recent repeats it).
 */
export function pickOption(label: string, optionName: string): void {
  openPicker(label);
  const rows = screen.getAllByRole('option').filter((o) => plain(o.textContent ?? '') === optionName);
  if (rows.length === 0) throw new Error(`No option "${optionName}" in the "${label}" list`);
  fireEvent.click(rows[0] as HTMLElement);
}

/** What a SearchSelect's box shows now. */
export const pickerText = (label: string): string =>
  (screen.getByRole('combobox', { name: label }) as HTMLInputElement).value;
