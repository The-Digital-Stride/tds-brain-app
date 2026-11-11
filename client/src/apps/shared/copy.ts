import { useEffect, useRef, useState } from 'react';

/** Copies text and says so for two seconds: `said` is "Copied", "Could not copy" or null. */
export function useCopy() {
  const [said, setSaid] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = async (text: string) => {
    let ok = true;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      ok = false;
    }
    setSaid(ok ? 'Copied' : 'Could not copy');
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setSaid(null), 2000);
  };
  return { said, copy };
}
