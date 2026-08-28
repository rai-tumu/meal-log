// テンプレート — 分量から栄養値を決定的に計算する(AI不使用)
import * as db from './db.js';
import { SEED_TS, SEED_TEMPLATES, RETIRED_SEED_IDS, CATEGORIES } from './templates-seed.js';

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

/** 分量の増減幅。per100gは既定50g、unitは既定1個 */
export function qtyStep(tpl) {
  return Number(tpl.step) || (tpl.mode === 'per100g' ? 50 : 1);
}

/** 一覧に出す基準値の要約: 「100g 156kcal」「1個 71kcal」 */
export function basisSummary(tpl) {
  const unit = tpl.mode === 'per100g' ? '100g' : `1${tpl.unitLabel || '個'}`;
  return `${unit} ${tpl.kcal}kcal`;
}

/** カテゴリの表示順(未設定は「その他」扱い) */
export function categoryOrder(tpl) {
  const i = CATEGORIES.findIndex(c => c.key === (tpl.category || 'other'));
  return i < 0 ? CATEGORIES.length : i;
}

/**
 * シードを未登録分だけ投入する(冪等)。
 * トゥームストーンも「登録済み」扱いにするため、削除したシードは復活しない。
 * 固定id+固定タイムスタンプなので、複数端末が独立にシードしても同期後は1件に収束する。
 */
export async function ensureSeeds() {
  const stored = await db.getAllTemplatesRaw();
  const byId = new Map(stored.map(t => [t.id, t]));

  for (const seed of SEED_TEMPLATES) {
    const current = byId.get(seed.id);
    if (!current) {
      await db.putTemplate({ ...seed, created_at: SEED_TS, updated_at: SEED_TS });
      continue;
    }
    // 既存レコードにcategory/stepが無ければ補う。ユーザーが編集した栄養値は保持する
    if (current.deleted) continue;
    const patch = {};
    if (!current.category) patch.category = seed.category;
    if (current.step === undefined && seed.step !== undefined) patch.step = seed.step;
    if (Object.keys(patch).length) {
      await db.putTemplate({ ...current, ...patch, updated_at: new Date().toISOString() });
    }
  }

  // 米・果物・卵以外の旧シードを削除(トゥームストーンで他端末にも伝播)
  for (const id of RETIRED_SEED_IDS) {
    const current = byId.get(id);
    if (current && !current.deleted) await db.markTemplateDeleted(id);
  }
}
