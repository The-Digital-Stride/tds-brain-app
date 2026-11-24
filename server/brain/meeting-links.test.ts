import { describe, expect, it } from 'vitest';
import { cleanCalendarLink, cleanJoinLink, dayLink, meetingLinks } from './meeting-links.ts';

const GOOD =
  'https://www.google.com/calendar/event?eid=MHZ2OGI0MGsxbTIzOGVldGhjcGx2Z2g5czk&ctz=Europe/London';

describe('cleanCalendarLink', () => {
  it('keeps a Google Calendar event link', () => {
    expect(cleanCalendarLink(GOOD)).toBe(GOOD);
    expect(cleanCalendarLink('https://calendar.google.com/calendar/event?eid=abc')).toBe(
      'https://calendar.google.com/calendar/event?eid=abc',
    );
  });
  it.each([
    ['http', 'http://www.google.com/calendar/event?eid=abc'],
    ['another host', 'https://evil.example/calendar/event?eid=abc'],
    ['a look-alike host', 'https://www.google.com.evil.example/calendar/event?eid=abc'],
    ['credentials in the URL', 'https://user:pw@www.google.com/calendar/event?eid=abc'],
    ['a path outside /calendar/', 'https://www.google.com/url?q=https://evil.example'],
    ['javascript:', 'javascript:alert(1)'],
    ['a dot-dot path out of /calendar/', 'https://www.google.com/calendar/../url?q=https://evil.example'],
    ['an encoded dot-dot path', 'https://www.google.com/calendar/%2e%2e/url?q=https://evil.example'],
    ['not a URL', 'calendar event'],
    ['a number', 42],
    ['null', null],
    ['too long', `https://www.google.com/calendar/event?eid=${'a'.repeat(3000)}`],
  ])('drops %s', (_, raw) => {
    expect(cleanCalendarLink(raw)).toBeNull();
  });
});

describe('cleanJoinLink', () => {
  it.each([
    'https://meet.google.com/jgh-epfh-uzr',
    'https://teams.microsoft.com/l/meetup-join/19%3ameeting',
    'https://teams.live.com/meet/123',
    'https://zoom.us/j/123',
    'https://us02web.zoom.us/j/123?pwd=x',
  ])('keeps %s', (raw) => {
    expect(cleanJoinLink(raw)).toBe(raw);
  });
  it.each([
    'https://evilzoom.us/j/123',
    'http://meet.google.com/abc',
    'https://meet.google.com.evil.example/abc',
    'https://tel.meet/jgh-epfh-uzr?pin=1',
    'tel:+442039569092',
    'javascript:alert(1)',
  ])('drops %s', (raw) => {
    expect(cleanJoinLink(raw)).toBeNull();
  });
});

describe('dayLink', () => {
  it('uses the local date of a timed meeting', () => {
    const start = new Date(2026, 10, 25, 14, 30).toISOString();
    expect(dayLink(start)).toBe('https://calendar.google.com/calendar/r/day/2026/11/25');
  });
  it('uses a plain date as written (all-day)', () => {
    expect(dayLink('2026-12-01')).toBe('https://calendar.google.com/calendar/r/day/2026/12/1');
  });
});

describe('meetingLinks', () => {
  it('uses the event link when it is good', () => {
    expect(
      meetingLinks({ link: GOOD, join: 'https://meet.google.com/abc', start: '2026-11-25T10:00:00Z' }),
    ).toEqual({
      calendar: GOOD,
      calendarKind: 'event',
      join: 'https://meet.google.com/abc',
    });
  });
  it('falls back to the day view and no Join', () => {
    expect(
      meetingLinks({
        link: 'https://evil.example/calendar/x',
        join: 'https://evil.example',
        start: '2026-12-01',
      }),
    ).toEqual({
      calendar: 'https://calendar.google.com/calendar/r/day/2026/12/1',
      calendarKind: 'day',
      join: null,
    });
  });
});
