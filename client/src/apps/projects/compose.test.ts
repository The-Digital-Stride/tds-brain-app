import { describe, expect, it } from 'vitest';
import { emailCodeLine, gmailComposeUrl } from '../../../../shared/project-email-threads-contract.ts';
import {
  COMPOSE_HEIGHT,
  COMPOSE_WIDTH,
  composeContacts,
  composeWindowFeatures,
  contactWords,
} from './compose.ts';

const kim = { name: 'Kim Example', email: 'kim@acme.co.uk', main: true };
const lee = { name: null, email: 'lee@acme.co.uk', main: false };

describe('gmailComposeUrl with a contact', () => {
  it('puts the address in to=, encoded, and keeps the code line as the last line of the text', () => {
    const url = new URL(gmailComposeUrl('me@tds.example', 'SKY4K7', 'k.i+m@acme.co.uk'));
    expect(url.origin + url.pathname).toBe('https://mail.google.com/mail/');
    expect(url.searchParams.get('to')).toBe('k.i+m@acme.co.uk');
    expect(url.searchParams.get('authuser')).toBe('me@tds.example');
    expect(url.searchParams.get('view')).toBe('cm');
    expect(url.searchParams.get('body')).toBe(`\n\n${emailCodeLine('SKY4K7')}`);
    expect(gmailComposeUrl(null, 'SKY4K7', 'k.i+m@acme.co.uk')).toContain('&to=k.i%2Bm%40acme.co.uk&');
  });

  it('with no contact the link is exactly what it was before', () => {
    expect(gmailComposeUrl('me@tds.example', 'SKY4K7')).toBe(
      'https://mail.google.com/mail/?authuser=me%40tds.example&view=cm&fs=1&body=%0A%0ARef%3A%20%5BSKY4K7%5D',
    );
    expect(gmailComposeUrl(null, 'SKY4K7', '')).toBe(gmailComposeUrl(null, 'SKY4K7'));
  });

  it('an address can never add a second parameter', () => {
    const url = new URL(gmailComposeUrl(null, 'SKY4K7', 'a@b.co&bcc=evil@rival.co&body=hi#x'));
    expect(url.searchParams.get('to')).toBe('a@b.co&bcc=evil@rival.co&body=hi#x');
    expect(url.searchParams.get('bcc')).toBeNull();
    expect(url.searchParams.getAll('body')).toEqual([`\n\n${emailCodeLine('SKY4K7')}`]);
    expect(url.hash).toBe('');
  });
});

describe('composeContacts', () => {
  it('offers the client contacts as sent', () => {
    expect(composeContacts([kim, lee], 'me@tds.example')).toEqual([kim, lee]);
    expect(composeContacts([kim, lee], null)).toEqual([kim, lee]);
  });

  it('gives none for an older server that sends no contacts', () => {
    expect(composeContacts(undefined, 'me@tds.example')).toEqual([]);
  });

  it('leaves out this person and their colleagues named in the client file', () => {
    const mate = { name: 'Team Mate', email: 'Mate@TDS.example', main: false };
    const me = { name: 'Me', email: 'ME@tds.example', main: false };
    expect(composeContacts([kim, mate, me], 'me@tds.example')).toEqual([kim]);
  });

  it('a shared public mail host is not a colleague, but your own address still goes', () => {
    const client = { name: 'Solo Client', email: 'solo@gmail.com', main: true };
    const me = { name: 'Me', email: 'me@gmail.com', main: false };
    expect(composeContacts([client, me], 'me@gmail.com')).toEqual([client]);
  });
});

describe('contactWords', () => {
  it('shows the name with the address, or the address alone', () => {
    expect(contactWords(kim)).toBe('Kim Example (kim@acme.co.uk)');
    expect(contactWords(lee)).toBe('lee@acme.co.uk');
  });
});

describe('composeWindowFeatures', () => {
  it('is a small window at the right of the Cortex window with no link back', () => {
    const f = composeWindowFeatures({ screenX: 100, screenY: 50, outerWidth: 1400, outerHeight: 900 });
    expect(f).toBe(
      `popup=yes,width=${COMPOSE_WIDTH},height=${COMPOSE_HEIGHT},left=${100 + 1400 - COMPOSE_WIDTH - 24},top=${50 + (900 - COMPOSE_HEIGHT) / 2},noopener,noreferrer`,
    );
  });

  it('never starts off the screen for a small Cortex window', () => {
    const f = composeWindowFeatures({ screenX: 0, screenY: 0, outerWidth: 400, outerHeight: 500 });
    expect(f).toContain('left=0,top=0,');
  });
});
