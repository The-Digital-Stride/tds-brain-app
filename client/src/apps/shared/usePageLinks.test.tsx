// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PAGE_LINK_URL_MAX } from '../../../../shared/pages-contract.ts';
import { usePageLinks } from './usePageLinks.ts';

describe('usePageLinks', () => {
  let frame: HTMLIFrameElement;
  let other: HTMLIFrameElement;
  let open: ReturnType<typeof vi.spyOn>;
  let active = true;

  beforeEach(() => {
    frame = document.createElement('iframe');
    other = document.createElement('iframe');
    document.body.append(frame, other);
    frame.focus();
    active = true;
    Object.defineProperty(navigator, 'userActivation', {
      configurable: true,
      get: () => ({ isActive: active, hasBeenActive: true }),
    });
    open = vi.spyOn(window, 'open').mockImplementation(() => null);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    frame.remove();
    other.remove();
    Reflect.deleteProperty(navigator, 'userActivation');
  });

  function mount() {
    return renderHook(() => usePageLinks({ current: frame }));
  }
  function send(data: unknown, source: Window | null = frame.contentWindow): void {
    window.dispatchEvent(new MessageEvent('message', { data, source, origin: 'null' }));
  }
  const link = (url: unknown) => ({ type: 'tds-page-open-link', url });

  it('opens a clicked link from its frame in a new tab, as parsed', () => {
    mount();
    send(link('https://example.com/a b?c=1'));
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith('https://example.com/a%20b?c=1', '_blank', 'noopener,noreferrer');
  });

  it('ignores a message from another window', () => {
    mount();
    send(link('https://example.com/'), other.contentWindow);
    send(link('https://example.com/'), window);
    send(link('https://example.com/'), null);
    expect(open).not.toHaveBeenCalled();
  });

  it('ignores a message without a click, or when the frame does not have focus', () => {
    mount();
    active = false;
    send(link('https://example.com/'));
    active = true;
    other.focus();
    send(link('https://example.com/'));
    expect(open).not.toHaveBeenCalled();
    Reflect.deleteProperty(navigator, 'userActivation');
    frame.focus();
    send(link('https://example.com/'));
    expect(open).not.toHaveBeenCalled();
  });

  it('refuses other schemes, the app, loopback, a user name and over-long addresses', () => {
    mount();
    for (const url of [
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'file:///etc/passwd',
      'blob:https://example.com/x',
      `${window.location.origin}/api/bootstrap`,
      'http://localhost:3878/',
      'http://sub.localhost/',
      'http://127.0.0.1:3878/',
      'http://127.1/',
      'http://[::1]:3878/',
      'http://0.0.0.0:3878/',
      'https://user:pass@example.com/',
      `https://example.com/${'a'.repeat(PAGE_LINK_URL_MAX)}`,
    ])
      send(link(url));
    expect(open).not.toHaveBeenCalled();
  });

  it('ignores malformed data', () => {
    mount();
    for (const data of [
      null,
      undefined,
      'https://example.com/',
      { url: 'https://example.com/' },
      { type: 'tds-page-open-link' },
      { type: 'tds-page-open-link', url: 7 },
      { type: 'tds-page-open-link', url: 'not a url' },
      { type: 'tds-page-open-link', url: '/relative' },
      { type: 'something-else', url: 'https://example.com/' },
    ])
      send(data);
    expect(open).not.toHaveBeenCalled();
  });

  it('stops listening when unmounted', () => {
    const { unmount } = mount();
    unmount();
    send(link('https://example.com/'));
    expect(open).not.toHaveBeenCalled();
  });
});
