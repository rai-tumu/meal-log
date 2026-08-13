// MealLog メインアプリ — 画面制御と各機能の結線
import * as db from './db.js';
import * as gemini from './gemini.js';
import * as github from './github.js';
import { buildProfile, itemRanking } from './suggest.js';
import { toMarkdown, toJSON, toCSV, download, mealTotal } from './export.js';

const $ = (sel) => document.querySelector(sel);

// ---------- 設定 ----------
const SETTINGS_KEY = 'meallog-settings';

function loadSettings() {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {};
  } catch { return {}; }
}
function saveSettings(s) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}
let settings = loadSettings();

// ---------- ユーティリティ ----------
let toastTimer = null;
function toast(msg, ms = 2500) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, ms);
}

function todayStr(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function nowTimeStr(d = new Date()) {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// ---------- タブ切り替え ----------
function switchTab(view) {
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.view === view));
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  $(`#view-${view}`).classList.add('active');
  if (view === 'history') renderHistory();
  if (view === 'record') renderTodaySummary();
  if (view === 'suggest') renderTasteRanking();
}

document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => switchTab(tab.dataset.view));
});

// ---------- 記録画面: エディタ ----------
let currentImage = null; // 解析用に保持(保存はしない)

function emptyItem() {
  return { name: '', kcal: 0, protein: 0, fat: 0, carbs: 0 };
}

function renderItems(items) {
  const list = $('#items-list');
  list.innerHTML = '';
  items.forEach((it, idx) => {
    const row = document.createElement('div');
    row.className = 'item-row';
    row.innerHTML = `
      <input type="text" class="item-name" placeholder="品目名" value="">
      <button class="item-remove" title="削除">✕</button>
      <div class="item-nutrients">
        <label>kcal<input type="number" class="item-kcal" min="0" step="1"></label>
        <label>P(g)<input type="number" class="item-protein" min="0" step="0.1"></label>
        <label>F(g)<input type="number" class="item-fat" min="0" step="0.1"></label>
        <label>C(g)<input type="number" class="item-carbs" min="0" step="0.1"></label>
      </div>`;
    row.querySelector('.item-name').value = it.name;
    row.querySelector('.item-kcal').value = it.kcal || '';
    row.querySelector('.item-protein').value = it.protein || '';
    row.querySelector('.item-fat').value = it.fat || '';
    row.querySelector('.item-carbs').value = it.carbs || '';
    row.querySelector('.item-remove').addEventListener('click', () => {
      row.remove();
      updateEditorTotal();
    });
    row.querySelector('.item-kcal').addEventListener('input', updateEditorTotal);
    list.appendChild(row);
  });
  updateEditorTotal();
}

function readItemsFromEditor() {
  return [...document.querySelectorAll('#items-list .item-row')].map(row => ({
    name: row.querySelector('.item-name').value.trim(),
    kcal: Math.round(Number(row.querySelector('.item-kcal').value) || 0),
    protein: Number(row.querySelector('.item-protein').value) || 0,
    fat: Number(row.querySelector('.item-fat').value) || 0,
    carbs: Number(row.querySelector('.item-carbs').value) || 0,
  })).filter(it => it.name);
}

function updateEditorTotal() {
  const total = [...document.querySelectorAll('#items-list .item-kcal')]
    .reduce((s, el) => s + (Number(el.value) || 0), 0);
  $('#editor-total-kcal').textContent = Math.round(total);
}

function openEditor({ items, note = '', source = 'manual', title = '記録内容' }) {
  $('#editor-title').textContent = title;
  $('#meal-date').value = todayStr();
  $('#meal-time').value = nowTimeStr();
  $('#meal-note').value = note;
  $('#meal-editor').dataset.source = source;
  renderItems(items.length ? items : [emptyItem()]);
  $('#meal-editor').hidden = false;
  $('#meal-editor').scrollIntoView({ behavior: 'smooth' });
}

function closeEditor() {
  $('#meal-editor').hidden = true;
  $('#photo-preview-wrap').hidden = true;
  $('#analyze-status').hidden = true;
  $('#text-input').value = '';
  currentImage = null;
}

