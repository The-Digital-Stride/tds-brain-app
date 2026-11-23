import { useState } from 'react';
import { api } from '../../api.ts';
import { useShell } from '../../shell/ShellProvider.tsx';
import { adsErrorText } from './words.ts';

/**
 * A report, PDF or notes file: asks the server for it as a library item, then opens it in the file viewer without
 * delete. JSON, CSV and anything the viewer can't show are downloaded instead.
 */
/** `name`: a fuller accessible name when several buttons share one label ("Open result: Spend & anomaly check"). */
export function OpenFile({ path, label, name }: { path: string; label: string; name?: string }) {
  const { dispatch } = useShell();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const download = /\.(json|csv)$/i.test(path);
  const press = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const item = await api.adsFile(path);
      if (download || !item.view) {
        const a = document.createElement('a');
        a.href = `/api/library/file/${encodeURIComponent(item.id)}`;
        a.download = item.name;
        document.body.append(a);
        a.click();
        a.remove();
      } else {
        dispatch({ type: 'open-viewer', viewer: { kind: 'file', item: { ...item, canDelete: false } } });
      }
    } catch (err) {
      setError(adsErrorText(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <span className="am-open">
      <button
        type="button"
        className="btn"
        data-size="small"
        aria-disabled={busy || undefined}
        aria-label={name}
        onClick={() => void press()}
      >
        {download ? `Download ${label.toLowerCase()}` : label}
      </button>
      {error ? (
        <span className="error" role="alert">
          {' '}
          {error}
        </span>
      ) : null}
    </span>
  );
}
