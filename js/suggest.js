// 食事記録から「好みプロファイル」を組み立てる — 集計はすべてローカルで完結する
import { mealTotal } from './export.js';

const PROFILE_DAYS = 90;   // 好みの根拠にする期間
const RECENT_DAYS = 3;     // 「最近食べたばかり」として除外候補にする期間

function dateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function daysAgoStr(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return dateStr(d);
}

/** 現在時刻から食事区分を推定する */
export function currentMealSlot(d = new Date()) {
  const h = d.getHours();
  if (h >= 4 && h < 10) return '朝食';
  if (h >= 10 && h < 15) return '昼食';
  if (h >= 15 && h < 17) return '間食';
  if (h >= 17 && h < 23) return '夕食';
  return '夜食';
}

/**
 * 品目名の出現回数ランキング。
 * 名寄せは行わず品目名の完全一致で数える(「牛丼(並)」と「牛丼」は別扱い)。
 * @returns {Array<{name: string, count: number, avgKcal: number}>}
 */
export function itemRanking(meals, limit = 10) {
  const tally = new Map();
  for (const meal of meals) {
    for (const it of meal.items) {
      const name = (it.name || '').trim();
      if (!name) continue;
      const cur = tally.get(name) || { name, count: 0, totalKcal: 0 };
      cur.count++;
      cur.totalKcal += Number(it.kcal) || 0;
      tally.set(name, cur);
    }
  }
  return [...tally.values()]
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'ja'))
    .slice(0, limit)
    .map(e => ({ name: e.name, count: e.count, avgKcal: Math.round(e.totalKcal / e.count) }));
}

/** 食事区分ごとによく食べているもの(上位3件ずつ) */
function rankingBySlot(meals) {
  const bySlot = new Map();
  for (const meal of meals) {
    const hour = Number((meal.time || '12:00').split(':')[0]);
    const slot = currentMealSlot(new Date(2000, 0, 1, hour));
    if (!bySlot.has(slot)) bySlot.set(slot, []);
    bySlot.get(slot).push(meal);
  }
  const out = {};
  for (const [slot, slotMeals] of bySlot) {
    out[slot] = itemRanking(slotMeals, 3).map(e => e.name);
  }
  return out;
}

/**
 * 提案プロンプトに渡す好みプロファイルを組み立てる。
 * @param {Array} allMeals db.getAllMeals() の結果(日付昇順)
 * @param {number} targetKcal 1日の目標カロリー(0なら未設定)
 */
export function buildProfile(allMeals, targetKcal = 0) {
  const from = daysAgoStr(PROFILE_DAYS);
  const recentFrom = daysAgoStr(RECENT_DAYS);
  const today = dateStr(new Date());

  const period = allMeals.filter(m => m.date >= from);
  const ranking = itemRanking(period, 10);

  // 直近数日に食べたもの(重複提案を避けるため)
  const recentItems = [...new Set(
    allMeals.filter(m => m.date >= recentFrom)
      .flatMap(m => m.items.map(it => (it.name || '').trim()))
      .filter(Boolean)
  )];

  const todayMeals = allMeals.filter(m => m.date === today);
  const todayKcal = todayMeals.reduce((s, m) => s + mealTotal(m), 0);

  // 1食あたりの平均カロリー(提案の規模感の参考にする)
  const kcalPerMeal = period.length
    ? Math.round(period.reduce((s, m) => s + mealTotal(m), 0) / period.length)
    : 0;

  return {
    ranking,
    bySlot: rankingBySlot(period),
    recentItems,
    slot: currentMealSlot(),
    todayKcal,
    targetKcal,
    remainingKcal: targetKcal > 0 ? targetKcal - todayKcal : null,
    kcalPerMeal,
    recordCount: period.length,
    totalRecordCount: allMeals.length,
  };
}