$('#add-item-btn').addEventListener('click', () => {
  const items = readItemsFromEditorLoose();
  items.push(emptyItem());
  renderItems(items);
});

// 追加時は未入力の行も保持する
function readItemsFromEditorLoose() {
  return [...document.querySelectorAll('#items-list .item-row')].map(row => ({
    name: row.querySelector('.item-name').value,
    kcal: Number(row.querySelector('.item-kcal').value) || 0,
    protein: Number(row.querySelector('.item-protein').value) || 0,
    fat: Number(row.querySelector('.item-fat').value) || 0,
    carbs: Number(row.querySelector('.item-carbs').value) || 0,
  }));
}

$('#cancel-meal-btn').addEventListener('click', closeEditor);

$('#save-meal-btn').addEventListener('click', async () => {
  const items = readItemsFromEditor();
  if (items.length === 0) {
    toast('品目を1つ以上入力してください');
    return;
  }
  const meal = {
    id: db.newId(),
    date: $('#meal-date').value || todayStr(),
    time: $('#meal-time').value || nowTimeStr(),
    items,
    note: $('#meal-note').value.trim(),
    source: $('#meal-editor').dataset.source || 'manual',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  await db.putMeal(meal);
  closeEditor();
  toast(`保存しました (${mealTotal(meal)} kcal)`);
  renderTodaySummary();
  queueSync(meal.date.slice(0, 7));
});

$('#manual-entry-btn').addEventListener('click', () => {
  openEditor({ items: [emptyItem()], title: '手動入力' });
});

// ---------- 記録画面: 写真・テキスト解析 ----------
function setAnalyzeStatus(msg, isError = false) {
  const el = $('#analyze-status');
  el.textContent = msg;
  el.classList.toggle('error', isError);
  el.hidden = !msg;
}

async function handlePhoto(file) {
  if (!file) return;
  try {
    const img = await gemini.prepareImage(file);
    currentImage = img;
    $('#photo-preview').src = img.dataUrl;
    $('#photo-preview-wrap').hidden = false;

    if (!settings.geminiKey) {
      setAnalyzeStatus('Gemini APIキーが未設定のため自動解析できません。設定画面でキーを登録するか、手動で入力してください。', true);
      openEditor({ items: [emptyItem()], source: 'photo', title: '手動入力(写真)' });
      return;
    }

    setAnalyzeStatus('🔍 AIが写真を解析中...');
    const result = await gemini.analyzeFood({ apiKey: settings.geminiKey, image: img });
    if (result.items.length === 0) {
      setAnalyzeStatus('食事を認識できませんでした。手動で入力してください。', true);
      openEditor({ items: [emptyItem()], source: 'photo' });
      return;
    }
    setAnalyzeStatus(`✅ 解析完了${result.note ? ': ' + result.note : ''} — 内容を確認・修正して保存してください`);
    openEditor({ items: result.items, note: '', source: 'photo', title: '解析結果の確認' });
  } catch (e) {
    setAnalyzeStatus(`⚠️ ${e.message}`, true);
    openEditor({ items: [emptyItem()], source: 'photo', title: '手動入力(写真)' });
  }
}

$('#photo-input').addEventListener('change', (e) => {
  handlePhoto(e.target.files[0]);
  e.target.value = '';
});
$('#photo-pick').addEventListener('change', (e) => {
  handlePhoto(e.target.files[0]);
  e.target.value = '';
});

$('#analyze-text-btn').addEventListener('click', analyzeText);
$('#text-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') analyzeText();
});

