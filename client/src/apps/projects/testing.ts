import type { ProjectCard, ProjectList } from '../../../../shared/projects-contract.ts';

/** Test helper: a project card with sensible defaults. */
export function card(over: Partial<ProjectCard> = {}): ProjectCard {
  const slug = over.slug ?? 'website-rebuild';
  const client = over.client === undefined ? 'skyseal' : over.client;
  return {
    key: `${client ?? 'personal'}/${slug}`,
    space: client === null ? 'personal' : 'client',
    slug,
    client,
    folder: `clients/${client}/projects/${slug}`,
    card: 'ok',
    archived: false,
    title: 'Website rebuild',
    kind: 'one-off',
    status: 'active',
    health: 'green',
    comms: 'amber',
    owner: 'steve-blassberg',
    team: [],
    service: ['seo'],
    start: '2026-11-01',
    end: '2027-02-28',
    budgetHours: 40,
    billable: true,
    stages: ['Discovery', 'Build'],
    mondayId: null,
    created: '2026-11-01',
    createdBy: 'steve-blassberg',
    lastChanged: null,
    brief: 'Rebuild the site.',
    links: [],
    version: 'v1',
    openTodos: 2,
    teamFromTodos: [],
    checklist: null,
    ...over,
  };
}

export function projectList(projects: ProjectCard[], over: Partial<ProjectList> = {}): ProjectList {
  return { projects, canChange: true, looseLabels: 0, duplicates: [], skippedFolders: 0, ...over };
}
