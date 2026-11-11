import { useEffect, useRef, useState } from 'react';
import type { Attention, SkillInfo } from '../../../shared/contract.ts';
import { Icon } from '../shell/Icon.tsx';

export interface ComposerProps {
  initial: string;
  /** A skill chosen to start this chat. It is sent as `/name` in front of the text. */
  skill: SkillInfo | null;
  disabledReason: string | null;
  onSend: (text: string) => Promise<boolean>;
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
}: ComposerProps) {
  const [text, setText] = useState(initial);
  const [skill, setSkill] = useState(initialSkill);
  const [sending, setSending] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  // Read-only, not disabled, so the box can still take focus and its reason can be read.
  const blocked = disabledReason !== null || sending;
  const canSend = !blocked && (text.trim() !== '' || skill !== null);

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
    const ok = await onSend(body);
    setSending(false);
    if (ok) {
      setText('');
      setSkill(null);
    }
    area.current?.focus();
  };

  return (
    // The box's border carries the chat's state (ready, working, needs your answer).
    <div className="composer" data-attention={attention ?? undefined}>
      {skill ? (
        <div className="chip-row">
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
        </div>
      ) : null}
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
        {disabledReason ? (
          <p className="visually-hidden" id="composer-reason">
            {disabledReason}
          </p>
        ) : (
          <p className="composer-hint" id="composer-hint">
            Enter to send, Shift and Enter for a new line.
          </p>
        )}
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
