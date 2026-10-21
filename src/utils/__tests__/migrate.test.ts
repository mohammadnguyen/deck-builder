import { describe, expect, it } from 'vitest';
import { computeDesign } from '../../engine';
import { newProject, RULES_VERSION } from '../../model/defaults';
import { migrateProject } from '../../state';

describe('saved projects', () => {
  it('moves composite joists from the old 500 default to 400 centres once, and keeps a value set afterwards', () => {
    const old = newProject('old', true);
    old.rules.deckingMaxJoistSpacing['modelo-140x23'] = 500;
    old.rules.deckingMaxJoistSpacing['ntw-terrace-us49'] = 450; // customised before the upgrade: kept
    delete old.rules.rulesVersion;
    const m = migrateProject(JSON.parse(JSON.stringify(old)));
    expect(m.rules.deckingMaxJoistSpacing['modelo-140x23']).toBe(400);
    expect(m.rules.deckingMaxJoistSpacing['ntw-terrace-us49']).toBe(450);
    expect(m.rules.rulesVersion).toBe(RULES_VERSION);
    expect(computeDesign(m).joistSpacingCap).toBe(400);

    const later = newProject('later', true);
    later.rules.deckingMaxJoistSpacing['modelo-140x23'] = 500; // set by hand after the upgrade
    expect(migrateProject(JSON.parse(JSON.stringify(later))).rules.deckingMaxJoistSpacing['modelo-140x23']).toBe(500);
  });

  it('loads projects saved before breakers could be placed by hand', () => {
    const p = newProject('p', true) as Partial<ReturnType<typeof newProject>>;
    delete p.breakers;
    const m = migrateProject(JSON.parse(JSON.stringify(p)));
    expect(m.breakers).toBeNull();
    expect(computeDesign(m).layout!.breakerMode).toBe('auto');
    // a malformed entry is dropped rather than breaking the design
    const bad = migrateProject({ ...JSON.parse(JSON.stringify(p)), breakers: { axis: 'x' } });
    expect(bad.breakers).toBeNull();
  });
  it('moves bearer ends out to the deck edge and onto their stumps once', () => {
    const old = newProject('old', true);
    old.rules.postEndSetback = 150;
    old.rules.bearerEndInset = 45;
    old.rules.rulesVersion = 2;
    const m = migrateProject(JSON.parse(JSON.stringify(old)));
    expect(m.rules.postEndSetback).toBe(0);
    expect(m.rules.bearerEndInset).toBe(0);
    expect(m.rules.rulesVersion).toBe(RULES_VERSION);
    const later = newProject('later', true);
    later.rules.postEndSetback = 150; // set by hand after the upgrade
    expect(migrateProject(JSON.parse(JSON.stringify(later))).rules.postEndSetback).toBe(150);
  });

  it('sizes the frame automatically for projects still on the old default sizes, and keeps sizes someone picked', () => {
    const plain = newProject('plain', true) as ReturnType<typeof newProject>;
    const a = JSON.parse(JSON.stringify(plain));
    delete a.params.frameSizing;
    expect(migrateProject(a).params.frameSizing).toBe('auto');
    const picked = JSON.parse(JSON.stringify(plain));
    delete picked.params.frameSizing;
    picked.params.joistProductId = 'tp-140x45';
    const m = migrateProject(picked);
    expect(m.params.frameSizing).toBe('fixed');
    expect(computeDesign(m).frame.joistProductId).toBe('tp-140x45');
  });
});
