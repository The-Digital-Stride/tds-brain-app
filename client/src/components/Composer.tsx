import { type RefObject, useCallback, useEffect, useRef, useState } from 'react';
import { type Attention, MAX_ATTACHMENTS, type SkillInfo, UPLOAD_TYPES } from '../../../shared/contract.ts';
import { discardUpload, uploadFile } from '../api.ts';
import { Icon } from '../shell/Icon.tsx';
import {
  type AttachmentChip,
  checkFile,
  kindOfName,
  pastedName,
  pasteShouldAttach,
  summarise,
} from '../state/attachments.ts';
import { isClearCommand } from '../state/close.ts';
import { dragHasFiles, FileChip } from './Attachments.tsx';

const MAX_PARALLEL_UPLOADS = 4;

const ACCEPT = Object.keys(UPLOAD_TYPES)
  .map((ext) => `.${ext}`)
  .join(',');

export interface ComposerProps {
  initial: string;
  /** A skill chosen to start this chat. It is sent as `/name` in front of the text. */
  skill: SkillInfo | null;
  disabledReason: string | null;
  /** `uploadIds` are the attached files, already on the server. Text may be empty when there are files. */
  onSend: (text: string, uploadIds: string[]) => Promise<boolean>;
  /**
   * What accepts dropped files. Defaults to the message box itself; a chat passes its whole
   * column. The box marks it `data-drop` while files are dragged over.
   */
  dropZone?: RefObject<HTMLElement | null>;
  /** True when files can't be attached (a chat that has ended). */
  attachDisabled?: boolean;
  autoFocus: boolean;
  /** Changes when focus should come back here (after an approval or answer). */
  focusSignal: number;
  /** Colours the ring round the box. null for a chat that has stopped, or a new chat. */
  attention?: Attention | null;
}

