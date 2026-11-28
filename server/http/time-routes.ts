// My day's routes (plan docs/plans/2026-11-28-time-my-day.md, decision 14): `/api/time/*`. Owners and scouts
// only; anyone else, or a build with no TimeService, gets the same 404 as an address that doesn't exist.
// The routes validate and hand over to the TimeService; they hold no time logic. They sit behind the app's
// request gate (cookie, same-origin) and the 64 KB body cap, like every other /api route.
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Identity } from '../../shared/contract.ts';
import {
  type AddEntryRequest,
  type EntryPatchRequest,
  MAX_DESCRIPTION_LENGTH,
  MINUTES_PER_DAY,
  TIME_ROUTES,
  type TimeService,
} from '../../shared/time-contract.ts';
import { HttpError, readJson, sendJson } from './routes.ts';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ISO_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/;
const MAX_ID_LENGTH = 100;
const MAX_ADDRESS_LENGTH = 200;
const DAY_PATH = /^\/api\/time\/day\/(\d{4}-\d{2}-\d{2})(?:\/(refresh|confirm|entries)(?:\/([^/]+))?)?$/;

const NOT_FOUND = 'There is nothing at that address.';
const bad = (message: string) => new HttpError(400, 'bad-request', message);
const notAllowed = () => new HttpError(405, 'bad-request', 'That is not something this address does.');

/** What the time routes need from the route context. */
export interface TimeRouteContext {
  time?: TimeService;
  brain: { identity(): Promise<Identity> };
  log: (line: string) => void;
}

function realDate(text: string): boolean {
  if (!DATE.test(text)) return false;
  const d = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === text;
}

function dayOf(text: string): string {
  if (!realDate(text)) throw bad('That date was not understood. Use the form 2026-11-28.');
  return text;
}

function entryIdOf(text: string): string {
  const id = decodeURIComponent(text);
  if (!UUID.test(id)) throw bad('That entry was not understood.');
  return id;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function startAtOf(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'string' || !ISO_WITH_OFFSET.test(value) || Number.isNaN(Date.parse(value))) {
    throw bad('The start time was not understood.');
  }
  return value;
}

function minutesOf(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > MINUTES_PER_DAY) {
    throw bad(`The minutes must be a whole number from 1 to ${MINUTES_PER_DAY}.`);
  }
  return value;
}

function workItemOf(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_ID_LENGTH) {
    throw bad('That work item was not understood.');
  }
  return value;
}

function descriptionOf(value: unknown): string {
  if (typeof value !== 'string') throw bad('The description was not understood.');
  if (value.length > MAX_DESCRIPTION_LENGTH) {
    throw bad(`Keep the description to ${MAX_DESCRIPTION_LENGTH} characters or fewer.`);
  }
  return value;
}

function billableOf(value: unknown): boolean {
  if (typeof value !== 'boolean') throw bad('Billable must be yes or no.');
  return value;
}

function parseAdd(body: unknown): AddEntryRequest {
  if (!isObject(body) || !isObject(body.values)) throw bad('That entry was not understood.');
  const v = body.values;
  return {
    values: {
      startAt: startAtOf(v.startAt),
      minutes: minutesOf(v.minutes),
      workItemId: workItemOf(v.workItemId ?? null),
      description: descriptionOf(v.description ?? ''),
      billable: billableOf(v.billable),
    },
  };
}

const PATCH_KEYS = [
  'description',
  'workItemId',
  'startAt',
  'minutes',
  'billable',
  'privateEdit',
  'remember',
] as const;

function parsePatch(body: unknown): EntryPatchRequest {
  if (!isObject(body)) throw bad('That change was not understood.');
  const unknown = Object.keys(body).filter((k) => !(PATCH_KEYS as readonly string[]).includes(k));
  if (unknown.length > 0) throw bad('That change was not understood.');
  const out: EntryPatchRequest = {};
  if ('description' in body) out.description = descriptionOf(body.description);
  if ('workItemId' in body) out.workItemId = workItemOf(body.workItemId);
  if ('startAt' in body) out.startAt = startAtOf(body.startAt);
  if ('minutes' in body) out.minutes = minutesOf(body.minutes);
  if ('billable' in body) out.billable = billableOf(body.billable);
  if ('privateEdit' in body) {
    if (typeof body.privateEdit !== 'boolean') throw bad('That change was not understood.');
    out.privateEdit = body.privateEdit;
  }
  if ('remember' in body) {
    if (typeof body.remember !== 'boolean') throw bad('That change was not understood.');
    out.remember = body.remember;
  }
  if (Object.keys(out).length === 0) throw bad('There was nothing to change.');
  return out;
}

