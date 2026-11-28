import { durationWords, hoursWords } from './words.ts';

/** A duration as "1:15" to look at and "1 hour 15 minutes" to hear. */
export function Duration({ minutes }: { minutes: number }) {
  return (
    <>
      <span aria-hidden="true">{hoursWords(minutes)}</span>
      <span className="visually-hidden">{durationWords(minutes)}</span>
    </>
  );
}
