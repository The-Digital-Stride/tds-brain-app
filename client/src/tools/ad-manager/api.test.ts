import { afterEach, describe, expect, it, vi } from 'vitest';
import { ADS_ERROR_MESSAGES } from '../../../../shared/ads-contract.ts';
import { api } from '../../api.ts';
import { adManagerTool } from './slot.ts';
import { loadAdsSummary } from './summary.ts';

afterEach(() => vi.unstubAllGlobals());

describe('apply over a broken connection', () => {
  it('reads as an unknown outcome and is not retried', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('failed'));
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      api.adsChange('apply', { client: 'acme', id: '20261110-01-x', confirmed: true }),
    ).rejects.toMatchObject({
      message: ADS_ERROR_MESSAGES['unknown-outcome'],
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('other changes keep the plain network message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('failed')));
    await expect(api.adsChange('dry-run', { client: 'acme', id: '20261110-01-x' })).rejects.toMatchObject({
      code: 'network',
    });
  });
});

describe('loadAdsSummary', () => {
  it('is null on a 404 (an older server)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 404 })));
    expect(await loadAdsSummary('sam')).toBeNull();
  });
});

describe('loadAdsSummary failures', () => {
  it('throws on a 500, so the store keeps what it had', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 500 })));
    await expect(loadAdsSummary('sam')).rejects.toBeTruthy();
  });

  it('is null when the bridge is unavailable', async () => {
    const body = JSON.stringify({ error: { code: 'unavailable', message: 'x' } });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body, { status: 503 })));
    expect(await loadAdsSummary('sam')).toBeNull();
  });

  it('throws on a network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('failed')));
    await expect(loadAdsSummary('sam')).rejects.toBeTruthy();
  });
});

describe('unknown-outcome output', () => {
  it('is carried on the failure', async () => {
    const body = JSON.stringify({ error: { code: 'unknown-outcome', message: 'm', output: 'RUN OUT' } });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body, { status: 504 })));
    await expect(api.adsChange('apply', { client: 'acme', id: 'x', confirmed: true })).rejects.toMatchObject({
      code: 'unknown-outcome',
      output: 'RUN OUT',
    });
  });
});

describe('slot', () => {
  it('shows when the summary says visible, with the waiting count as its badge', () => {
    const ads = { visible: true, me: null, sameIdentity: true, waiting: 3, clients: [] };
    expect(adManagerTool.visible({ ads })).toBe(true);
    expect(adManagerTool.badge?.({ ads })).toBe(3);
    expect(adManagerTool.visible({ ads: null })).toBe(false);
    expect(adManagerTool.search).not.toBeNull();
  });
});
