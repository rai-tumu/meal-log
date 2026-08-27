// テンプレート — 分量から栄養値を決定的に計算する(AI不使用)
import * as db from './db.js';
import { SEED_TS, SEED_TEMPLATES } from './templates-seed.js';

export function round1(v) {
  return Math.round(v * 10) / 10;
}

/**
 * テンプレート+分量 → 食事の品目。
 * per100g: qty はグラム / unit: qty は個数。
 * kcalは整数、P/F/Cは小数1位に丸める。
 */
export function templateToItem(tpl, qty) {
  const factor = tpl.mode === 'per100g' ? qty / 100 : qty;
  const name = tpl.mode === 'per100g'
    ? `${tpl.name} ${qty}g`
    : `${tpl.name} ${qty}${tpl.unitLabel || '個'}`;
  return {
    name,
    kcal: Math.round(tpl.kcal * factor),
    protein: round1(tpl.protein * factor),
    fat: round1(tpl.fat * factor),
    carbs: round1(tpl.carbs * factor),
  };
}

/** 管理画面の基準表示: 「100gあたり」「1個あたり」 */
export function basisLabel(tpl) {
  return tpl.mode === 'per100g' ? '100gあたり' : `1${tpl.unitLabel || '個'}あたり`;
}

/** 分量の表示: 「150g」「2個」 */
export function qtyLabel(tpl, qty) {
  return tpl.mode === 'per100g' ? `${qty}g` : `${qty}${tpl.unitLabel || '個'}`;
}

/**
 * シードを未登録分だけ投入する(冪等)。
 * トゥームストーンも「登録済み」扱いにするため、削除したシードは復活しない。
 * 固定id+固定タイムスタンプなので、複数端末が独立にシードしても同期後は1件に収束する。
 */
export async function ensureSeeds() {
  const existing = new Set((await db.getAllTemplatesRaw()).map(t => t.id));
  for (const seed of SEED_TEMPLATES) {
    if (existing.has(seed.id)) continue;
    await db.putTemplate({ ...seed, created_at: SEED_TS, updated_at: SEED_TS });
  }
}
