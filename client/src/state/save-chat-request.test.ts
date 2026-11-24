import { afterEach, describe, expect, it, vi } from 'vitest';
import { saveChatRequest, takeSaveChatRequest } from './save-chat-request.ts';

const req = { key: 'acme/site', chat: '6127dcf1-a50e-43e0-bc6d-f370942a7e48', title: 'Pricing' };

afterEach(() => saveChatRequest.set(null));

describe('saveChatRequest', () => {
  it('holds a request and tells listeners when it changes', () => {
    const fn = vi.fn();
    const off = saveChatRequest.subscribe(fn);
    saveChatRequest.set(req);
    expect(saveChatRequest.get()).toEqual(req);
    expect(fn).toHaveBeenCalledTimes(1);
    off();
    saveChatRequest.set(null);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('takes and clears a request only for its own project', () => {
    saveChatRequest.set(req);
    expect(takeSaveChatRequest('acme/other')).toBeNull();
    expect(saveChatRequest.get()).toEqual(req);
    expect(takeSaveChatRequest('acme/site')).toEqual(req);
    expect(saveChatRequest.get()).toBeNull();
    expect(takeSaveChatRequest('acme/site')).toBeNull();
  });
});
