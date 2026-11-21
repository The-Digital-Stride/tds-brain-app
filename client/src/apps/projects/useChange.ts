import { useCallback } from 'react';
import type { ProjectAction } from '../../../../shared/projects-contract.ts';
import { ApiFailure, api } from '../../api.ts';
import { useProjects } from '../../state/projects.ts';
import { errorWords } from './logic.ts';

export type ChangeResult = { ok: true } | { ok: false; code: string; message: string };

/** Sends one project change, puts the fresh list into the shared cache, and turns a refusal into plain words. */
export function useProjectChange(): (action: ProjectAction) => Promise<ChangeResult> {
  const { apply } = useProjects();
  return useCallback(
    async (action) => {
      try {
        apply(await api.changeProject(action));
        return { ok: true };
      } catch (err) {
        if (err instanceof ApiFailure)
          return { ok: false, code: err.code, message: errorWords(err.code, err.message) };
        return { ok: false, code: 'internal', message: errorWords('internal') };
      }
    },
    [apply],
  );
}
