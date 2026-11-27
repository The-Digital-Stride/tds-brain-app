import { describe, expect, it } from 'vitest';
import {
  canSeeProject,
  canTakeTask,
  isRestricted,
  mayRestrict,
  onProject,
  outsideProjectNote,
  type ProjectViewer,
  parseVisibility,
  personSlugs,
  rawTextRestricted,
  seesEveryProject,
  slugForms,
  type VisibilityCard,
} from './project-visibility.ts';

const viewer = (over: Partial<ProjectViewer> = {}): ProjectViewer => ({
  name: 'Alex Grimes',
  slug: 'alex-grimes',
  role: 'team',
  knownMember: true,
  ...over,
});

const card = (over: Partial<VisibilityCard> = {}): VisibilityCard => ({
  space: 'client',
  visibility: 'restricted',
  owner: 'pete-tyler',
  team: ['ian-hancock'],
  ...over,
});

describe('parseVisibility', () => {
  it('reads no line, an empty one and "everyone" as everyone', () => {
    for (const raw of [undefined, null, '', '  ', 'everyone', 'Everyone', ' EVERYONE ']) {
      expect(parseVisibility(raw)).toBe('everyone');
    }
  });

  it('fails closed: any other value is restricted', () => {
    for (const raw of [
      'restricted',
      'Restricted',
      'private',
      'team',
      'true',
      'evryone',
      1,
      true,
      ['everyone'],
    ]) {
      expect(parseVisibility(raw)).toBe('restricted');
    }
  });
});

describe('rawTextRestricted', () => {
  it('finds a restricted line in a card that no longer parses', () => {
    expect(rawTextRestricted('<<<<<<< HEAD\ntitle: A\nvisibility: restricted\n=======\n')).toBe(true);
    expect(rawTextRestricted('title: A\r\nvisibility: "restricted"\r\n')).toBe(true);
    expect(rawTextRestricted('Visibility : private\n')).toBe(true);
  });

  it('is false with no line, or only "everyone"', () => {
    expect(rawTextRestricted('title: A\nteam:\n  - "x"\n')).toBe(false);
    expect(rawTextRestricted('visibility: everyone\n')).toBe(false);
    expect(rawTextRestricted('  visibility: restricted\n')).toBe(false); // indented: not a top-level key
  });

  it('is true when either side of a conflict says restricted', () => {
    expect(rawTextRestricted('visibility: everyone\n=======\nvisibility: restricted\n')).toBe(true);
  });
});

describe('slug forms', () => {
  it('gives both forms of a punctuated name, once each', () => {
    expect(slugForms("Sam O'Neil")).toEqual(['sam-oneil', 'sam-o-neil']);
    expect(slugForms('Ian Hancock')).toEqual(['ian-hancock']);
    expect(slugForms('')).toEqual([]);
  });

  it('personSlugs adds the own slug', () => {
    expect(personSlugs({ slug: 'owner', name: 'Pete Tyler' })).toEqual(['owner', 'pete-tyler']);
    expect(personSlugs({ slug: 'alex-grimes' })).toEqual(['alex-grimes']);
  });
});

describe('onProject', () => {
  it('is true for the Account Owner and for the team, by either slug form', () => {
    expect(onProject(card(), { slug: 'pete-tyler' })).toBe(true);
    expect(onProject(card(), { slug: 'ian-hancock' })).toBe(true);
    expect(onProject(card({ team: ['sam-o-neil'] }), { slug: 'sam-oneil', name: "Sam O'Neil" })).toBe(true);
  });

  it('is false for anyone else, and for an empty slug', () => {
    expect(onProject(card(), { slug: 'alex-grimes' })).toBe(false);
    expect(onProject(card({ owner: null, team: [] }), { slug: '' })).toBe(false);
  });
});

describe('canSeeProject', () => {
  it('shows an open project to everyone, even someone the roster does not know', () => {
    expect(
      canSeeProject(card({ visibility: 'everyone' }), viewer({ knownMember: false, role: 'unknown' })),
    ).toBe(true);
    expect(canSeeProject(card({ visibility: undefined }), viewer())).toBe(true);
  });

  it('shows a restricted project to its Account Owner and team only', () => {
    expect(canSeeProject(card(), viewer())).toBe(false);
    expect(canSeeProject(card(), viewer({ name: 'Ian Hancock', slug: 'ian-hancock' }))).toBe(true);
    expect(canSeeProject(card(), viewer({ name: 'Pete Tyler', slug: 'pete-tyler' }))).toBe(true);
  });

  it('always shows it to an owner or a scout', () => {
    expect(canSeeProject(card(), viewer({ role: 'owner' }))).toBe(true);
    expect(canSeeProject(card(), viewer({ role: 'scout' }))).toBe(true);
  });

  it('never shows it to someone the roster does not know, whatever their slug or role', () => {
    expect(
      canSeeProject(card(), viewer({ slug: 'ian-hancock', name: 'Ian Hancock', knownMember: false })),
    ).toBe(false);
    expect(canSeeProject(card(), viewer({ role: 'owner', knownMember: false }))).toBe(false);
    expect(seesEveryProject(viewer({ role: 'scout', knownMember: false }))).toBe(false);
  });

  it('never treats a personal project as restricted', () => {
    const personal = card({ space: 'personal', owner: null, team: [] });
    expect(isRestricted(personal)).toBe(false);
    expect(canSeeProject(personal, viewer())).toBe(true);
  });
});

describe('mayRestrict', () => {
  it('is for the Account Owner, an owner or a scout', () => {
    expect(mayRestrict(card(), viewer({ name: 'Pete Tyler', slug: 'pete-tyler' }))).toBe(true);
    expect(mayRestrict(card(), viewer({ role: 'scout' }))).toBe(true);
    expect(mayRestrict(card(), viewer({ role: 'owner' }))).toBe(true);
  });

  it('is not for a team member who is only on the team, a stranger, or a personal project', () => {
    expect(mayRestrict(card(), viewer({ name: 'Ian Hancock', slug: 'ian-hancock' }))).toBe(false);
    expect(mayRestrict(card(), viewer({ role: 'scout', knownMember: false }))).toBe(false);
    expect(mayRestrict(card({ space: 'personal' }), viewer({ role: 'owner' }))).toBe(false);
  });
});

describe('canTakeTask', () => {
  const seesAll = ['pete-tyler', 'simon-jones'];

  it('lets anyone take a task in an open project', () => {
    expect(canTakeTask(card({ visibility: 'everyone' }), { slug: 'alex-grimes' }, seesAll)).toBe(true);
  });

  it('in a restricted project, only someone who can see it', () => {
    expect(canTakeTask(card(), { slug: 'ian-hancock' }, seesAll)).toBe(true);
    expect(canTakeTask(card(), { slug: 'simon-jones' }, seesAll)).toBe(true);
    expect(canTakeTask(card(), { slug: 'alex-grimes', name: 'Alex Grimes' }, seesAll)).toBe(false);
  });

  it('says who to add, in plain words', () => {
    expect(outsideProjectNote('Alex Grimes')).toBe(
      "Alex Grimes isn't on this restricted project. Add them to the project team first, then give them the task.",
    );
  });
});