async function analyzeText() {
  const text = $('#text-input').value.trim();
  if (!text) { toast('食事内容を入力してください'); return; }

  if (!settings.geminiKey) {
    // APIなしでも記録できるように、入力テキストを品目名にして手動入力へ
    const items = text.split(/[、,]/).map(s => ({ ...emptyItem(), name: s.trim() })).filter(it => it.name);
    openEditor({ items, source: 'text', title: '手動入力(カロリーを入力してください)' });
    setAnalyzeStatus('Gemini APIキーが未設定のため自動解析できません。カロリーを手動で入力してください。', true);
    return;
  }

  try {
    setAnalyzeStatus('🔍 AIがテキストを解析中...');
    const result = await gemini.analyzeFood({ apiKey: settings.geminiKey, text });
    if (result.items.length === 0) {
      setAnalyzeStatus('食事を認識できませんでした。手動で入力してください。', true);
      openEditor({ items: [emptyItem()], source: 'text' });
      return;
    }
    setAnalyzeStatus(`✅ 解析完了${result.note ? ': ' + result.note : ''} — 内容を確認・修正して保存してください`);
    openEditor({ items: result.items, source: 'text', title: '解析結果の確認' });
  } catch (e) {
    setAnalyzeStatus(`⚠️ ${e.message}`, true);
    const items = text.split(/[、,]/).map(s => ({ ...emptyItem(), name: s.trim() })).filter(it => it.name);
    openEditor({ items, source: 'text', title: '手動入力' });
  }
}

// ---------- 今日のサマリー ----------
async function renderTodaySummary() {
  const meals = await db.getMealsByRange(todayStr(), todayStr());
  const total = meals.reduce((s, m) => s + mealTotal(m), 0);
  const target = Number(settings.targetKcal) || 0;
  const el = $('#today-summary');
  let html = `今日の合計: <span class="big">${total}</span> kcal(${meals.length}食)`;
  if (target > 0) {
    const diff = target - total;
    html += diff >= 0
      ? `<br>目標まで残り ${diff} kcal`
      : `<br><span class="over">目標を ${-diff} kcal 超過</span>`;
  }
  el.innerHTML = html;
}

// ---------- 履歴画面 ----------
async function renderHistory() {
  const meals = await db.getAllMeals();
  renderChart(meals);

  const list = $('#history-list');
  if (meals.length === 0) {
    list.innerHTML = '<p class="empty-message">まだ記録がありません。<br>「記録」タブから食事を記録してみましょう。</p>';
    return;
  }

  const byDate = new Map();
  for (const m of meals) {
    if (!byDate.has(m.date)) byDate.set(m.date, []);
    byDate.get(m.date).push(m);
  }
  const dates = [...byDate.keys()].sort().reverse();
  const target = Number(settings.targetKcal) || 0;

  list.innerHTML = '';
  for (const date of dates) {
    const dayMeals = byDate.get(date);
    const dayTotal = dayMeals.reduce((s, m) => s + mealTotal(m), 0);
    const group = document.createElement('div');
    group.className = 'day-group';
    const over = target > 0 && dayTotal > target;
    group.innerHTML = `
      <div class="day-header">
        <span>${formatDateJa(date)}</span>
        <span class="day-total ${over ? 'over' : ''}">${dayTotal} kcal</span>
      </div>`;
    for (const meal of dayMeals.slice().reverse()) {
      const card = document.createElement('div');
      card.className = 'meal-card';
      const itemsText = meal.items.map(it => `${it.name} ${it.kcal}kcal`).join(' / ');
      card.innerHTML = `
        <div class="meal-info">
          <div class="meal-time">${meal.time}${sourceIcon(meal.source)}</div>
          <div class="meal-items"></div>
          ${meal.note ? '<div class="meal-note"></div>' : ''}
        </div>
        <div class="meal-kcal">${mealTotal(meal)} kcal</div>
        <button class="meal-delete" title="削除">🗑</button>`;
      card.querySelector('.meal-items').textContent = itemsText;
      if (meal.note) card.querySelector('.meal-note').textContent = meal.note;
      card.querySelector('.meal-delete').addEventListener('click', async () => {
        if (!confirm(`${meal.time} の記録を削除しますか?`)) return;
        await db.markDeleted(meal.id);
        toast('削除しました');
        renderHistory();
        renderTodaySummary();
        queueSync(meal.date.slice(0, 7));
      });
      group.appendChild(card);
    }
    list.appendChild(group);
  }
}

