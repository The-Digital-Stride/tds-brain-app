// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HOVER_GRACE_MS, TIP_DELAY_MS } from './PaletteTip.tsx';
import { Tooltips } from './Tooltips.tsx';

const tip = () => document.querySelector('.tip');

function Page({ close = true }: { close?: boolean }) {
  return (
    <>
      <Tooltips />
      {close ? (
        <button type="button" className="icon-btn" aria-label="Close tasks">
          x
        </button>
      ) : null}
      <button
        type="button"
        className="icon-btn"
        aria-label="Favourite: Renew the contract"
        data-tip="Favourite"
      >
        *
      </button>
      <button type="button" className="btn">
        Save
      </button>
      <nav className="rail">
        <a href="#home" data-tip="Home">
          h
        </a>
      </nav>
    </>
  );
}
const page = () => render(<Page />);
const button = (name: string) => document.querySelector<HTMLElement>(`[aria-label="${name}"]`) as HTMLElement;
const wait = (ms: number) => act(() => vi.advanceTimersByTime(ms));

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('Tooltips', () => {
  it("shows an icon button's label after a short pause, and its short name when it has one", () => {
    page();
    fireEvent.pointerOver(button('Close tasks'));
    wait(TIP_DELAY_MS - 10);
    expect(tip()).toBeNull();
    wait(10);
    expect(tip()?.textContent).toBe('Close tasks');
    expect(tip()?.getAttribute('aria-hidden')).toBe('true');
    // Moving to the next one while one shows follows at once.
    fireEvent.pointerOut(button('Close tasks'), { relatedTarget: button('Favourite: Renew the contract') });
    fireEvent.pointerOver(button('Favourite: Renew the contract'));
    expect(tip()?.textContent).toBe('Favourite');
  });

  it('shows nothing for a button with words of its own, or for touch', () => {
    page();
    fireEvent.pointerOver(document.querySelector('.btn') as HTMLElement);
    wait(TIP_DELAY_MS);
    expect(tip()).toBeNull();
    fireEvent.pointerOver(button('Close tasks'), { pointerType: 'touch' });
    wait(TIP_DELAY_MS);
    expect(tip()).toBeNull();
  });

  it('stays while the pointer moves onto it, and goes a moment after the pointer leaves', () => {
    page();
    fireEvent.pointerOver(button('Close tasks'));
    wait(TIP_DELAY_MS);
    const t = tip() as HTMLElement;
    fireEvent.pointerOut(button('Close tasks'), { relatedTarget: t });
    fireEvent.pointerOver(t);
    wait(HOVER_GRACE_MS * 3);
    expect(tip()).not.toBeNull();
    fireEvent.pointerOut(t, { relatedTarget: document.body });
    wait(HOVER_GRACE_MS - 10);
    expect(tip()).not.toBeNull();
    wait(10);
    expect(tip()).toBeNull();
  });

  it('never shows for a button the pointer only passed over', () => {
    page();
    fireEvent.pointerOver(button('Close tasks'));
    wait(TIP_DELAY_MS / 2);
    fireEvent.pointerOut(button('Close tasks'), { relatedTarget: document.body });
    wait(TIP_DELAY_MS);
    expect(tip()).toBeNull();
  });

  it('shows at once for a button reached from the keyboard, not for one focused by a click', () => {
    page();
    fireEvent.pointerDown(button('Close tasks'));
    act(() => button('Close tasks').focus());
    expect(tip()).toBeNull();
    fireEvent.keyDown(window, { key: 'Tab' });
    act(() => button('Favourite: Renew the contract').focus());
    expect(tip()?.textContent).toBe('Favourite');
    act(() => button('Favourite: Renew the contract').blur());
    expect(tip()).toBeNull();
  });

  it('takes Escape for a pointed-at tooltip, but lets it through for one shown by focus', () => {
    page();
    fireEvent.pointerOver(button('Close tasks'));
    wait(TIP_DELAY_MS);
    const pointed = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    act(() => {
      document.dispatchEvent(pointed);
    });
    expect(pointed.defaultPrevented).toBe(true);
    expect(tip()).toBeNull();

    fireEvent.keyDown(window, { key: 'Tab' });
    act(() => button('Close tasks').focus());
    expect(tip()).not.toBeNull();
    const focused = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    act(() => {
      document.dispatchEvent(focused);
    });
    // The shell still sees it (it closes the drawer), and the tooltip goes too.
    expect(focused.defaultPrevented).toBe(false);
    expect(tip()).toBeNull();
  });

  it('goes when the button is pressed or the page scrolls', () => {
    page();
    fireEvent.pointerOver(button('Close tasks'));
    wait(TIP_DELAY_MS);
    fireEvent.pointerDown(button('Close tasks'));
    expect(tip()).toBeNull();
    fireEvent.pointerOver(button('Favourite: Renew the contract'));
    wait(TIP_DELAY_MS);
    fireEvent.scroll(window);
    expect(tip()).toBeNull();
  });

  it('goes when its button leaves the page', () => {
    const { rerender } = page();
    fireEvent.pointerOver(button('Close tasks'));
    wait(TIP_DELAY_MS);
    rerender(<Page close={false} />);
    wait(250);
    expect(tip()).toBeNull();
  });

  it('never shows for a button that left the page while its wait ran', () => {
    const { rerender } = page();
    fireEvent.pointerOver(button('Close tasks'));
    rerender(<Page close={false} />);
    wait(TIP_DELAY_MS);
    expect(tip()).toBeNull();
  });

  it("names the rail's icons too", () => {
    page();
    fireEvent.pointerOver(document.querySelector('[data-tip="Home"]') as HTMLElement);
    wait(TIP_DELAY_MS);
    expect(tip()?.textContent).toBe('Home');
  });

  it('shows nothing for a button that lost its data-tip while its wait ran (the rail widening)', () => {
    page();
    const home = document.querySelector('[data-tip="Home"]') as HTMLElement;
    home.setAttribute('aria-label', 'Home, with a long name');
    fireEvent.pointerOver(home);
    wait(200);
    // The rail widened: the name is visible, so the item drops its data-tip but keeps its aria-label.
    home.removeAttribute('data-tip');
    wait(TIP_DELAY_MS);
    expect(tip()).toBeNull();
  });

  it('stays when something else scrolls (a chat streaming a reply), and goes when its own list scrolls', () => {
    render(
      <>
        <Tooltips />
        <div className="list">
          <button type="button" className="icon-btn" aria-label="Edit">
            e
          </button>
        </div>
        <div className="thread" />
      </>,
    );
    fireEvent.pointerOver(button('Edit'));
    wait(TIP_DELAY_MS);
    fireEvent.scroll(document.querySelector('.thread') as HTMLElement);
    expect(tip()?.textContent).toBe('Edit');
    fireEvent.scroll(document.querySelector('.list') as HTMLElement);
    expect(tip()).toBeNull();
    // A wait still running for a button is not cut short by another scroller either, but is by its own list.
    fireEvent.pointerOver(button('Edit'));
    fireEvent.scroll(document.querySelector('.thread') as HTMLElement);
    wait(TIP_DELAY_MS);
    expect(tip()?.textContent).toBe('Edit');
    fireEvent.pointerDown(document.body);
    fireEvent.pointerOver(button('Edit'));
    fireEvent.scroll(document.querySelector('.list') as HTMLElement);
    wait(TIP_DELAY_MS);
    expect(tip()).toBeNull();
  });

  it('takes a new name, and goes when the button no longer wants one', () => {
    page();
    fireEvent.keyDown(window, { key: 'Tab' });
    const fav = button('Favourite: Renew the contract');
    act(() => fav.focus());
    expect(tip()?.textContent).toBe('Favourite');
    fav.dataset.tip = 'Favourited';
    wait(250);
    expect(tip()?.textContent).toBe('Favourited');
    delete fav.dataset.tip;
    fav.removeAttribute('aria-label');
    wait(250);
    expect(tip()).toBeNull();
  });

  it('goes when its button is hidden or made inert, on Enter or Space, and on resize', () => {
    page();
    const show = () => {
      fireEvent.pointerOver(button('Close tasks'));
      wait(TIP_DELAY_MS);
      expect(tip()).not.toBeNull();
      fireEvent.pointerOut(button('Close tasks'), { relatedTarget: document.body });
      wait(HOVER_GRACE_MS);
    };
    fireEvent.pointerOver(button('Close tasks'));
    wait(TIP_DELAY_MS);
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(tip()).toBeNull();
    fireEvent.pointerOut(button('Close tasks'), { relatedTarget: document.body });
    show();
    fireEvent.pointerOver(button('Close tasks'));
    wait(TIP_DELAY_MS);
    fireEvent(window, new Event('resize'));
    expect(tip()).toBeNull();
    fireEvent.pointerOut(button('Close tasks'), { relatedTarget: document.body });
    fireEvent.pointerOver(button('Close tasks'));
    wait(TIP_DELAY_MS);
    button('Close tasks').parentElement?.setAttribute('inert', '');
    wait(250);
    expect(tip()).toBeNull();
  });

  it('keeps a pointed-at tooltip when focus leaves the button, and ignores touch leaving', () => {
    page();
    fireEvent.pointerOver(button('Close tasks'));
    wait(TIP_DELAY_MS);
    act(() => button('Close tasks').focus());
    act(() => button('Close tasks').blur());
    expect(tip()).not.toBeNull();
    fireEvent.pointerOut(button('Close tasks'), { relatedTarget: document.body, pointerType: 'touch' });
    wait(HOVER_GRACE_MS);
    expect(tip()).not.toBeNull();
  });

  it('keeps showing when the pointer goes from the tooltip back to its button', () => {
    page();
    fireEvent.pointerOver(button('Close tasks'));
    wait(TIP_DELAY_MS);
    const t = tip() as HTMLElement;
    fireEvent.pointerOut(button('Close tasks'), { relatedTarget: t });
    fireEvent.pointerOut(t, { relatedTarget: button('Close tasks') });
    fireEvent.pointerOver(button('Close tasks'));
    wait(HOVER_GRACE_MS * 2);
    expect(tip()).not.toBeNull();
  });

  it('shows nothing on focus of something inside a button, only on the button itself', () => {
    render(
      <>
        <Tooltips />
        <button type="button" className="icon-btn" aria-label="Edit">
          <input aria-label="inside" />
        </button>
      </>,
    );
    fireEvent.keyDown(window, { key: 'Tab' });
    act(() => (document.querySelector('input') as HTMLElement).focus());
    expect(tip()).toBeNull();
  });

  it('shows nothing for a button whose words are on show (Stop on a wide sheet)', () => {
    render(
      <>
        <Tooltips />
        <button type="button" className="btn" data-tip="Stop">
          <span className="btn-label">Stop</span>
        </button>
      </>,
    );
    const label = document.querySelector('.btn-label') as HTMLElement;
    const stop = label.parentElement as HTMLElement;
    label.getBoundingClientRect = () => ({ width: 30, height: 16 }) as DOMRect;
    fireEvent.pointerOver(stop);
    wait(TIP_DELAY_MS);
    expect(tip()).toBeNull();
    // Narrow: the word is hidden, so the tooltip names it.
    label.getBoundingClientRect = () => ({ width: 1, height: 1 }) as DOMRect;
    fireEvent.pointerOut(stop, { relatedTarget: document.body });
    fireEvent.pointerOver(stop);
    wait(TIP_DELAY_MS);
    expect(tip()?.textContent).toBe('Stop');
  });

  describe('where it sits', () => {
    const rect = (r: { left: number; top: number; width: number; height: number }) =>
      ({ ...r, right: r.left + r.width, bottom: r.top + r.height, x: r.left, y: r.top }) as DOMRect;
    beforeEach(() => {
      vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(80);
      vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(20);
      vi.stubGlobal('innerWidth', 1000);
      vi.stubGlobal('innerHeight', 600);
    });
    afterEach(() => {
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    });
    const place = (el: HTMLElement, r: Parameters<typeof rect>[0]) => {
      el.getBoundingClientRect = () => rect(r);
      fireEvent.pointerOver(el);
      wait(TIP_DELAY_MS);
      const t = tip() as HTMLElement;
      return { left: Number.parseFloat(t.style.left), top: Number.parseFloat(t.style.top) };
    };

    it('centres under the button, 6px below', () => {
      page();
      expect(place(button('Close tasks'), { left: 500, top: 100, width: 28, height: 28 })).toEqual({
        left: 474,
        top: 134,
      });
    });

    it('goes above when there is no room below, and stays 8px inside the window', () => {
      page();
      expect(place(button('Close tasks'), { left: 980, top: 570, width: 28, height: 28 })).toEqual({
        left: 912,
        top: 544,
      });
    });

    it('follows its button when the button moves (the rail widening)', () => {
      page();
      const el = button('Close tasks');
      place(el, { left: 500, top: 100, width: 28, height: 28 });
      el.getBoundingClientRect = () => rect({ left: 600, top: 100, width: 28, height: 28 });
      wait(250);
      expect(Number.parseFloat((tip() as HTMLElement).style.left)).toBe(574);
    });

    it("sits to the right of the rail's icons, centred on them", () => {
      page();
      const home = document.querySelector('[data-tip="Home"]') as HTMLElement;
      expect(place(home, { left: 20, top: 100, width: 40, height: 40 })).toEqual({ left: 74, top: 110 });
    });

    it('sits to the left of a full-height edge handle (data-tip-side="left"), centred on it', () => {
      page();
      // The viewer's resize strip runs the window's height: under or above it would be off by the top.
      const strip = document.createElement('div');
      strip.dataset.tip = 'Drag to resize. Double-click to reset.';
      strip.dataset.tipSide = 'left';
      document.body.append(strip);
      expect(place(strip, { left: 400, top: 0, width: 20, height: 600 })).toEqual({ left: 314, top: 290 });
      strip.remove();
    });
  });
});
