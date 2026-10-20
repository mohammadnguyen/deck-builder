import { createContext, useContext } from 'react';
import type { Lang, Product } from '../model/types';
import { PRODUCT_MAP } from '../model/catalog';
import { en } from './en';
import { zh } from './zh';

const DICTS: Record<Lang, Record<string, string>> = { zh, en };

export type TFn = (key: string, params?: Record<string, string | number>) => string;

export function translate(lang: Lang, key: string, params?: Record<string, string | number>): string {
  let s = DICTS[lang][key] ?? DICTS.en[key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      let val = String(v);
      // product ids passed as parameters are shown by name
      const prod = PRODUCT_MAP[val];
      if (prod) val = prod.name[lang];
      else if (DICTS[lang][`pathway.${val}`]) val = DICTS[lang][`pathway.${val}`];
      else if (DICTS[lang][`p.infill.${val}`] && k === 'infill') val = DICTS[lang][`p.infill.${val}`];
      s = s.split(`{${k}}`).join(val);
    }
  }
  return s;
}

export function productName(p: Product | string, lang: Lang): string {
  const prod = typeof p === 'string' ? PRODUCT_MAP[p] : p;
  if (!prod) return String(p);
  return prod.name[lang];
}

export const LangContext = createContext<{ lang: Lang; t: TFn }>({ lang: 'zh', t: (k, p) => translate('zh', k, p) });

export function useT(): { lang: Lang; t: TFn } {
  return useContext(LangContext);
}
