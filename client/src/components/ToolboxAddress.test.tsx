// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TimeStatus } from '../../../shared/time-contract.ts';

const api = vi.hoisted(() => ({ timeStatus: vi.fn(), timeAddress: vi.fn() }));
vi.mock('../api.ts', () => ({ api }));
const { ToolboxAddress } = await import('./ToolboxAddress.tsx');

const status = (url: string | null, source: TimeStatus['address']['source']): TimeStatus => ({
  connection: { state: 'no-address' },
  address: { url, source },
  earliest: '2026-09-26',
  today: '2026-11-28',
});

beforeEach(() => {
  api.timeStatus.mockReset();
  api.timeAddress.mockReset();
});
afterEach(cleanup);

describe('Toolbox address', () => {
  it('shows the saved address and saves a new one', async () => {
    api.timeStatus.mockResolvedValue(status('http://localhost:3000', 'settings'));
    api.timeAddress.mockResolvedValue(status('https://toolbox.example', 'settings'));
    render(<ToolboxAddress />);
    const input = (await screen.findByLabelText('Toolbox address')) as HTMLInputElement;
    expect(input.value).toBe('http://localhost:3000');
    fireEvent.change(input, { target: { value: ' https://toolbox.example ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save address' }));
    await waitFor(() => expect(api.timeAddress).toHaveBeenCalledWith('https://toolbox.example'));
    await screen.findByText('Saved. Connect to Toolbox again from My day.');
  });

  it('clears the address when it is emptied', async () => {
    api.timeStatus.mockResolvedValue(status('http://localhost:3000', 'settings'));
    api.timeAddress.mockResolvedValue(status(null, 'default'));
    render(<ToolboxAddress />);
    fireEvent.change(await screen.findByLabelText('Toolbox address'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save address' }));
    await waitFor(() => expect(api.timeAddress).toHaveBeenCalledWith(null));
  });

  it('shows what the server refuses', async () => {
    api.timeStatus.mockResolvedValue(status(null, 'default'));
    api.timeAddress.mockRejectedValue(new Error('Use an address like https://toolbox.example.com.'));
    render(<ToolboxAddress />);
    fireEvent.change(await screen.findByLabelText('Toolbox address'), { target: { value: 'nope' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save address' }));
    await screen.findByText('Use an address like https://toolbox.example.com.');
  });

  it('is read-only, with no Save, when TDS_TOOLBOX_URL sets it', async () => {
    api.timeStatus.mockResolvedValue(status('http://localhost:3000', 'env'));
    render(<ToolboxAddress />);
    const input = (await screen.findByLabelText('Toolbox address')) as HTMLInputElement;
    expect(input.readOnly).toBe(true);
    expect(screen.queryByRole('button', { name: 'Save address' })).toBeNull();
    expect(screen.getByText(/TDS_TOOLBOX_URL/)).toBeTruthy();
  });

  it('shows nothing when this build has no time service', async () => {
    api.timeStatus.mockRejectedValue(
      Object.assign(new Error('There is nothing at that address.'), { status: 404 }),
    );
    const { container } = render(<ToolboxAddress />);
    await waitFor(() => expect(api.timeStatus).toHaveBeenCalled());
    expect(container.textContent).toBe('');
  });

  it('shows an alert, not nothing, when the status fails for another reason', async () => {
    api.timeStatus.mockRejectedValue(Object.assign(new Error('Server error'), { status: 500 }));
    render(<ToolboxAddress />);
    expect((await screen.findByRole('alert')).textContent).toMatch(/can't be loaded/);
  });

  it('announces a refusal as an alert', async () => {
    api.timeStatus.mockResolvedValue(status(null, 'default'));
    api.timeAddress.mockRejectedValue(new Error('Use an address like https://toolbox.example.com.'));
    render(<ToolboxAddress />);
    fireEvent.change(await screen.findByLabelText('Toolbox address'), { target: { value: 'nope' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save address' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/Use an address/);
  });
});
