import { type ReactElement, type RefObject, useCallback, useEffect, useRef, useState } from 'react';
import { MAX_UPLOAD_BYTES } from '../../../../shared/contract.ts';
import {
  LIBRARY_UPLOAD_MESSAGES,
  LIBRARY_UPLOAD_TYPES,
  type LibraryUploadResponse,
} from '../../../../shared/library-upload-contract.ts';
import { PROJECT_LINKS_MAX, type ProjectCard } from '../../../../shared/projects-contract.ts';
import { api, discardUpload, uploadFile } from '../../api.ts';
import { Icon } from '../../shell/Icon.tsx';
import { useProjects } from '../../state/projects.ts';
import { useStore } from '../../store.tsx';
import type { LibraryData } from './data.ts';

/** Every type a library upload may have, as an `accept` list (".pdf,.png,…"). */
export const LIBRARY_ACCEPT = LIBRARY_UPLOAD_TYPES.map((e) => `.${e}`).join(',');

/** Most files taken in one go. */
export const UPLOAD_MAX_FILES = 10;

const TYPES_SENTENCE =
  'Only PNG, JPG, WebP, GIF, PDF, Word, Excel, PowerPoint, CSV, Markdown and text files can be added.';
const MAX_MB = Math.round(MAX_UPLOAD_BYTES / (1024 * 1024));

/** Where files go, fixed when they are chosen: a library (by scope id and its name) or a project's card. */
export type UploadTarget =
  | { kind: 'library'; scope: string; name: string }
  | { kind: 'project'; card: ProjectCard };

/** What the upload says: `info` is progress or success, `warn` is saved-but-not-linked, `error` is a refusal. */
export interface UploadStatus {
  text: string;
  level: 'info' | 'warn' | 'error';
}

const QUIET: UploadStatus = { text: '', level: 'info' };

/** The extension of a file name, lower case, no dot ('' when there is none). */
function extOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(i + 1).toLowerCase() : '';
}

/** "Acme Heating's Documents", "Acme Heating's Documents and Images", "your personal files". */
function whereWords(
  saved: LibraryUploadResponse[],
  nameOf: (res: LibraryUploadResponse) => string,
): { where: string; personal: boolean } {
  const owners = new Map<string, { personal: boolean; docs: boolean; images: boolean }>();
  for (const s of saved) {
    const key = s.personal ? 'personal' : nameOf(s);
    const o = owners.get(key) ?? { personal: s.personal, docs: false, images: false };
    if (s.kind === 'image') o.images = true;
    else o.docs = true;
    owners.set(key, o);
  }
  const parts = [...owners.entries()].map(([name, o]) => {
    if (o.personal) return 'your personal files';
    const apps = o.docs && o.images ? 'Documents and Images' : o.images ? 'Images' : 'Documents';
    return `${name}'s ${apps}`;
  });
  return { where: parts.join(' and '), personal: [...owners.values()].some((o) => o.personal) };
}

/**
 * Uploads files into a library or a project, one at a time, stopping at the first failure. The target is
 * passed with the files (so it is the one in force when they were chosen) and used for all of them.
 * Plan 2026-11-26-file-types-and-uploads.
 */
