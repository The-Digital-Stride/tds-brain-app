import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TeamTodo } from '../../../shared/contract.ts';

const api = vi.hoisted(() => ({ teamTodo: vi.fn() }));
vi.mock('../api.ts', () => ({ api }));

const { teamTodoStore, primeTeamTodo } = await import('./team-todo.ts');

const item = (id: string): TeamTodo => ({
  key: `team:todo/${id}`,
  id,
  path: `todo/${id}`,
  title: 'Send the quote',
  assignee: 'ben-mcadam',
  assigneeName: 'Ben McAdam',
  due: null,
  details: '',
  version: 'v1',
  attachments: [],
  client: null,
  project: null,
  stage: null,
});
const KEY = 'team:todo/a.md';

afterEach(() => {
  teamTodoStore.reset();
  api.teamTodo.mockReset();
});

describe('teamTodoStore', () => {
  it('fetches a key once, by its plain id', async () => {
    api.teamTodo.mockResolvedValue(item('a.md'));
    teamTodoStore.ensure(KEY);
    teamTodoStore.ensure(KEY);
    expect(teamTodoStore.get(KEY).loading).toBe(true);
    await teamTodoStore.refresh(KEY);
    teamTodoStore.ensure(KEY);
    expect(api.teamTodo).toHaveBeenCalledTimes(1);
    expect(api.teamTodo).toHaveBeenCalledWith('a.md');
    expect(teamTodoStore.get(KEY)).toMatchObject({ loading: false, error: null, item: item('a.md') });
  });

  it('records a 404 as an error with no item', async () => {
    api.teamTodo.mockRejectedValue(
      Object.assign(new Error('That to-do could not be found.'), { status: 404 }),
    );
    teamTodoStore.ensure(KEY);
    await teamTodoStore.refresh(KEY);
    expect(teamTodoStore.get(KEY)).toEqual({
      item: null,
      loading: false,
      error: 'That to-do could not be found.',
    });
  });

  it('refreshes only keys already loaded, and drops a to-do that has gone', async () => {
    api.teamTodo.mockResolvedValueOnce(item('a.md'));
    teamTodoStore.ensure(KEY);
    await teamTodoStore.refresh(KEY);
    api.teamTodo.mockReset();
    api.teamTodo.mockRejectedValue(Object.assign(new Error('gone'), { status: 404 }));
    teamTodoStore.refreshLoaded();
    await vi.waitFor(() => expect(teamTodoStore.get(KEY).error).toBe('gone'));
    expect(teamTodoStore.get(KEY).item).toBeNull();
    expect(api.teamTodo).toHaveBeenCalledTimes(1);
    expect(teamTodoStore.get('team:todo/other.md')).toMatchObject({ item: null, loading: false });
  });
});

describe('a failed load', () => {
  it('is tried again by ensure and by primeTeamTodo, which shows it loading at once', async () => {
    api.teamTodo.mockRejectedValueOnce(new Error('offline'));
    await teamTodoStore.refresh(KEY);
    expect(teamTodoStore.get(KEY)).toMatchObject({ item: null, loading: false, error: 'offline' });
    api.teamTodo.mockResolvedValue(item('a.md'));
    primeTeamTodo(KEY);
    expect(teamTodoStore.get(KEY).loading).toBe(true);
    await teamTodoStore.refresh(KEY);
    expect(teamTodoStore.get(KEY).item?.id).toBe('a.md');
    expect(api.teamTodo).toHaveBeenCalledTimes(2);

    teamTodoStore.reset();
    api.teamTodo.mockReset();
    api.teamTodo.mockRejectedValueOnce(new Error('offline'));
    await teamTodoStore.refresh(KEY);
    api.teamTodo.mockResolvedValue(item('a.md'));
    teamTodoStore.ensure(KEY);
    expect(teamTodoStore.get(KEY).loading).toBe(true);
    await teamTodoStore.refresh(KEY);
    expect(api.teamTodo).toHaveBeenCalledTimes(2);
    expect(teamTodoStore.get(KEY).item?.id).toBe('a.md');
  });

  it('does not start a request that throws at once as a broken call: it is a failed load', async () => {
    api.teamTodo.mockImplementation(() => {
      throw new Error('boom');
    });
    expect(() => primeTeamTodo(KEY)).not.toThrow();
    await teamTodoStore.refresh(KEY);
    expect(teamTodoStore.get(KEY).error).toBe('boom');
  });
});
