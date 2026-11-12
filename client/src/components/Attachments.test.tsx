// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_UPLOAD_BYTES } from '../../../shared/contract.ts';
import { useBlockStrayDrops } from './Attachments.tsx';
import { Composer } from './Composer.tsx';
import { Transcript } from './Transcript.tsx';

const api = vi.hoisted(() => ({ uploadFile: vi.fn(), discardUpload: vi.fn() }));
vi.mock('../api.ts', () => api);

let counter = 0;
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
const info = (name: string, size = 100) => ({
  id: `id-${++counter}`,
  name,
  size,
  kind: /\.(png|jpe?g)$/.test(name) ? ('image' as const) : ('document' as const),
});

beforeEach(() => {
  counter = 0;
  api.uploadFile.mockReset();
  api.discardUpload.mockReset().mockResolvedValue(undefined);
  api.uploadFile.mockImplementation(async (file: File, name: string) => info(name, file.size));
});
afterEach(cleanup);

function setup(over: Partial<Parameters<typeof Composer>[0]> = {}) {
  const onSend = vi.fn().mockResolvedValue(true);
  const view = render(
    <Composer
      initial=""
      skill={null}
      disabledReason={null}
      onSend={onSend}
      autoFocus={false}
      focusSignal={0}
      {...over}
    />,
  );
  return { onSend, view, box: screen.getByLabelText('Message to Claude') };
}
const file = (name: string, size = 100, type = '') => new File([new Uint8Array(size)], name, { type });
const pick = (...files: File[]) =>
  fireEvent.change(screen.getByLabelText('Choose files to attach'), { target: { files } });
const sendButton = () => screen.getByRole('button', { name: 'Send' });

describe('picking files', () => {
  it('uploads them and shows chips', async () => {
    setup();
    pick(file('report.pdf', 2048));
    expect(screen.getByText("Uploading files. Send will work when they're done.")).toBeTruthy();
    await screen.findByText('2 KB');
    expect(api.uploadFile).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Remove report.pdf' })).toBeTruthy();
  });

  it('the paperclip opens the file picker', () => {
    setup();
    const input = screen.getByLabelText('Choose files to attach') as HTMLInputElement;
    const click = vi.spyOn(input, 'click');
    fireEvent.click(screen.getByRole('button', { name: 'Attach files, up to 10' }));
    expect(click).toHaveBeenCalled();
  });
});

describe('sending with files', () => {
  it('waits for uploads to finish', async () => {
    const d = deferred<ReturnType<typeof info>>();
    api.uploadFile.mockReturnValueOnce(d.promise);
    setup();
    pick(file('a.pdf'));
    expect(sendButton().hasAttribute('disabled')).toBe(true);
    expect(screen.getByText("Uploading files. Send will work when they're done.")).toBeTruthy();
    await act(async () => d.resolve(info('a.pdf')));
    await waitFor(() => expect(sendButton().hasAttribute('disabled')).toBe(false));
  });

  it('allows files only, passes the ids, and clears the chips', async () => {
    const { onSend } = setup();
    pick(file('a.pdf'), file('b.csv'));
    await waitFor(() => expect(sendButton().hasAttribute('disabled')).toBe(false));
    fireEvent.click(sendButton());
    await waitFor(() => expect(onSend).toHaveBeenCalledWith('', ['id-1', 'id-2']));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Remove a.pdf' })).toBeNull());
    expect(api.discardUpload).not.toHaveBeenCalled();
  });

  it('keeps the chips when the send fails', async () => {
    const onSend = vi.fn().mockResolvedValue(false);
    setup({ onSend });
    pick(file('a.pdf'));
    await waitFor(() => expect(sendButton().hasAttribute('disabled')).toBe(false));
    fireEvent.click(sendButton());
    await waitFor(() => expect(onSend).toHaveBeenCalled());
    expect(await screen.findByRole('button', { name: 'Remove a.pdf' })).toBeTruthy();
  });
});

