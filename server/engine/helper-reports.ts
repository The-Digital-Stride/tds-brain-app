/**
 * Background helpers (Agent / Task steps run in the background) wake Claude when they finish, with
 * turns Claude Code adds as if the person had sent them: a `<task-notification>` and an
 * `<agent-message>` carrying the helper's report. The person never typed these, so the chat shows
 * the report inside "What Claude did" instead, named after the step that started the helper.
 * Used by both the live stream (event-map.ts) and history replay (session-manager.ts).
 */

type Rec = Record<string, unknown>;

function isRec(v: unknown): v is Rec {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

const HAND_BACK = /^(?:Another Claude session sent a message:\s*)?<agent-message\b[^>]*>/;

/** A stored or streamed user turn that is a helper waking Claude, not the person's words. */
export function isHelperTurn(raw: string): boolean {
  const text = raw.trim();
  return text.startsWith('<task-notification>') || HAND_BACK.test(text);
}

const FRAME_END = 'The report follows:';

/** The report in a hand-back, as markdown, and the helper's agent id. Null for anything else. */
export function parseHelperReport(raw: string): { from: string; text: string } | null {
  const text = raw.trim();
  if (!HAND_BACK.test(text)) return null;
  // The real closing tag starts a line; every line of the report is indented, so a report that
  // quotes the tag never ends it early.
  const m = /<agent-message\b([^>]*)>([\s\S]*?)\n<\/agent-message>/.exec(text);
  if (!m) return null;
  const from = /\bfrom="([^"]*)"/.exec(m[1] ?? '')?.[1] ?? '';
  let body = m[2] ?? '';
  const frame = body.indexOf(FRAME_END);
  if (frame >= 0) body = body.slice(frame + FRAME_END.length);
  // Claude Code indents every line of the report by two spaces.
  const report = body
    .split('\n')
    .map((line) => line.replace(/^ {1,2}/, ''))
    .join('\n')
    .trim();
  return report ? { from, text: report } : null;
}

function resultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((b): b is Rec => isRec(b) && typeof b.text === 'string')
    .map((b) => b.text as string)
    .join('\n');
}

/**
 * Remembers each helper's name: the description of the Agent / Task step that started it, matched
 * to the agent id its result reports ("agentId: ab74…"). Feed it every message, in order.
 */
export class HelperNames {
  private readonly byStep = new Map<string, string>();
  private readonly byAgent = new Map<string, string>();

  observe(msg: { type?: unknown; message?: unknown }): void {
    const content = isRec(msg.message) ? msg.message.content : undefined;
    if (!Array.isArray(content)) return;
    for (const b of content) {
      if (!isRec(b)) continue;
      if (msg.type === 'assistant' && b.type === 'tool_use' && (b.name === 'Agent' || b.name === 'Task')) {
        const input = isRec(b.input) ? b.input : {};
        if (typeof b.id === 'string' && typeof input.description === 'string' && input.description.trim())
          this.byStep.set(b.id, input.description.trim());
      } else if (msg.type === 'user' && b.type === 'tool_result' && typeof b.tool_use_id === 'string') {
        const name = this.byStep.get(b.tool_use_id);
        const agent = name ? /\bagentId:\s*([\w-]+)/.exec(resultText(b.content))?.[1] : undefined;
        if (name && agent) this.byAgent.set(agent, name);
      }
    }
  }

  name(agentId: string): string | null {
    return this.byAgent.get(agentId) ?? null;
  }
}
