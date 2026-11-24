import { useEffect, useState } from 'react';

/** The current time in ms, refreshed every `every` ms (no fetch), so "Now" and "Join" follow the clock. */
export function useNow(every: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), every);
    return () => clearInterval(id);
  }, [every]);
  return now;
}