describe('refused files', () => {
  it('shows the reason and blocks Send until removed', async () => {
    setup();
    fireEvent.change(screen.getByLabelText('Message to Claude'), { target: { value: 'Hi' } });
    pick(file('run.exe'));
    expect(screen.getAllByText(/can't pass on \.exe files/).length).toBeGreaterThan(0);
    expect(api.uploadFile).not.toHaveBeenCalled();
    expect(sendButton().hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Remove run.exe' }));
    expect(sendButton().hasAttribute('disabled')).toBe(false);
    // Nothing was on the server, so nothing to discard.
    expect(api.discardUpload).not.toHaveBeenCalled();
  });

  it('refuses a file over the size limit', () => {
    setup();
    pick(file('big.pdf', MAX_UPLOAD_BYTES + 1));
    expect(screen.getAllByText(/over 32 MB/).length).toBeGreaterThan(0);
    expect(api.uploadFile).not.toHaveBeenCalled();
  });

  it('shows the server reason when an upload fails', async () => {
    api.uploadFile.mockRejectedValueOnce(new Error('Your Mac is out of space.'));
    setup();
    pick(file('a.pdf'));
    expect(await screen.findAllByText(/a\.pdf: Your Mac is out of space\./)).not.toHaveLength(0);
    expect(sendButton().hasAttribute('disabled')).toBe(true);
  });

  it('refuses more files than a message can hold', async () => {
    setup();
    pick(...Array.from({ length: 11 }, (_, i) => file(`f${i}.pdf`)));
    await waitFor(() => expect(api.uploadFile).toHaveBeenCalledTimes(10));
    expect(screen.getAllByText(/up to 10 files/).length).toBeGreaterThan(0);
  });
});

describe('removing', () => {
  it('discards the upload on the server', async () => {
    setup();
    pick(file('a.pdf'));
    await screen.findByText('100 B');
    fireEvent.click(screen.getByRole('button', { name: 'Remove a.pdf' }));
    expect(api.discardUpload).toHaveBeenCalledWith('id-1');
    expect(screen.queryByText('100 B')).toBeNull();
  });

  it('discards an upload that finishes after its chip was removed', async () => {
    const d = deferred<ReturnType<typeof info>>();
    api.uploadFile.mockReturnValueOnce(d.promise);
    setup();
    pick(file('a.pdf'));
    fireEvent.click(screen.getByRole('button', { name: 'Remove a.pdf' }));
    await act(async () => d.resolve(info('a.pdf')));
    expect(api.discardUpload).toHaveBeenCalledWith('id-1', true);
  });

  it('discards unsent files when the box goes away', async () => {
    const { view } = setup();
    pick(file('a.pdf'));
    await screen.findByText('100 B');
    view.unmount();
    expect(api.discardUpload).toHaveBeenCalledWith('id-1', true);
  });

  it('discards the files of a /clear that is accepted', async () => {
    const { onSend, box } = setup();
    pick(file('a.pdf'));
    await screen.findByText('100 B');
    fireEvent.change(box, { target: { value: '/clear' } });
    fireEvent.click(sendButton());
    await waitFor(() => expect(onSend).toHaveBeenCalled());
    await waitFor(() => expect(api.discardUpload).toHaveBeenCalledWith('id-1', true));
  });
});

describe('drop and paste', () => {
  const dropData = (files: File[], types = ['Files']) => ({ dataTransfer: { files, types, items: [] } });

  it('drop adds files', async () => {
    const { view } = setup();
    const target = view.container.querySelector('.composer') as HTMLElement;
    fireEvent.dragEnter(target, dropData([file('a.pdf')]));
    expect(target.getAttribute('data-drop')).toBe('true');
    fireEvent.drop(target, dropData([file('a.pdf')]));
    expect(target.getAttribute('data-drop')).toBeNull();
    await screen.findByText('100 B');
    expect(api.uploadFile).toHaveBeenCalledTimes(1);
  });

  it('ignores drags that are not files', () => {
    const { view } = setup();
    const target = view.container.querySelector('.composer') as HTMLElement;
    fireEvent.dragEnter(target, dropData([], ['text/plain']));
    expect(target.getAttribute('data-drop')).toBeNull();
  });

  it('refuses a dropped folder', () => {
    const { view } = setup();
    const target = view.container.querySelector('.composer') as HTMLElement;
    const items = [{ kind: 'file', webkitGetAsEntry: () => ({ isDirectory: true, name: 'Skyseal' }) }];
    fireEvent.drop(target, { dataTransfer: { files: [file('Skyseal')], types: ['Files'], items } });
    expect(screen.getAllByText(/Folders can't be attached/).length).toBeGreaterThan(0);
    expect(api.uploadFile).not.toHaveBeenCalled();
  });

  it('paste names a pasted image and counts repeats', async () => {
    const { box } = setup();
    fireEvent.paste(box, {
      clipboardData: { files: [file('image.png', 10, 'image/png')], types: ['Files'], getData: () => '' },
    });
    fireEvent.paste(box, {
      clipboardData: { files: [file('image.png', 10, 'image/png')], types: ['Files'], getData: () => '' },
    });
    await waitFor(() => expect(api.uploadFile).toHaveBeenCalledTimes(2));
    const names = api.uploadFile.mock.calls.map((c) => c[1] as string);
    expect(names[0]).toMatch(/^Pasted image \d{4}-\d\d-\d\d \d\d\.\d\d\.png$/);
    expect(names[1]).toBe(names[0]?.replace('.png', ' 2.png'));
  });

  it('leaves a paste with text and a picture alone', () => {
    const { box } = setup();
    const notPrevented = fireEvent.paste(box, {
      clipboardData: {
        files: [file('image.png', 10, 'image/png')],
        types: ['Files', 'text/plain'],
        getData: () => 'a\tb',
      },
    });
    expect(notPrevented).toBe(true);
    expect(api.uploadFile).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /^Remove/ })).toBeNull();
  });

  it('does not take files when attaching is off', () => {
    const { box } = setup({ attachDisabled: true });
    fireEvent.paste(box, { clipboardData: { files: [file('a.pdf')], types: ['Files'], getData: () => '' } });
    expect(api.uploadFile).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /^Attach files/ })).toBeNull();
  });
});