export function useLibraryUpload() {
  const { boot } = useStore();
  const { apply } = useProjects();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<UploadStatus>(QUIET);
  const running = useRef(false);
  const clients = boot?.clients ?? [];

  const upload = useCallback(
    async (chosen: File[], target: UploadTarget): Promise<void> => {
      if (running.current || chosen.length === 0) return;
      if (chosen.length > UPLOAD_MAX_FILES) {
        setStatus({ text: `Choose up to ${UPLOAD_MAX_FILES} files at a time.`, level: 'error' });
        return;
      }
      const files: File[] = [];
      const problems: string[] = [];
      for (const f of chosen) {
        if (!LIBRARY_UPLOAD_TYPES.includes(extOf(f.name)))
          problems.push(`"${f.name}" wasn't added: that type can't be added.`);
        else if (f.size > MAX_UPLOAD_BYTES)
          problems.push(`"${f.name}" wasn't added: it is over ${MAX_MB} MB.`);
        else files.push(f);
      }
      if (problems.some((p) => p.includes('that type'))) problems.push(TYPES_SENTENCE);
      const rejected = problems.length > 0 ? ` ${problems.join(' ')}` : '';
      if (files.length === 0) {
        setStatus({ text: problems.join(' '), level: 'error' });
        return;
      }
      if (target.kind === 'project' && target.card.links.length + files.length > PROJECT_LINKS_MAX) {
        setStatus({ text: LIBRARY_UPLOAD_MESSAGES.projectFull, level: 'error' });
        return;
      }

      running.current = true;
      setBusy(true);
      let expect = target.kind === 'project' ? target.card.version : '';
      const saved: LibraryUploadResponse[] = [];
      let failure: { name: string; message: string } | null = null;
      let notLinked: string | null = null;
      for (const [i, file] of files.entries()) {
        setStatus({
          text: files.length === 1 ? `Adding ${file.name}…` : `Adding ${i + 1} of ${files.length}…`,
          level: 'info',
        });
        let uploadId: string | null = null;
        try {
          const info = await uploadFile(file, file.name);
          uploadId = info.id;
          const res = await api.libraryUpload(
            target.kind === 'library'
              ? { upload: info.id, scope: target.scope }
              : { upload: info.id, project: target.card.key, expect },
          );
          saved.push(res);
          if (target.kind === 'project') {
            // Saved but not linked is an answer, not an error: say so and stop. Never retry (it would save a copy).
            if (res.linked === false) {
              notLinked = res.problem ?? LIBRARY_UPLOAD_MESSAGES.savedNotLinked('the library');
              break;
            }
            if (res.list) apply(res.list);
            const fresh = res.list?.projects.find((p) => p.key === target.card.key)?.version;
            if (!fresh && i < files.length - 1) {
              failure = {
                name: files[i + 1]?.name ?? file.name,
                message: 'This project is no longer in your list, so the rest were not added.',
              };
              break;
            }
            if (fresh) expect = fresh;
          }
        } catch (err) {
          if (uploadId) void discardUpload(uploadId);
          failure = {
            name: file.name,
            message: err instanceof Error ? err.message : 'The file could not be sent.',
          };
          break;
        }
      }
      running.current = false;
      setBusy(false);

      if (notLinked !== null) {
        const before = saved.length - 1;
        setStatus({
          text: `${before > 0 ? `${before} of ${files.length} added. ` : ''}${notLinked}${rejected}`,
          level: 'warn',
        });
        return;
      }
      if (failure) {
        const fail = `"${failure.name}" couldn't be added: ${failure.message}`;
        setStatus({
          text: `${saved.length > 0 ? `${saved.length} of ${files.length} added. ${fail}` : fail}${rejected}`,
          level: 'error',
        });
        return;
      }
      const nameOf = (res: LibraryUploadResponse) => {
        const slug = res.scope.startsWith('client:') ? res.scope.slice('client:'.length) : res.scope;
        if (target.kind === 'library') return target.name;
        return clients.find((c) => c.slug === slug)?.name ?? slug;
      };
      const { where, personal } = whereWords(saved, nameOf);
      const tail = personal ? ' Only this Mac has it.' : '';
      const last = saved[saved.length - 1];
      const what =
        saved.length === 1 && last ? (last.path.split('/').pop() ?? 'file') : `${saved.length} files`;
      const text =
        target.kind === 'project'
          ? `Added ${what} to this project. Saved in ${where}.${tail}`
          : `Added ${what} to ${where}.${tail}`;
      setStatus({ text: `${text}${rejected}`, level: 'info' });
    },
    [apply, clients],
  );

  const clear = useCallback(() => setStatus(QUIET), []);
  return { busy, status, upload, clear };
}