function sourceIcon(source) {
  if (source === 'photo') return ' 📷';
  if (source === 'text') return ' 💬';
  if (source === 'suggest') return ' 💡';
  return '';
}

function formatDateJa(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const week = ['日', '月', '火', '水', '木', '金', '土'][new Date(y, m - 1, d).getDay()];
  const today = todayStr();
  const label = dateStr === today ? ' (今日)' : '';
  return `${m}/${d} (${week})${label}`;
}

// 直近14日のカロリー棒グラフ(SVG)
function renderChart(meals) {
  const days = [];
  const now = new Date();
  for (let i = 13; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    days.push(todayStr(d));
  }
  const totals = days.map(date =>
    meals.filter(m => m.date === date).reduce((s, m) => s + mealTotal(m), 0));

  const target = Number(settings.targetKcal) || 0;
  const maxVal = Math.max(...totals, target, 1);
  const W = 560, H = 180, pad = 4, bottom = 20;
  const barW = (W - pad * 2) / 14;

  let bars = '';
  totals.forEach((v, i) => {
    const h = Math.round((v / maxVal) * (H - bottom - 10));
    const x = pad + i * barW;
    const y = H - bottom - h;
    const over = target > 0 && v > target;
    bars += `<rect x="${x + 2}" y="${y}" width="${barW - 4}" height="${h}" rx="3" fill="${over ? '#c0392b' : '#1a936f'}" opacity="0.85"/>`;
    if (v > 0) {
      bars += `<text x="${x + barW / 2}" y="${y - 3}" text-anchor="middle" font-size="9" fill="currentColor" opacity="0.7">${v}</text>`;
    }
    const day = days[i].slice(8);
    bars += `<text x="${x + barW / 2}" y="${H - 6}" text-anchor="middle" font-size="9" fill="currentColor" opacity="0.6">${Number(day)}</text>`;
  });

  let targetLine = '';
  if (target > 0) {
    const ty = H - bottom - Math.round((target / maxVal) * (H - bottom - 10));
    targetLine = `<line x1="${pad}" y1="${ty}" x2="${W - pad}" y2="${ty}" stroke="#e67e22" stroke-width="1.5" stroke-dasharray="4 3"/>
      <text x="${W - pad}" y="${ty - 4}" text-anchor="end" font-size="9" fill="#e67e22">目標 ${target}</text>`;
  }

  $('#history-chart').innerHTML =
    `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="直近14日間のカロリーグラフ">${bars}${targetLine}</svg>`;
}

// ---------- 提案画面 ----------
let suggestMode = 'any';

document.querySelectorAll('.mode-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    suggestMode = btn.dataset.mode;
    document.querySelectorAll('.mode-btn').forEach(b => {
      const on = b === btn;
      b.classList.toggle('active', on);
      b.setAttribute('aria-checked', String(on));
    });
  });
});

/** APIキーがなくても動く、ローカル集計だけのランキング表示 */
async function renderTasteRanking() {
  const meals = await db.getAllMeals();
  const from = new Date();
  from.setDate(from.getDate() - 90);
  const period = meals.filter(m => m.date >= todayStr(from));
  const ranking = itemRanking(period, 10);
  const el = $('#taste-ranking');

  if (ranking.length === 0) {
    el.innerHTML = '<p class="empty-message">まだ記録がありません。<br>何回か記録すると、ここに好みの傾向が出ます。</p>';
    return;
  }

  el.innerHTML = '';
  ranking.forEach((r, i) => {
    const row = document.createElement('div');
    row.className = 'rank-row';
    row.innerHTML = `<span class="rank-no">${i + 1}</span><span class="rank-name"></span><span class="rank-count">${r.count}回</span>`;
    row.querySelector('.rank-name').textContent = r.name;
    el.appendChild(row);
  });
}

function setSuggestStatus(msg, isError = false) {
  const el = $('#suggest-status');
  el.textContent = msg;
  el.classList.toggle('error', isError);
  el.hidden = !msg;
}

