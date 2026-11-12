import { useEffect } from 'react';
import type { AttachmentInfo } from '../../../shared/contract.ts';
import { Icon } from '../shell/Icon.tsx';
import { type AttachmentChip, formatSize, iconFor } from '../state/attachments.ts';

/** A long name is cut in the middle, so the end (and the extension) always shows. */
function FileName({ name }: { name: string }) {
  if (name.length <= 24) return <span className="file-name">{name}</span>;
  return (
    <span className="file-name">
      <span className="file-name-start">{name.slice(0, -8)}</span>
      <span className="file-name-end">{name.slice(-8)}</span>
    </span>
  );
}

/** A file tag. With `onRemove` it is editable (on the composer); without, it is read-only (in a sent message). */
export function FileChip({
  file,
  status = 'ready',
  message,
  onRemove,
}: {
  file: AttachmentInfo;
  status?: AttachmentChip['status'];
  message?: string;
  onRemove?: () => void;
}) {
  return (
    <span
      className="chip file-chip"
      data-status={status}
      title={status === 'error' && message ? `${file.name}: ${message}` : file.name}
    >
      {status === 'uploading' ? (
        <span className="spinner file-spinner" aria-hidden="true" />
      ) : (
        <Icon name={iconFor(file.name, file.kind)} size={14} />
      )}
      <FileName name={file.name} />
      {status === 'error' ? (
        <span className="file-note" data-error="true">
          Can't attach
        </span>
      ) : (
        <span className="file-note">{status === 'uploading' ? 'Uploading' : formatSize(file.size)}</span>
      )}
      {onRemove ? (
        <button type="button" className="chip-remove" aria-label={`Remove ${file.name}`} onClick={onRemove}>
          <Icon name="close" size={12} />
        </button>
      ) : null}
    </span>
  );
}

/** Read-only files on a sent message. */
export function SentFiles({ files }: { files: AttachmentInfo[] }) {
  return (
    <ul className="sent-files" aria-label="Attached files">
      {files.map((f, i) => (
        // Names can repeat within one message, so the position is part of the key.
        // biome-ignore lint/suspicious/noArrayIndexKey: the list never reorders.
        <li key={`${i}-${f.name}`}>
          <FileChip file={f} />
        </li>
      ))}
    </ul>
  );
}

/** True when a drag carries files (not text or a link). */
export function dragHasFiles(e: { dataTransfer: DataTransfer | null }): boolean {
  return Array.from(e.dataTransfer?.types ?? []).includes('Files');
}

/**
 * A file dropped outside a drop target would make the browser open it and leave the app.
 * Stopped once, on the whole window.
 */
export function useBlockStrayDrops() {
  useEffect(() => {
    const stop = (e: DragEvent) => {
      if (dragHasFiles(e)) e.preventDefault();
    };
    window.addEventListener('dragover', stop);
    window.addEventListener('drop', stop);
    return () => {
      window.removeEventListener('dragover', stop);
      window.removeEventListener('drop', stop);
    };
  }, []);
}