export interface FilePicker {
  /** Opens the system's file chooser. */
  open: () => void;
  /** The hidden input. Render it once, after the last button in the row. */
  input: ReactElement;
  ref: RefObject<HTMLInputElement | null>;
}

/** A hidden multiple-file input and the way to open it. The value is reset after a pick so the same file can be chosen again. */
export function useFilePicker(onFiles: (files: File[]) => void): FilePicker {
  const ref = useRef<HTMLInputElement>(null);
  const input = (
    <input
      ref={ref}
      type="file"
      multiple
      hidden
      tabIndex={-1}
      aria-hidden="true"
      accept={LIBRARY_ACCEPT}
      data-upload-input=""
      onChange={(e) => {
        const files = [...(e.target.files ?? [])];
        e.target.value = '';
        if (files.length > 0) onFiles(files);
      }}
    />
  );
  return { open: () => ref.current?.click(), input, ref };
}

/** "Upload", with hidden words naming where the files go. `aria-disabled` while busy, label unchanged. */
export function UploadButton({
  destination,
  busy,
  picker,
  primary,
  small,
}: {
  /** "Acme Heating's library" or the project's title: read as "Upload to …". */
  destination: string;
  busy: boolean;
  picker: FilePicker;
  primary?: boolean;
  small?: boolean;
}) {
  return (
    <button
      type="button"
      className="btn"
      data-variant={primary ? 'primary' : undefined}
      data-size={small ? 'small' : undefined}
      data-focus="upload"
      aria-disabled={busy || undefined}
      onClick={() => {
        if (!busy) picker.open();
      }}
    >
      <Icon name="plus" size={small ? 14 : 16} />
      Upload <span className="visually-hidden">to {destination}</span>
    </button>
  );
}

/** The button and its input together, for Documents and Images (the project tab places its input itself). */
export function UploadAction({
  destination,
  busy,
  onFiles,
}: {
  destination: string;
  busy: boolean;
  onFiles: (files: File[]) => void;
}) {
  const picker = useFilePicker(onFiles);
  return (
    <>
      <UploadButton destination={destination} busy={busy} picker={picker} primary />
      {picker.input}
    </>
  );
}

/** Whether a project can take uploads right now (the page's own rule, repeated by Documents and Images). */
export function canUploadToProject(
  list: { canChange: boolean; canUploadFiles?: boolean } | null,
  card: ProjectCard | undefined,
): card is ProjectCard {
  return (
    list?.canChange === true &&
    list.canUploadFiles === true &&
    card !== undefined &&
    !card.archived &&
    card.card === 'ok' &&
    card.space !== 'legacy'
  );
}

/**
 * The Upload button and status for Documents and Images. Narrowed to a project (by the app's filter or Home's
 * picker) it uploads to that project and never uses the Library picker's scope; otherwise to the library on
 * screen, when the listing says the person may.
 */
export function useSheetUpload(data: Pick<LibraryData, 'canUpload' | 'project' | 'scope' | 'scopeName'>): {
  actions: ReactElement | null;
  status: UploadStatus;
} {
  const { list } = useProjects();
  const { busy, status, upload, clear } = useLibraryUpload();
  // Another library's or project's words don't carry over (a run still going keeps its own).
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the library or project on screen changes.
  useEffect(() => {
    if (!busy) clear();
  }, [data.scope, data.project]);
  let target: UploadTarget | null = null;
  let destination = '';
  if (data.project) {
    const card = list?.projects.find((p) => p.key === data.project);
    if (canUploadToProject(list, card)) {
      target = { kind: 'project', card };
      destination = card.title || 'this project';
    }
  } else if (data.canUpload === true && data.scope) {
    target = { kind: 'library', scope: data.scope, name: data.scopeName || data.scope };
    destination = data.scope === 'personal' ? 'your personal files' : `${data.scopeName}'s library`;
  }
  const actions = target ? (
    <UploadAction destination={destination} busy={busy} onFiles={(files) => void upload(files, target)} />
  ) : null;
  return { actions, status };
}
