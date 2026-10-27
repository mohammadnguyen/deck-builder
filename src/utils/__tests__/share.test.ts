import { describe, expect, it } from 'vitest';
import { computeDesign } from '../../engine';
import { newProject } from '../../model/defaults';
import type { Project } from '../../model/types';
import { migrateProject, receiveShared } from '../../state';
import { shareLink, sharedProject } from '../share';

const PAGE = 'https://mohammadnguyen.github.io/deck-builder/';
const hashOf = (link: string) => link.slice(link.indexOf('#'));
/** the shop's L-shaped job, with the hand changes a real job collects */
function job(): Project {
  const p = newProject('ERIC-CASSTLEHILL', true);
  p.client = '王先生';
  p.address = '12 Castle St, Castle Hill NSW';
  p.deck = [{ x: 0, y: 0 }, { x: 11300, y: 0 }, { x: 11300, y: 7800 }, { x: 6500, y: 7800 }, { x: 6500, y: 2350 }, { x: 0, y: 2350 }];
  p.houseEdges = [0, 5];
  p.house = [[{ x: -1500, y: 0 }, { x: 12800, y: 0 }]];
  p.stairs = [];
  p.params.deckHeight = 450;
  p.params.balustrade = { ...p.params.balustrade, mode: 'on', edgeOverride: { 2: false } };
  p.rules.timberLengths = [4800, 5400, 6000];
  p.rules.extraLengthSaving = 80;
  p.prices['tp-90x45'] = 7.1;
  p.order = { lines: { 'tp-90x45': { spare: { 6000: 3 } }, 'weed-mat': { removed: true } }, added: [{ id: 'a1', name: 'Skip bin', unit: 'ea', unitPrice: 380, qty: 1 }], note: '周二早上 7 点送货' };
  return p;
}

describe('share links', () => {
  it('carries a project whole, in a short link', () => {
    for (const p of [newProject('样板', true), job()]) {
      const link = shareLink(p, PAGE);
      expect(link.startsWith(`${PAGE}#p=z`)).toBe(true);
      expect(link).toMatch(/^[\w:/.#=-]+$/);
      // what differs from a new project only, compressed: a few hundred characters
      expect(link.length).toBeLessThan(900);
      expect(sharedProject(hashOf(link))).toEqual(p);
      // and it designs the same deck
      const d = computeDesign(migrateProject(sharedProject(hashOf(link))!));
      expect(d.bom.total).toBeCloseTo(computeDesign(p).bom.total, 6);
    }
  });

  it('reads nothing from another address, or a link cut short on the way', () => {
    const link = shareLink(job(), PAGE);
    expect(sharedProject('')).toBeNull();
    expect(sharedProject('#materials')).toBeNull();
    expect(sharedProject(hashOf(link).slice(0, -40))).toBeNull();
    expect(sharedProject('#p=z' + 'A'.repeat(12))).toBeNull();
  });

  it('sets no prototype from a link', async () => {
    const { deflateSync, strToU8 } = await import('fflate');
    const evil = JSON.stringify({ ...newProject('x', true), rules: JSON.parse('{"__proto__": {"polluted": 1}, "kerf": 4}'), params: {} });
    const b64 = btoa(String.fromCharCode(...deflateSync(strToU8(evil)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const p = sharedProject(`#p=z${b64}`)!;
    expect(p.rules!.kerf).toBe(4);
    expect((p.rules as unknown as Record<string, unknown>).polluted).toBeUndefined();
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('adds a new job, replaces the same job unchanged here, keeps one changed here beside the copy', () => {
    const p = job();
    const other = newProject('其他', true);
    const name = (n: string) => `${n}（链接）`;
    // new here
    let r = receiveShared([other], p, name);
    expect(r.projects.map((x) => x.id)).toEqual([other.id, p.id]);
    expect(r.id).toBe(p.id);
    expect(r.copy).toBe(false);
    // the same job, older here: the link's version replaces it
    const older = { ...p, updatedAt: '2026-01-01T00:00:00.000Z', name: 'old' };
    r = receiveShared([older, other], p, name);
    expect(r.projects).toEqual([p, other]);
    // changed here after the link was made: kept, the link's version saved beside it
    const newer = { ...p, updatedAt: '2999-01-01T00:00:00.000Z', name: 'edited here' };
    r = receiveShared([newer], p, name);
    expect(r.copy).toBe(true);
    expect(r.projects[0]).toBe(newer);
    expect(r.projects[1]).toMatchObject({ name: 'ERIC-CASSTLEHILL（链接）', deck: p.deck });
    expect(r.projects[1].id).not.toBe(p.id);
    expect(r.id).toBe(r.projects[1].id);
    // the same link again: that copy opens, no second one
    const again = receiveShared(r.projects, p, name);
    expect(again.projects).toBe(r.projects);
    expect(again.id).toBe(r.projects[1].id);
  });
});