export function Composer({
  initial,
  skill: initialSkill,
  disabledReason,
  onSend,
  autoFocus,
  focusSignal,
  attention = null,
  dropZone,
  attachDisabled = false,
}: ComposerProps) {
  const [text, setText] = useState(initial);
  const [skill, setSkill] = useState(initialSkill);
  const [sending, setSending] = useState(false);
  const [files, setFiles] = useState<AttachmentChip[]>([]);
  const [announce, setAnnounce] = useState('');
  const [dragging, setDragging] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const filesRef = useRef<AttachmentChip[]>([]);
  const mounted = useRef(true);
  const sayTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Ids that went with a message being sent; the unmount clean-up must not discard these.
  const inFlight = useRef<Set<string>>(new Set());
  // Read-only, not disabled, so the box can still take focus and its reason can be read.
  const blocked = disabledReason !== null || sending;
  const { uploading, errored, ready } = summarise(files);
  const canSend =
    !blocked && uploading === 0 && errored === 0 && (text.trim() !== '' || skill !== null || ready > 0);

  // Every change goes through here, so the ref and the state stay in step and a queued update
  // from a finishing upload is never overwritten.
  const mutate = useCallback((fn: (cur: AttachmentChip[]) => AttachmentChip[]) => {
    filesRef.current = fn(filesRef.current);
    setFiles(fn);
  }, []);

  const update = useCallback(
    (localId: string, patch: Partial<AttachmentChip>) =>
      mutate((cur) => cur.map((c) => (c.localId === localId ? { ...c, ...patch } : c))),
    [mutate],
  );

  // A live region only speaks again when its text changes, so it is cleared first.
  const say = useCallback((message: string) => {
    setAnnounce('');
    if (sayTimer.current) clearTimeout(sayTimer.current);
    sayTimer.current = setTimeout(() => setAnnounce(message), 40);
  }, []);

  // The app takes a few uploads at once; the rest wait here.
  const queue = useRef<Array<{ localId: string; file: File; name: string }>>([]);
  const active = useRef(0);
  const attached = useRef(0);
  const pump = useCallback(() => {
    while (mounted.current && active.current < MAX_PARALLEL_UPLOADS) {
      const u = queue.current.shift();
      if (!u) break;
      // Removed while it waited.
      if (!filesRef.current.some((c) => c.localId === u.localId)) continue;
      active.current++;
      const settle = () => {
        active.current--;
        if (active.current === 0 && queue.current.length === 0 && attached.current > 0 && mounted.current) {
          const n = attached.current;
          say(`${n} ${n === 1 ? 'file' : 'files'} attached`);
        }
        if (active.current === 0 && queue.current.length === 0) attached.current = 0;
        pump();
      };
      uploadFile(u.file, u.name).then(
        (info) => {
          // Removed, or the box is gone, while it was going up: don't leave it behind.
          if (!mounted.current || !filesRef.current.some((c) => c.localId === u.localId)) {
            void discardUpload(info.id, true);
          } else {
            attached.current++;
            update(u.localId, {
              status: 'ready',
              serverId: info.id,
              name: info.name,
              size: info.size,
              kind: info.kind,
            });
          }
          settle();
        },
        (err: unknown) => {
          if (mounted.current) {
            const message = err instanceof Error ? err.message : 'This file could not be attached.';
            update(u.localId, { status: 'error', message });
            say(`${u.name}: ${message}`);
          }
          settle();
        },
      );
    }
  }, [update, say]);

  const addFiles = useCallback(
    (picked: Array<{ file: File | null; name: string; folder?: boolean }>) => {
      let count = filesRef.current.filter((c) => c.status !== 'error').length;
      const taken = filesRef.current.map((c) => c.name);
      const added: AttachmentChip[] = [];
      const uploads: Array<{ localId: string; file: File; name: string }> = [];
      const problems: string[] = [];
      for (const item of picked) {
        const localId = crypto.randomUUID();
        const size = item.file?.size ?? 0;
        const reason = item.folder
          ? "Folders can't be attached. Attach the files inside instead."
          : checkFile({ name: item.name, size }, count);
        if (reason || !item.file) {
          added.push({
            localId,
            name: item.name,
            size,
            kind: kindOfName(item.name),
            status: 'error',
            message: reason ?? 'This file could not be read.',
          });
          problems.push(`${item.name}: ${reason ?? 'This file could not be read.'}`);
          continue;
        }
        count++;
        taken.push(item.name);
        added.push({
          localId,
          name: item.name,
          size,
          kind: kindOfName(item.name),
          status: 'uploading',
        });
        uploads.push({ localId, file: item.file, name: item.name });
      }
      if (added.length === 0) return;
      mutate((cur) => [...cur, ...added]);
      if (problems.length > 0) say(problems.join(' '));
      queue.current.push(...uploads);
      pump();
    },
    [mutate, say, pump],
  );

  const addFileList = useCallback(
    (list: FileList | File[], items?: DataTransferItemList) => {
      const arr = Array.from(list);
      // A dropped folder shows up as an entry that is a directory.
      const folders: string[] = [];
      if (items) {
        for (const it of Array.from(items)) {
          const entry = it.kind === 'file' ? it.webkitGetAsEntry?.() : null;
          if (entry?.isDirectory) folders.push(entry.name);
        }
      }
      const real = arr.filter((f) => !folders.includes(f.name));
      const now = new Date();
      const names = filesRef.current.map((c) => c.name);
      addFiles([
        ...folders.map((name) => ({ file: null, name, folder: true })),
        ...real.map((file) => {
          let name = file.name;
          // A pasted screenshot arrives called "image.png"; give it a name worth reading.
          if (file.type.startsWith('image/') && (!name || /^image\.[a-z]+$/i.test(name))) {
            name = pastedName(file.type, now, names);
            names.push(name);
          }
          return { file, name };
        }),
      ]);
    },
    [addFiles],
  );

  const removeFile = (chip: AttachmentChip) => {
    mutate((cur) => cur.filter((c) => c.localId !== chip.localId));
    if (chip.serverId) void discardUpload(chip.serverId);
    area.current?.focus();
  };

  // Drop target: the box by default, or a wider area the parent chose.
  useEffect(() => {
    const target = dropZone?.current ?? box.current;
    if (!target || attachDisabled) return;
    let depth = 0;
    const enter = (e: DragEvent) => {
      if (!dragHasFiles(e)) return;
      e.preventDefault();
      depth++;
      setDragging(true);
    };
    const over = (e: DragEvent) => {
      if (!dragHasFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    };
    const leave = (e: DragEvent) => {
      if (!dragHasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const drop = (e: DragEvent) => {
      if (!dragHasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      if (e.dataTransfer) addFileList(e.dataTransfer.files, e.dataTransfer.items);
    };
    target.addEventListener('dragenter', enter);
    target.addEventListener('dragover', over);
    target.addEventListener('dragleave', leave);
    target.addEventListener('drop', drop);
    return () => {
      target.removeEventListener('dragenter', enter);
      target.removeEventListener('dragover', over);
      target.removeEventListener('dragleave', leave);
      target.removeEventListener('drop', drop);
      setDragging(false);
    };
  }, [dropZone, attachDisabled, addFileList]);

  // The ring and the "Drop files to attach" note are drawn by CSS from this mark on the target.
  useEffect(() => {
    const target = dropZone?.current ?? box.current;
    if (!target) return;
    if (dragging) target.setAttribute('data-drop', 'true');
    else target.removeAttribute('data-drop');
    return () => target.removeAttribute('data-drop');
  }, [dragging, dropZone]);

  // Files still waiting when the box goes away (another chat, a new one) are deleted.
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      queue.current = [];
      if (sayTimer.current) clearTimeout(sayTimer.current);
      for (const c of filesRef.current) {
        if (c.serverId && !inFlight.current.has(c.serverId)) void discardUpload(c.serverId, true);
      }
    };
  }, []);

  useEffect(() => {
    if (autoFocus && area.current) {
      area.current.focus();
      const n = area.current.value.length;
      area.current.setSelectionRange(n, n);
    }
  }, [autoFocus]);

  useEffect(() => {
    if (focusSignal > 0) area.current?.focus();
  }, [focusSignal]);

  const submit = async () => {
    if (!canSend) return;
    setSending(true);
    const body = skill ? `/${skill.name} ${text}`.trim() : text;
    const ids = files.flatMap((c) => (c.serverId ? [c.serverId] : []));
    for (const id of ids) inFlight.current.add(id);
    const ok = await onSend(body, ids);
    for (const id of ids) inFlight.current.delete(id);
    if (!mounted.current) return;
    setSending(false);
    if (ok) {
      // "/clear" is never sent, so its files were not used.
      if (isClearCommand(body)) for (const id of ids) void discardUpload(id, true);
      setText('');
      setSkill(null);
      mutate(() => []);
    }
    area.current?.focus();
  };

  return (
    // The box's border carries the chat's state (ready, working, needs your answer).
    <div className="composer" data-attention={attention ?? undefined} ref={box}>
      {skill || files.length > 0 ? (
        <div className="chip-row">
          {skill ? (
            <span className="chip">
              {skill.title}
              <button
                type="button"
                className="chip-remove"
                aria-label={`Remove ${skill.title}`}
                onClick={() => setSkill(null)}
              >
                <Icon name="close" size={12} />
              </button>
            </span>
          ) : null}
          {files.map((c) => (
            <FileChip
              key={c.localId}
              file={c}
              status={c.status}
              message={c.message}
              onRemove={() => removeFile(c)}
            />
          ))}
        </div>
      ) : null}
      {files
        .filter((c) => c.status === 'error')
        .map((c) => (
          <p className="attach-problem" key={c.localId}>
            {c.name}: {c.message}
          </p>
        ))}
      <textarea
        ref={area}
        className="composer-input"
        rows={1}
        value={text}
        readOnly={blocked}
        aria-disabled={blocked}
        aria-label="Message to Claude"
        aria-describedby={disabledReason ? 'composer-reason' : 'composer-hint'}
        // While blocked, the reason shows in the box too, so it doesn't look ready to type in.
        placeholder={
          disabledReason ?? (skill ? 'Add any detail, or just send' : 'Ask Claude anything about your work')
        }
        onChange={(e) => setText(e.target.value)}
        onPaste={(e) => {
          if (
            attachDisabled ||
            !pasteShouldAttach(e.clipboardData.files.length > 0, e.clipboardData.getData('text/plain'))
          )
            return;
          e.preventDefault();
          addFileList(e.clipboardData.files);
        }}
        onKeyDown={(e) => {
          // Enter that confirms a word in an input method must not send.
          if (e.nativeEvent.isComposing || e.keyCode === 229) return;
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            void submit();
          }
        }}
      />
      <div className="composer-foot">
        <input
          ref={picker}
          type="file"
          multiple
          hidden
          accept={ACCEPT}
          aria-label="Choose files to attach"
          tabIndex={-1}
          onChange={(e) => {
            if (e.target.files) addFileList(e.target.files);
            // So choosing the same file again still fires.
            e.target.value = '';
          }}
        />
        {attachDisabled ? null : (
          <button
            type="button"
            className="icon-btn attach-btn"
            aria-label={`Attach files, up to ${MAX_ATTACHMENTS}`}
            title={`Attach files (up to ${MAX_ATTACHMENTS})`}
            onClick={() => picker.current?.click()}
          >
            <Icon name="paperclip" />
          </button>
        )}
        {disabledReason ? (
          <p className="visually-hidden" id="composer-reason">
            {disabledReason}
          </p>
        ) : (
          <p className="composer-hint" id="composer-hint" data-wait={uploading > 0 || errored > 0}>
            {uploading > 0
              ? "Uploading files. Send will work when they're done."
              : errored === 1
                ? "Remove the file that can't be attached, then send."
                : errored > 1
                  ? "Remove the files that can't be attached, then send."
                  : 'Enter to send, Shift and Enter for a new line.'}
          </p>
        )}
        <p className="visually-hidden" role="status" aria-live="polite">
          {announce}
        </p>
        <button
          type="button"
          className="btn"
          data-variant="primary"
          disabled={!canSend}
          onClick={() => void submit()}
        >
          Send
        </button>
      </div>
    </div>
  );
}
