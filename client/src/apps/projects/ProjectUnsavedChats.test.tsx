// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { UnsavedChat } from '../../../../shared/chat-summary-contract.ts';

const api = vi.hoisted(() => ({ projectUnsavedChats: vi.fn() }));
vi.mock('../../api.ts', () => ({ api }));

const { ProjectUnsavedChats } = await import('./ProjectUnsavedChats.tsx');

const chat = (over: Partial<UnsavedChat> = {}): UnsavedChat => ({
  chat: '11111111-2222-3333-4444-555555555555',
  title: 'Fix the redirects',
  lastActive: '2026-11-23T14:05:00Z',
  savedAt: null,
  ...over,
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ProjectUnsavedChats', () => {
  it('lists chats with their last activity, and Save to project asks for the form', async () => {
    api.projectUnsavedChats.mockResolvedValue({
      canSave: true,
      chats: [chat(), chat({ chat: 'b', title: 'Second', savedAt: '2026-11-20T09:00:00Z' })],
    });
    const onSave = vi.fn();
    render(<ProjectUnsavedChats projectKey="skyseal/site" onSave={onSave} />);
    expect(await screen.findByText('Chats not saved yet')).toBeTruthy();
    expect(api.projectUnsavedChats).toHaveBeenCalledWith('skyseal/site');
    expect(screen.getByText('Last active 23 Nov 2026')).toBeTruthy();
    expect(screen.getByText('Last active 23 Nov 2026 · last saved 20 Nov 2026')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save to project: Fix the redirects' }));
    expect(onSave).toHaveBeenCalledWith({
      key: 'skyseal/site',
      chat: '11111111-2222-3333-4444-555555555555',
      title: 'Fix the redirects',
    });
  });

  it('shows nothing when there are no chats, when saving is not possible, or when the read fails', async () => {
    api.projectUnsavedChats.mockResolvedValueOnce({ canSave: true, chats: [] });
    const { container, rerender } = render(<ProjectUnsavedChats projectKey="a/b" onSave={vi.fn()} />);
    await waitFor(() => expect(api.projectUnsavedChats).toHaveBeenCalledTimes(1));
    expect(container.textContent).toBe('');

    api.projectUnsavedChats.mockResolvedValueOnce({ canSave: false, chats: [chat()] });
    rerender(<ProjectUnsavedChats projectKey="a/c" onSave={vi.fn()} />);
    await waitFor(() => expect(api.projectUnsavedChats).toHaveBeenCalledTimes(2));
    expect(container.textContent).toBe('');

    api.projectUnsavedChats.mockRejectedValueOnce(new Error('down'));
    rerender(<ProjectUnsavedChats projectKey="a/d" onSave={vi.fn()} />);
    await waitFor(() => expect(api.projectUnsavedChats).toHaveBeenCalledTimes(3));
    expect(container.textContent).toBe('');
  });
});
