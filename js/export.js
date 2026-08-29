// 記録データを AI が読みやすいテキスト形式 (Markdown/JSON/CSV) に変換
function num(v, digits = 1) {
  const n = Number(v) || 0;
  return Number.isInteger(n) ? String(n) : n.toFixed(digits);
}

/** 1食の栄養素合計。kcalは整数、P/F/Cは小数1位 */
export function mealNutrients(meal) {
  return sumItems(meal.items || []);
}

/** 複数食の栄養素合計。形式は mealNutrients と同じ */
export function sumNutrients(meals) {
  return sumItems(meals.flatMap(m => m.items || []));
}

function sumItems(items) {
  const t = items.reduce((s, it) => ({
    kcal: s.kcal + (Number(it.kcal) || 0),
    protein: s.protein + (Number(it.protein) || 0),
    fat: s.fat + (Number(it.fat) || 0),
    carbs: s.carbs + (Number(it.carbs) || 0),
  }), { kcal: 0, protein: 0, fat: 0, carbs: 0 });
  return {
    kcal: Math.round(t.kcal),
    protein: round1(t.protein),
    fat: round1(t.fat),
    carbs: round1(t.carbs),
  };
}

function round1(v) {
  return Math.round(v * 10) / 10;
}

export function mealTotal(meal) {
  return mealNutrients(meal).kcal;
}

function groupByDate(meals) {
  const map = new Map();
  for (const m of meals) {
    if (!map.has(m.date)) map.set(m.date, []);
    map.get(m.date).push(m);
  }
  return map;
}

/** LLMに渡しやすい Markdown。日別合計付き */
export function toMarkdown(meals, { title = '食事記録' } = {}) {
  const lines = [`# ${title}`, ''];
  lines.push('| 日付 | 時刻 | 品目 | kcal | P(g) | F(g) | C(g) | メモ |');
  lines.push('|------|------|------|-----:|-----:|-----:|-----:|------|');

  const byDate = groupByDate(meals);
  const dayTotals = [];
  for (const [date, dayMeals] of byDate) {
    let dayKcal = 0;
    for (const meal of dayMeals) {
      for (const it of meal.items) {
        lines.push(`| ${date} | ${meal.time} | ${it.name} | ${num(it.kcal, 0)} | ${num(it.protein)} | ${num(it.fat)} | ${num(it.carbs)} | ${meal.note || ''} |`);
        dayKcal += Number(it.kcal) || 0;
      }
    }
    dayTotals.push({ date, kcal: dayKcal });
  }

  lines.push('', '## 日別合計', '');
  lines.push('| 日付 | 合計kcal |');
  lines.push('|------|--------:|');
  for (const d of dayTotals) lines.push(`| ${d.date} | ${num(d.kcal, 0)} |`);

  if (dayTotals.length > 0) {
    const avg = dayTotals.reduce((s, d) => s + d.kcal, 0) / dayTotals.length;
    lines.push('', `記録日数: ${dayTotals.length}日 / 平均: ${Math.round(avg)} kcal/日`);
  }
  return lines.join('\n') + '\n';
}

export function toJSON(meals) {
  const records = meals.map(m => ({
    date: m.date,
    time: m.time,
    items: m.items,
    total_kcal: mealTotal(m),
    note: m.note || '',
    source: m.source || 'manual',
  }));
  return JSON.stringify({ format: 'meallog-v1', exported_at: new Date().toISOString(), meals: records }, null, 2);
}

export function toCSV(meals) {
  const esc = (s) => {
    s = String(s ?? '');
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const rows = [['date', 'time', 'item', 'kcal', 'protein_g', 'fat_g', 'carbs_g', 'note']];
  for (const m of meals) {
    for (const it of m.items) {
      rows.push([m.date, m.time, it.name, num(it.kcal, 0), num(it.protein), num(it.fat), num(it.carbs), m.note || '']);
    }
  }
  // ExcelでのUTF-8文字化け防止にBOM付与
  return '﻿' + rows.map(r => r.map(esc).join(',')).join('\n') + '\n';
}

export function download(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
