import type { DesignResult } from '../engine';
import { sizeLabel } from '../model/catalog';
import type { RuleSet } from '../model/types';

type T = (key: string, params?: Record<string, string | number>) => string;

const dollars = (v: number): string => `$${Math.round(v).toLocaleString('en-AU')}`;

/** One line on the frame a design uses, and why (step 4 and the settings). */
export function frameSummary(design: DesignResult, rules: RuleSet, t: T): string {
  const f = design.frame;
  const params = {
    joist: sizeLabel(f.joistProductId),
    bearer: sizeLabel(f.bearerProductId),
    lam: t(`frame.lam.${f.bearerLaminations}`),
    n: design.layout ? design.layout.posts.length : 0,
  };
  if (!f.auto) return t('frame.fixed', params);
  if (f.noFit) return t('frame.noFit', params);
  if (f.standard) return t('frame.std', params);
  if (f.saving !== undefined && f.standardStumps !== undefined) {
    return t('frame.changed', { ...params, std: f.standardStumps, saving: dollars(f.saving), labour: dollars(rules.stumpLabour ?? 40) });
  }
  return t('frame.chosen', params);
}