$('#suggest-btn').addEventListener('click', async (e) => {
  if (!settings.geminiKey) {
    setSuggestStatus('提案にはGemini APIキーが必要です。設定画面で登録してください。下の「よく食べているもの」はキーなしでも見られます。', true);
    return;
  }

  const meals = await db.getAllMeals();
  const profile = buildProfile(meals, Number(settings.targetKcal) || 0);

  e.target.disabled = true;
  setSuggestStatus('🤔 好みを分析して候補を考えています...');
  $('#suggest-results').innerHTML = '';

  try {
    const suggestions = await gemini.suggestMeals({
      apiKey: settings.geminiKey,
      profile,
      mode: suggestMode,
      mood: $('#mood-input').value,
    });
    if (suggestions.length === 0) {
      setSuggestStatus('候補を出せませんでした。条件を変えてもう一度試してください。', true);
      return;
    }
    setSuggestStatus('');
    renderSuggestions(suggestions);
  } catch (err) {
    setSuggestStatus(`⚠️ ${err.message}`, true);
  } finally {
    e.target.disabled = false;
  }
});

function renderSuggestions(suggestions) {
  const wrap = $('#suggest-results');
  wrap.innerHTML = '';
  for (const s of suggestions) {
    const card = document.createElement('div');
    card.className = 'suggest-card';
    const isCook = s.type === '自炊';
    card.innerHTML = `
      <div class="sc-head">
        <span class="sc-name"></span>
        <span class="sc-kcal">約 ${s.kcal} kcal</span>
      </div>
      <span class="sc-badge ${isCook ? 'cook' : ''}">${isCook ? '🍳 自炊' : '🏪 外食'}</span>
      <p class="sc-reason"></p>
      ${s.hint ? '<p class="sc-hint"></p>' : ''}
      <button class="btn btn-ghost sc-pick">これにする(記録へ)</button>`;
    card.querySelector('.sc-name').textContent = s.name;
    card.querySelector('.sc-reason').textContent = s.reason;
    if (s.hint) card.querySelector('.sc-hint').textContent = s.hint;
    card.querySelector('.sc-pick').addEventListener('click', () => {
      switchTab('record');
      openEditor({
        items: [{ name: s.name, kcal: s.kcal, protein: 0, fat: 0, carbs: 0 }],
        source: 'suggest',
        title: '提案から記録',
      });
      toast('カロリーは目安です。実際に合わせて修正してください');
    });
    wrap.appendChild(card);
  }
}

// ---------- エクスポート画面 ----------
function initExportView() {
  const now = new Date();
  $('#export-from').value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  $('#export-to').value = todayStr();
}

async function getExportMeals() {
  const from = $('#export-from').value;
  const to = $('#export-to').value;
  if (!from || !to) { toast('期間を指定してください'); return null; }
  const meals = await db.getMealsByRange(from, to);
  if (meals.length === 0) { toast('この期間に記録がありません'); return null; }
  return { meals, from, to };
}

function showPreview(text) {
  $('#export-preview').hidden = false;
  $('#export-preview-text').textContent = text.length > 3000 ? text.slice(0, 3000) + '\n...(省略)' : text;
}

$('#export-md-btn').addEventListener('click', async () => {
  const r = await getExportMeals();
  if (!r) return;
  const md = toMarkdown(r.meals, { title: `食事記録 ${r.from} 〜 ${r.to}` });
  download(`meallog_${r.from}_${r.to}.md`, md, 'text/markdown');
  showPreview(md);
});

$('#export-json-btn').addEventListener('click', async () => {
  const r = await getExportMeals();
  if (!r) return;
  const json = toJSON(r.meals);
  download(`meallog_${r.from}_${r.to}.json`, json, 'application/json');
  showPreview(json);
});

$('#export-csv-btn').addEventListener('click', async () => {
  const r = await getExportMeals();
  if (!r) return;
  const csv = toCSV(r.meals);
  download(`meallog_${r.from}_${r.to}.csv`, csv, 'text/csv');
  showPreview(csv);
});

// ---------- GitHub同期 ----------
const PENDING_KEY = 'meallog-pending-sync';

