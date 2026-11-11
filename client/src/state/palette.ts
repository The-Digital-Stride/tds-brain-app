import type { PaletteGroup, PaletteGroups, PaletteOption } from '../shell/contract.ts';

const MAX_PER_GROUP = 6;

const GO_TO: PaletteOption[] = [
  { id: 'go-home', label: 'Home', hint: null, icon: 'home', command: { kind: 'home' } },
  { id: 'go-todos', label: 'To-dos', hint: 'T', icon: 'todos', command: { kind: 'drawer', drawer: 'todos' } },
  { id: 'go-chats', label: 'Chats', hint: 'C', icon: 'chat', command: { kind: 'drawer', drawer: 'chats' } },
  {
    id: 'go-skills',
    label: 'Skills',
    hint: 'S',
    icon: 'skills',
    command: { kind: 'drawer', drawer: 'skills' },
  },
  { id: 'go-settings', label: 'Settings', hint: null, icon: 'settings', command: { kind: 'settings' } },
];

export const paletteGroups: PaletteGroups = (query, data) => {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const searching = words.length > 0;
  const matches = (label: string) => {
    const l = label.toLowerCase();
    return words.every((w) => l.includes(w));
  };

  const pinRank = (name: string) => {
    const i = data.pins.indexOf(name);
    return i === -1 ? Number.POSITIVE_INFINITY : i;
  };
  // Pinned first (in pin order); the rest keep the order given.
  const orderedSkills = [...data.skills].sort((a, b) => pinRank(a.name) - pinRank(b.name));

  // Soonest due first, undated last; the sort is stable so equal dates keep the order given.
  const orderedTodos = [...data.todos].sort((a, b) => {
    if (a.due === b.due) return 0;
    if (a.due === null) return 1;
    if (b.due === null) return -1;
    return a.due < b.due ? -1 : 1;
  });

  const groups: PaletteGroup[] = [
    { title: 'Go to', options: GO_TO.filter((o) => matches(o.label)) },
    {
      title: 'Open chats',
      options: data.live
        .filter((s) => matches(s.title))
        .map((s) => ({
          id: `chat-${s.id}`,
          label: s.title,
          hint: s.client,
          icon: 'chat' as const,
          command: { kind: 'chat' as const, sessionId: s.id },
        })),
    },
    {
      title: 'Run a skill',
      options: orderedSkills
        .filter((s) => (searching ? matches(s.title) : data.pins.includes(s.name)))
        .map((skill) => ({
          id: `skill-${skill.name}`,
          label: skill.title,
          hint: null,
          icon: 'skills' as const,
          command: { kind: 'skill' as const, skill },
        })),
    },
    {
      title: 'Start a chat on a to-do',
      options: (searching ? orderedTodos.filter((t) => matches(t.title)) : orderedTodos.slice(0, 5)).map(
        (todo) => ({
          id: `todo-${todo.id}`,
          label: todo.title,
          hint: todo.client,
          icon: 'go' as const,
          command: { kind: 'todo' as const, todo },
        }),
      ),
    },
  ];

  return groups
    .map((g) => ({ ...g, options: g.options.slice(0, MAX_PER_GROUP) }))
    .filter((g) => g.options.length > 0);
};