function parseAddress(body: unknown): string | null {
  if (!isObject(body) || !('url' in body)) throw bad('That address was not understood.');
  if (body.url === null) return null;
  if (typeof body.url !== 'string' || body.url.length > MAX_ADDRESS_LENGTH) {
    throw bad('That address was not understood.');
  }
  return body.url.trim() === '' ? null : body.url.trim();
}

/** A TimeServiceError maps to 400 or 404; anything else is a 500 with no detail. */
function failure(err: unknown, ctx: TimeRouteContext, path: string): HttpError {
  if (err instanceof HttpError) return err;
  if (isObject(err) && typeof err.message === 'string') {
    if (err.code === 'bad-request') return new HttpError(400, 'bad-request', err.message);
    if (err.code === 'not-found') return new HttpError(404, 'not-found', err.message);
  }
  ctx.log(`A My day request failed unexpectedly (${path}).`);
  return new HttpError(
    500,
    'internal',
    'Something went wrong in the app. Try again, and tell a scout if it keeps happening.',
  );
}

/**
 * Answers an `/api/time/*` request. Returns false when the path is not one of the time routes, so the caller
 * carries on; throws HttpError for the caller's usual error handling.
 */
export async function timeRoute(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  ctx: TimeRouteContext,
): Promise<boolean> {
  const path = url.pathname;
  if (!path.startsWith('/api/time/')) return false;
  const method = (req.method ?? 'GET').toUpperCase();
  const time = ctx.time;
  if (!time) throw new HttpError(404, 'not-found', NOT_FOUND);
  const who = await ctx.brain.identity().catch(() => null);
  if (!who || (who.role !== 'owner' && who.role !== 'scout'))
    throw new HttpError(404, 'not-found', NOT_FOUND);

  const answer = (body: unknown) => sendJson(res, 200, body);
  try {
    if (path === TIME_ROUTES.status) {
      if (method !== 'GET') throw notAllowed();
      answer(await time.status());
      return true;
    }
    if (path === TIME_ROUTES.connect) {
      if (method !== 'POST') throw notAllowed();
      await readJson(req);
      answer(await time.connect());
      return true;
    }
    if (path === TIME_ROUTES.disconnect) {
      if (method !== 'POST') throw notAllowed();
      await readJson(req);
      answer(await time.disconnect());
      return true;
    }
    if (path === TIME_ROUTES.address) {
      if (method !== 'POST') throw notAllowed();
      answer(await time.setAddress(parseAddress(await readJson(req))));
      return true;
    }
    if (path === TIME_ROUTES.workItems) {
      if (method !== 'GET') throw notAllowed();
      answer(await time.workItems(url.searchParams.get('refresh') === '1'));
      return true;
    }
    const m = DAY_PATH.exec(path);
    if (!m?.[1]) throw new HttpError(404, 'not-found', NOT_FOUND);
    const date = dayOf(m[1]);
    const part = m[2];
    const id = m[3];
    if (!part) {
      if (method !== 'GET') throw notAllowed();
      answer(await time.day(date));
      return true;
    }
    if (part === 'refresh' && !id) {
      if (method !== 'POST') throw notAllowed();
      await readJson(req);
      answer(await time.refresh(date));
      return true;
    }
    if (part === 'confirm' && !id) {
      if (method !== 'POST') throw notAllowed();
      await readJson(req);
      answer(await time.confirm(date));
      return true;
    }
    if (part === 'entries' && !id) {
      if (method !== 'POST') throw notAllowed();
      answer(await time.addEntry(date, parseAdd(await readJson(req))));
      return true;
    }
    if (part === 'entries' && id) {
      const entryId = entryIdOf(id);
      if (method === 'PATCH') {
        answer(await time.changeEntry(date, entryId, parsePatch(await readJson(req))));
        return true;
      }
      if (method === 'DELETE') {
        const flag = url.searchParams.get('private');
        if (flag !== null && flag !== '1') throw bad('That request was not understood.');
        answer(await time.deleteEntry(date, entryId, { private: flag === '1' }));
        return true;
      }
      throw notAllowed();
    }
    throw new HttpError(404, 'not-found', NOT_FOUND);
  } catch (err) {
    throw failure(err, ctx, path.replace(/\d{4}-\d{2}-\d{2}/, ':date').replace(/[0-9a-f-]{36}/, ':id'));
  }
}