function getPendingMonths() {
  try { return JSON.parse(localStorage.getItem(PENDING_KEY)) || []; } catch { return []; }
}
function setPendingMonths(months) {
  localStorage.setItem(PENDING_KEY, JSON.stringify([...new Set(months)]));
}

let syncing = false;

function queueSync(ym) {
  setPendingMonths([...getPendingMonths(), ym]);
  runSync();
}

async function runSync() {
  if (syncing) return;
  if (!settings.githubRepo || !settings.githubToken) return;
  if (!navigator.onLine) return;

  const months = getPendingMonths();
  const currentYm = todayStr().slice(0, 7);
  const targets = [...new Set([...months, currentYm])];

  syncing = true;
  const indicator = $('#sync-indicator');
  indicator.hidden = false;
  indicator.textContent = '☁️ 同期中...';
  try {
    const { pulled } = await github.syncMonths(settings.githubRepo, settings.githubToken, targets);
    setPendingMonths([]);
    settings.lastSync = new Date().toISOString();
    saveSettings(settings);
    indicator.textContent = '✅ 同期済み';
    setTimeout(() => { indicator.hidden = true; }, 2000);
    updateLastSyncInfo();
    if (pulled > 0) {
      toast(`他の端末から ${pulled} 件の記録を取り込みました`);
      renderTodaySummary();
    }
  } catch (e) {
    indicator.textContent = '⚠️ 同期失敗';
    setTimeout(() => { indicator.hidden = true; }, 3000);
    console.warn('sync failed:', e);
  } finally {
    syncing = false;
  }
}

window.addEventListener('online', runSync);

// ---------- 設定画面 ----------
function initSettingsView() {
  $('#setting-gemini-key').value = settings.geminiKey || '';
  $('#setting-github-repo').value = settings.githubRepo || '';
  $('#setting-github-token').value = settings.githubToken || '';
  $('#setting-target-kcal').value = settings.targetKcal || '';
  updateLastSyncInfo();
}

function updateLastSyncInfo() {
  const el = $('#last-sync-info');
  if (settings.lastSync) {
    const d = new Date(settings.lastSync);
    el.textContent = `最終同期: ${d.toLocaleString('ja-JP')}`;
  } else {
    el.textContent = '';
  }
}

$('#save-settings-btn').addEventListener('click', () => {
  settings.geminiKey = $('#setting-gemini-key').value.trim();
  settings.githubRepo = $('#setting-github-repo').value.trim();
  settings.githubToken = $('#setting-github-token').value.trim();
  settings.targetKcal = Number($('#setting-target-kcal').value) || 0;
  saveSettings(settings);
  toast('設定を保存しました');
  renderTodaySummary();
});

$('#test-gemini-btn').addEventListener('click', async (e) => {
  const key = $('#setting-gemini-key').value.trim();
  if (!key) { toast('APIキーを入力してください'); return; }
  e.target.disabled = true;
  try {
    await gemini.testConnection(key);
    toast('✅ Gemini接続OK');
  } catch (err) {
    toast(`⚠️ ${err.message}`);
  } finally {
    e.target.disabled = false;
  }
});

$('#test-github-btn').addEventListener('click', async (e) => {
  const repo = $('#setting-github-repo').value.trim();
  const token = $('#setting-github-token').value.trim();
  if (!repo || !token) { toast('リポジトリとトークンを入力してください'); return; }
  e.target.disabled = true;
  try {
    await github.testConnection(repo, token);
    toast('✅ GitHub接続OK');
  } catch (err) {
    toast(`⚠️ ${err.message}`);
  } finally {
    e.target.disabled = false;
  }
});

$('#sync-now-btn').addEventListener('click', async () => {
  if (!settings.githubRepo || !settings.githubToken) {
    toast('リポジトリとトークンを設定・保存してください');
    return;
  }
  // 全記録の月を同期対象にする
  const all = await db.getAllMealsRaw();
  const months = [...new Set(all.map(m => m.date.slice(0, 7)))];
  setPendingMonths(months);
  await runSync();
});

// ---------- 初期化 ----------
initExportView();
initSettingsView();
renderTodaySummary();
runSync();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