describe('transcript', () => {
  it('shows the files on a sent message', () => {
    render(
      <Transcript
        items={[
          {
            kind: 'user',
            id: 'u',
            text: 'Here you go',
            attachments: [{ name: 'report.pdf', size: 2048, kind: 'document' }],
          },
        ]}
        sessionId="s"
        sessionState="idle"
      />,
    );
    expect(screen.getByText('report.pdf')).toBeTruthy();
    expect(screen.getByText('2 KB')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Remove/ })).toBeNull();
  });
});

describe('upload queue', () => {
  it('keeps at most 4 uploads going and finishes all 6', async () => {
    let running = 0;
    let peak = 0;
    api.uploadFile.mockImplementation(async (f: File, name: string) => {
      running++;
      peak = Math.max(peak, running);
      if (running > 4) {
        running--;
        throw new Error('Busy');
      }
      await new Promise((r) => setTimeout(r, 5));
      running--;
      return info(name, f.size);
    });
    setup();
    pick(...Array.from({ length: 6 }, (_, i) => file(`f${i}.pdf`)));
    await waitFor(() => expect(screen.getAllByRole('button', { name: /^Remove/ })).toHaveLength(6));
    await waitFor(() => expect(screen.queryByText('Uploading')).toBeNull());
    expect(peak).toBeLessThanOrEqual(4);
    expect(screen.queryByText("Can't attach")).toBeNull();
    await waitFor(() => expect(sendButton().hasAttribute('disabled')).toBe(false));
  });

  it('a finish and a new drop together leave nothing stuck on Uploading', async () => {
    const d = deferred<ReturnType<typeof info>>();
    api.uploadFile.mockReturnValueOnce(d.promise);
    setup();
    pick(file('a.pdf'));
    await act(async () => {
      d.resolve(info('a.pdf'));
      pick(file('b.pdf'));
    });
    await waitFor(() => expect(screen.queryByText('Uploading')).toBeNull());
    expect(screen.getAllByRole('button', { name: /^Remove/ })).toHaveLength(2);
  });
});

describe('refusal text', () => {
  it('puts the full reason under the chips, not inside the chip', () => {
    setup();
    pick(file('run.exe'));
    const reason = screen.getByText(/run\.exe: TDS Brain can't pass on/);
    expect(reason.className).toBe('attach-problem');
    expect(reason.closest('.file-chip')).toBeNull();
    expect(screen.getByText("Can't attach").closest('.file-chip')).not.toBeNull();
  });

  it('says what to do, by how many are refused', () => {
    setup();
    pick(file('a.exe'));
    expect(screen.getByText("Remove the file that can't be attached, then send.")).toBeTruthy();
    pick(file('b.exe'));
    expect(screen.getByText("Remove the files that can't be attached, then send.")).toBeTruthy();
  });

  it('announces a success', async () => {
    setup();
    pick(file('a.pdf'), file('b.pdf'));
    expect(await screen.findByText('2 files attached')).toBeTruthy();
  });
});

describe('long names', () => {
  it('keeps the end of the name visible', async () => {
    setup();
    pick(file('A very long report name about the roof survey.pdf'));
    await screen.findByText('A very long report name about the roof survey.pdf'.slice(-8));
  });
});

function Host() {
  useBlockStrayDrops();
  return null;
}

describe('useBlockStrayDrops', () => {
  const drag = (type: string, types: string[]) => {
    const e = new Event(type, { cancelable: true }) as Event & { dataTransfer: unknown };
    e.dataTransfer = { types };
    window.dispatchEvent(e);
    return e.defaultPrevented;
  };
  it('stops a stray file drop and dragover, and leaves other drags alone', () => {
    render(<Host />);
    expect(drag('dragover', ['Files'])).toBe(true);
    expect(drag('drop', ['Files'])).toBe(true);
    expect(drag('dragover', ['text/plain'])).toBe(false);
    expect(drag('drop', ['text/uri-list'])).toBe(false);
  });
});
