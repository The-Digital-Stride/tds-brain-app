import { requestTour } from './request.ts';

export { useTourOpen } from './request.ts';
export { Tour } from './Tour.tsx';

/** Asks for the tour. It starts as soon as nothing modal is open, from wherever the person is. */
export function startTour(): void {
  requestTour();
}
