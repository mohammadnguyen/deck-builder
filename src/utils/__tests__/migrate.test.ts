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
});
