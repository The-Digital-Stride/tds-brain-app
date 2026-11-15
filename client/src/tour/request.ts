import { useSyncExternalStore } from 'react';

/** A tiny shared store: a request to start the tour, and whether the tour is showing. */
let requested = false;
let open = false;
const listeners = new Set<() => void>();
const emit = () => {
  for (const l of listeners) l();
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function requestTour(): void {
  requested = true;
  emit();
}
export function useTourRequested(): boolean {
  return useSyncExternalStore(subscribe, () => requested);
}
export function clearTourRequest(): void {
  if (!requested) return;
  requested = false;
  emit();
}
export function setTourOpen(value: boolean): void {
  if (open === value) return;
  open = value;
  emit();
}
export function useTourOpen(): boolean {
  return useSyncExternalStore(subscribe, () => open);
}
