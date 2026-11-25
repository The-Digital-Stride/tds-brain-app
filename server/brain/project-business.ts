/**
 * Client background on a project's Overview (plan docs/plans/2026-11-24-project-business-context.md).
 *
 * READ ONLY: this file never writes, creates or moves anything. It reads `clients/<client>/context/business.md`
 * and `clients/<client>/profile.md` for a live client project, every time it is asked, through one safe-read
 * helper (a regular file, size capped, real path exactly where the client folder says it is), and hands them
 * to the pure parser. business.md is changed only in the brain, never here.
 */
import { constants, promises as fs } from 'node:fs';
import { join } from 'node:path';
import type { ClientInfo } from '../../shared/contract.ts';
import {
  BUSINESS_FILE,
  BUSINESS_MAX_BYTES,
  PROFILE_FILE,
  type ProjectBusinessResponse,
} from '../../shared/project-business-contract.ts';
import { INTERNAL_CLIENT, type ProjectKey, ProjectsError } from '../../shared/projects-contract.ts';
import { parseContacts } from './business-contacts.ts';
import { parseBusiness, profileStatus } from './business-parse.ts';
import type { ProjectsIndex } from './projects.ts';

const NOT_FOUND = "That project couldn't be found. It may have been moved.";

export interface ProjectBusinessDeps {
  root: string;
  index: () => Promise<ProjectsIndex>;
  clients: () => Promise<ClientInfo[]>;
}

export interface ProjectBusinessService {
  read(key: ProjectKey): Promise<ProjectBusinessResponse>;
}

type Safe = { state: 'ok'; text: string } | { state: 'absent' } | { state: 'bad' };

/**
 * One safe read for both files. `rel` is under the client folder. Absent when nothing is there; bad for a
 * link anywhere along the path, a non-file, a file over the cap, or anything unreadable.
 */
async function safeRead(root: string, slug: string, rel: readonly string[]): Promise<Safe> {
  const abs = join(root, 'clients', slug, ...rel);
  try {
    let st: Awaited<ReturnType<typeof fs.lstat>>;
    try {
      st = await fs.lstat(abs);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { state: 'absent' };
      return { state: 'bad' };
    }
    if (!st.isFile()) return { state: 'bad' };
    const real = await fs.realpath(abs);
    if (real !== join(await fs.realpath(root), 'clients', slug, ...rel)) return { state: 'bad' };
    const fh = await fs.open(abs, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const s = await fh.stat();
      if (!s.isFile() || s.size > BUSINESS_MAX_BYTES) return { state: 'bad' };
      // Read into a fixed buffer so the cap holds even if the file grows after the stat (security review).
      const buf = Buffer.alloc(BUSINESS_MAX_BYTES + 1);
      let got = 0;
      while (got < buf.length) {
        const { bytesRead } = await fh.read(buf, got, buf.length - got, got);
        if (bytesRead === 0) break;
        got += bytesRead;
      }
      if (got > BUSINESS_MAX_BYTES) return { state: 'bad' };
      return { state: 'ok', text: buf.subarray(0, got).toString('utf8') };
    } finally {
      await fh.close();
    }
  } catch {
    return { state: 'bad' };
  }
}

const NONE: ProjectBusinessResponse = {
  state: 'none',
  client: null,
  path: null,
  facts: [],
  sections: [],
  contacts: [],
};

export function createProjectBusiness(deps: ProjectBusinessDeps): ProjectBusinessService {
  return {
    async read(key) {
      const card = (await deps.index()).byKey(key);
      if (!card) throw new ProjectsError('not-found', NOT_FOUND);
      if (card.space !== 'client' || card.archived || !card.client || card.client === INTERNAL_CLIENT)
        return NONE;
      const slug = card.client;
      const known = (await deps.clients()).find((c) => c.slug === slug);
      if (!known) return NONE;

      const [biz, prof] = await Promise.all([
        safeRead(deps.root, slug, BUSINESS_FILE.split('/')),
        safeRead(deps.root, slug, [PROFILE_FILE]),
      ]);
      // A bad profile.md is simply ignored.
      const profileText = prof.state === 'ok' ? prof.text : null;
      const client = { slug, name: known.name, status: profileStatus(profileText) };
      // Who an email can go to: read from whichever of the two files passed the safe read, never stored.
      const contacts = parseContacts(biz.state === 'ok' ? biz.text : null, profileText);
      if (biz.state === 'bad')
        return { state: 'unreadable', client, path: null, facts: [], sections: [], contacts };
      const { facts, sections } = parseBusiness(
        biz.state === 'ok' ? biz.text : null,
        profileText,
        card.service,
      );
      if (biz.state === 'absent') {
        if (facts.length === 0 && sections.length === 0) {
          return { state: 'missing', client, path: null, facts: [], sections: [], contacts };
        }
        return { state: 'ok', client, path: null, facts, sections, contacts };
      }
      return { state: 'ok', client, path: `clients/${slug}/${BUSINESS_FILE}`, facts, sections, contacts };
    },
  };
}
