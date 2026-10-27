import { deflateSync, inflateSync, strFromU8, strToU8 } from 'fflate';
import { defaultParams, defaultRules } from '../model/defaults';
import type { Project } from '../model/types';

/*
 * A project in a link, for another phone or computer: what differs from a new project's settings, compressed into
 * the part of the address after # (which never goes to the server). Opening the link stores the project there.
 */

/** where the project starts in the address, and its format (z: deflated JSON) */
const MARK = '#p=z';

const plain = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);

/** what differs from the defaults: objects key by key, anything else whole (undefined: nothing differs) */
function diff(value: unknown, base: unknown): unknown {
  if (JSON.stringify(value) === JSON.stringify(base)) return undefined;
  if (!plain(value) || !plain(base)) return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    const d = diff(v, base[k]);
    if (d !== undefined) out[k] = d;
  }
  return out;
}

/** keys a link must not set (they would reach an object's prototype) */
const UNSAFE = new Set(['__proto__', 'constructor', 'prototype']);

/** the defaults with the differences put back */
function patch(base: unknown, delta: unknown): unknown {
  if (delta === undefined) return base;
  if (!plain(delta) || !plain(base)) return delta;
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(delta)) if (!UNSAFE.has(k)) out[k] = patch(base[k], v);
  return out;
}

function toBase64Url(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array {
  return Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
}

/** The link that opens this project on another phone or computer (`page`: the app's address). */
export function shareLink(project: Project, page: string): string {
  const slim = { ...project, rules: diff(project.rules, defaultRules()) ?? {}, params: diff(project.params, defaultParams()) ?? {} };
  return `${page.split('#')[0]}${MARK}${toBase64Url(deflateSync(strToU8(JSON.stringify(slim)), { level: 9 }))}`;
}

/** Does this address carry a project? */
export const isShareHash = (hash: string): boolean => hash.startsWith(MARK);

/** The project a link brings (the part of the address after #), to be checked and migrated like a saved one; null
 *  when it brings none or cannot be read. */
export function sharedProject(hash: string): Partial<Project> | null {
  if (!isShareHash(hash)) return null;
  try {
    const slim = JSON.parse(strFromU8(inflateSync(fromBase64Url(hash.slice(MARK.length))))) as Partial<Project>;
    if (!plain(slim)) return null;
    return { ...slim, rules: patch(defaultRules(), slim.rules) as Project['rules'], params: patch(defaultParams(), slim.params) as Project['params'] };
  } catch {
    return null;
  }
}
