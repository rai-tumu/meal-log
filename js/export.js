// 記録データを AI が読みやすいテキスト形式 (Markdown/JSON/CSV) に変換
function num(v, digits = 1) {
  const n = Number(v) || 0;
  return Number.isInteger(n) ? String(n) : n.toFixed(digits);
}

export function mealTotal(meal) {
  return meal.items.reduce((s, it) => s + (Number(it.kcal) || 0), 0);
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
