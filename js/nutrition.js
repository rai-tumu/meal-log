// 目標値(kcal/PFC)の算出と、カロリー・PFCサマリーカードの描画。
// 記録画面の「今日」と履歴画面の「選択日」で同じカードを使い回す。

/** PFC比率の既定値(%)。目標カロリーから g を自動計算するときに使う */
export const DEFAULT_PFC_RATIO = { p: 20, f: 25, c: 55 };

// 1gあたりのkcal(アトウォーター係数)
const KCAL_PER_G = { protein: 4, fat: 9, carbs: 4 };

function round1(v) {
  return Math.round(v * 10) / 10;
}

// 未入力・不正値は既定値へフォールバックする(0%は有効な指定として扱う)
function ratioOr(v, fallback) {
  const n = Number(v);
  return (v === '' || v == null || !Number.isFinite(n) || n < 0) ? fallback : n;
}

export function pfcRatio(settings) {
  const r = settings.pfcRatio || {};
  return {
    p: ratioOr(r.p, DEFAULT_PFC_RATIO.p),
    f: ratioOr(r.f, DEFAULT_PFC_RATIO.f),
    c: ratioOr(r.c, DEFAULT_PFC_RATIO.c),
  };
}

/** 目標カロリー + PFC比率から算出した目標g。手動指定があればそちらを優先する */
export function nutritionTargets(settings) {
  const auto = autoTargets(settings);
  return {
    kcal: auto.kcal,
    protein: Number(settings.targetProtein) || auto.protein,
    fat: Number(settings.targetFat) || auto.fat,
    carbs: Number(settings.targetCarbs) || auto.carbs,
  };
}

/** 比率だけから算出した目標g(設定画面のプレビュー・placeholder用) */
export function autoTargets(settings) {
  const kcal = Number(settings.targetKcal) || 0;
  const r = pfcRatio(settings);
  return {
    kcal,
    protein: round1(kcal * (r.p / 100) / KCAL_PER_G.protein),
    fat: round1(kcal * (r.f / 100) / KCAL_PER_G.fat),
    carbs: round1(kcal * (r.c / 100) / KCAL_PER_G.carbs),
  };
}

const ROWS = [
  { key: 'protein', label: 'たんぱく質', unit: 'g', digits: 1 },
  { key: 'fat', label: '脂質', unit: 'g', digits: 1 },
  { key: 'carbs', label: '炭水化物', unit: 'g', digits: 1, wide: true },
];

function fmt(v, digits) {
  return digits === 0 ? String(Math.round(v)) : (Number(v) || 0).toFixed(digits);
}

/**
 * 実績と目標を並べたカードを描画する。
 * 目標が0(未設定)の項目はバーを出さず実績値だけを見せる。
 */
export function renderNutritionCard(el, { totals, targets, mealCount = 0 }) {
  el.className = 'nutrition-card';
  el.innerHTML = '';

  el.appendChild(metricBlock({
    label: 'カロリー', value: totals.kcal, target: targets.kcal,
    unit: 'kcal', digits: 0, big: true,
  }));

  const grid = document.createElement('div');
  grid.className = 'nut-grid';
  for (const row of ROWS) {
    const tile = metricBlock({
      label: row.label, value: totals[row.key], target: targets[row.key],
      unit: row.unit, digits: row.digits,
    });
    if (row.wide) tile.classList.add('wide');
    grid.appendChild(tile);
  }
  el.appendChild(grid);

  const foot = document.createElement('div');
  foot.className = 'nut-foot';
  const parts = [`${mealCount}食`];
  if (targets.kcal > 0) {
    const diff = Math.round(targets.kcal - totals.kcal);
    parts.push(diff >= 0 ? `目標まで残り ${diff} kcal` : `目標を ${-diff} kcal 超過`);
  }
  foot.textContent = parts.join(' ・ ');
  foot.classList.toggle('over', targets.kcal > 0 && totals.kcal > targets.kcal);
  el.appendChild(foot);
}

function metricBlock({ label, value, target, unit, digits, big = false }) {
  const wrap = document.createElement('div');
  wrap.className = big ? 'nut-metric nut-metric-main' : 'nut-metric nut-tile';
  const over = target > 0 && value > target;

  const head = document.createElement('div');
  head.className = 'nut-label';
  head.textContent = label;

  const valueRow = document.createElement('div');
  valueRow.className = 'nut-values';
  const cur = document.createElement('span');
  cur.className = 'nut-value';
  cur.textContent = fmt(value, digits);
  valueRow.appendChild(cur);
  if (target > 0) {
    const tgt = document.createElement('span');
    tgt.className = 'nut-target';
    tgt.textContent = ` / ${fmt(target, digits)}${unit}`;
    valueRow.appendChild(tgt);
  } else {
    const u = document.createElement('span');
    u.className = 'nut-target';
    u.textContent = ` ${unit}`;
    valueRow.appendChild(u);
  }

  wrap.append(head, valueRow);

  if (target > 0) {
    const bar = document.createElement('div');
    bar.className = 'nut-bar';
    bar.setAttribute('role', 'progressbar');
    bar.setAttribute('aria-label', `${label} 目標に対する達成度`);
    bar.setAttribute('aria-valuemin', '0');
    bar.setAttribute('aria-valuemax', fmt(target, digits));
    bar.setAttribute('aria-valuenow', fmt(value, digits));
    const fill = document.createElement('i');
    fill.style.width = `${Math.min(100, (value / target) * 100)}%`;
    if (over) fill.classList.add('over');
    bar.appendChild(fill);
    wrap.appendChild(bar);
  }

  if (over) wrap.classList.add('over');
  return wrap;
}
