import { useCallback } from 'react';
import type { ProjectAction, ProjectList } from '../../../../shared/projects-contract.ts';
import { ApiFailure, api } from '../../api.ts';
import { useProjects } from '../../state/projects.ts';
import { errorWords } from './logic.ts';

export const CHANGED_RELOADED = "Someone changed this project. It's been reloaded, so try again.";

export type ChangeResult = { ok: true; list: ProjectList } | { ok: false; code: string; message: string };

/** Sends one project change, puts the fresh list into the shared cache, and turns a refusal into plain words. */
export function useProjectChange(
  opts: { reloadOnChanged?: boolean } = {},
): (action: ProjectAction) => Promise<ChangeResult> {
  const { apply, refresh } = useProjects();
  const reload = opts.reloadOnChanged === true;
  return useCallback(
    async (action) => {
      try {
        const list = await api.changeProject(action);
        apply(list);
        // The fresh list carries the card's new version, so a run of changes can chain them (Link several files).
        return { ok: true, list };
      } catch (err) {
        if (err instanceof ApiFailure && err.code === 'changed' && reload) {
          // Not in a form: nothing to keep, so reload quietly and ask for another try.
          await refresh();
          return { ok: false, code: 'changed', message: CHANGED_RELOADED };
        }
        if (err instanceof ApiFailure)
          return { ok: false, code: err.code, message: errorWords(err.code, err.message) };
        return { ok: false, code: 'internal', message: errorWords('internal') };
      }
    },
    [apply, refresh, reload],
  );
}
