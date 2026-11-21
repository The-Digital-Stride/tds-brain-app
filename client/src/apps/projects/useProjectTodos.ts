import { useCallback, useEffect, useRef, useState } from 'react';
import type { ProjectKey, ProjectTodosResponse } from '../../../../shared/projects-contract.ts';
import { api } from '../../api.ts';

export interface ProjectTodosState {
  /** null until the first answer for this project. */
  data: ProjectTodosResponse | null;
  error: boolean;
  reload: () => Promise<void>;
}

/** Every open to-do in one project (the server reads them for everyone). Reloads when `stamp` changes. */
export function useProjectTodos(key: ProjectKey, stamp: unknown): ProjectTodosState {
  const [data, setData] = useState<ProjectTodosResponse | null>(null);
  const [error, setError] = useState(false);
  const latest = useRef(key);
  latest.current = key;

  const reload = useCallback(async () => {
    const asked = key;
    try {
      const res = await api.projectTodos(asked);
      if (latest.current !== asked) return;
      setData(res);
      setError(false);
    } catch {
      if (latest.current === asked) setError(true);
    }
  }, [key]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `stamp` is the "something changed" signal.
  useEffect(() => {
    setData((d) => d);
    void reload();
  }, [reload, stamp]);

  return { data, error, reload };
}
