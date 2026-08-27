// GitHub REST API (contents) でプライベートリポジトリへ月別JSON/Markdownを同期
// 方式: pull(リモート取得) → merge(idごとにupdated_atが新しい方を採用) → push
import { getMealsByMonthRaw, putMeal, getAllTemplatesRaw, putTemplate } from './db.js';
import { toMarkdown, mealTotal } from './export.js';

const API = 'https://api.github.com';

function headers(token) {
  return {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

// UTF-8対応のbase64エンコード/デコード
function encodeB64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}
function decodeB64(b64) {
  const bin = atob(b64.replace(/\n/g, ''));
  const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/** @returns {Promise<{content: string, sha: string} | null>} 404ならnull */
async function getFile(repo, token, path) {
  const res = await fetch(`${API}/repos/${repo}/contents/${path}`, { headers: headers(token) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub取得エラー (${res.status})`);
  const data = await res.json();
  return { content: decodeB64(data.content), sha: data.sha };
}

async function putFile(repo, token, path, content, sha, message) {
  const body = { message, content: encodeB64(content) };
  if (sha) body.sha = sha;
  const res = await fetch(`${API}/repos/${repo}/contents/${path}`, {
    method: 'PUT',
    headers: { ...headers(token), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    if (res.status === 401) throw new Error('トークンが無効です。設定を確認してください。');
    if (res.status === 404) throw new Error('リポジトリが見つかりません。owner/name とトークンの権限を確認してください。');
    if (res.status === 409) throw new Error('コンフリクトが発生しました。もう一度同期してください。');
    throw new Error(`GitHub書き込みエラー (${res.status})`);
  }
}

/** 設定画面の接続テスト */
export async function testConnection(repo, token) {
  const res = await fetch(`${API}/repos/${repo}`, { headers: headers(token) });
  if (res.status === 404) throw new Error('リポジトリが見つかりません(名前またはトークン権限を確認)');
  if (res.status === 401) throw new Error('トークンが無効です');
  if (!res.ok) throw new Error(`接続失敗 (${res.status})`);
  return true;
}

/**
 * 1ヶ月分を同期。リモートとローカルをidでマージし、両方に反映する。
 * @param {string} ym 'YYYY-MM'
 * @returns {Promise<{pulled: number}>} リモートから取り込んだ件数
 */
export async function syncMonth(repo, token, ym) {
  const jsonPath = `meals/${ym}.json`;
  const mdPath = `meals/${ym}.md`;

  const remoteFile = await getFile(repo, token, jsonPath);
  let remoteMeals = [];
  if (remoteFile) {
    try {
      const parsed = JSON.parse(remoteFile.content);
      remoteMeals = [...(parsed.meals || []), ...(parsed.tombstones || [])];
    } catch { remoteMeals = []; }
  }

  const localMeals = await getMealsByMonthRaw(ym);

  // idごとにupdated_atの新しい方を採用
  const merged = new Map();
  for (const m of remoteMeals) merged.set(m.id, m);
  let pulled = 0;
  const localIds = new Set(localMeals.map(m => m.id));
  for (const m of localMeals) {
    const r = merged.get(m.id);
    if (!r || (m.updated_at || '') >= (r.updated_at || '')) merged.set(m.id, m);
  }

  // リモートにしかない/リモートの方が新しい記録をローカルへ取り込む
  for (const [id, m] of merged) {
    const local = localMeals.find(l => l.id === id);
    if (!local || (m.updated_at || '') > (local.updated_at || '')) {
      await putMeal(m);
      if (!localIds.has(id)) pulled++;
    }
  }

  const all = [...merged.values()].sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  const active = all.filter(m => !m.deleted);

  const jsonContent = JSON.stringify({
    format: 'meallog-v1',
    month: ym,
    updated_at: new Date().toISOString(),
    meals: active.map(m => ({
      id: m.id, date: m.date, time: m.time, items: m.items,
      total_kcal: mealTotal(m), note: m.note || '', source: m.source || 'manual',
      updated_at: m.updated_at,
    })),
    tombstones: all.filter(m => m.deleted).map(m => ({ id: m.id, date: m.date, time: m.time, deleted: true, updated_at: m.updated_at })),
  }, null, 2);

  // 内容が変わらなければpushしない
  if (!remoteFile || normalizeJson(remoteFile.content) !== normalizeJson(jsonContent)) {
    await putFile(repo, token, jsonPath, jsonContent, remoteFile?.sha, `MealLog sync ${ym}`);
    const mdContent = toMarkdown(active, { title: `食事記録 ${ym}` });
    const remoteMd = await getFile(repo, token, mdPath);
    await putFile(repo, token, mdPath, mdContent, remoteMd?.sha, `MealLog sync ${ym} (md)`);
  }

  return { pulled };
}

// updated_atフィールドの差だけでpushしないよう、比較時はトップレベルのupdated_atを除外
function normalizeJson(str) {
  try {
    const obj = JSON.parse(str);
    delete obj.updated_at;
    return JSON.stringify(obj);
  } catch { return str; }
}

/**
 * テンプレート(templates.json 単一ファイル)を同期。方式はsyncMonthと同じ
 * pull → idごとにupdated_atの新しい方を採用 → 変化があればpush。
 * @returns {Promise<{pulled: number, changed: boolean}>} pulled=取り込んだ新規件数, changed=リモートから何か更新されたか
 */
export async function syncTemplates(repo, token) {
  const path = 'templates.json';

  const remoteFile = await getFile(repo, token, path);
  let remoteTpls = [];
  if (remoteFile) {
    try {
      const parsed = JSON.parse(remoteFile.content);
      remoteTpls = [...(parsed.templates || []), ...(parsed.tombstones || [])];
    } catch { remoteTpls = []; }
  }

  const localTpls = await getAllTemplatesRaw();

  const merged = new Map();
  for (const t of remoteTpls) merged.set(t.id, t);
  const localIds = new Set(localTpls.map(t => t.id));
  for (const t of localTpls) {
    const r = merged.get(t.id);
    if (!r || (t.updated_at || '') >= (r.updated_at || '')) merged.set(t.id, t);
  }

  let pulled = 0;
  let changed = false;
  for (const [id, t] of merged) {
    const local = localTpls.find(l => l.id === id);
    if (!local || (t.updated_at || '') > (local.updated_at || '')) {
      await putTemplate(t);
      changed = true;
      if (!localIds.has(id)) pulled++;
    }
  }

  const all = [...merged.values()].sort((a, b) => a.name.localeCompare(b.name, 'ja'));
  const jsonContent = JSON.stringify({
    format: 'meallog-templates-v1',
    updated_at: new Date().toISOString(),
    templates: all.filter(t => !t.deleted),
    tombstones: all.filter(t => t.deleted).map(t => ({ id: t.id, name: t.name, deleted: true, updated_at: t.updated_at })),
  }, null, 2);

  if (!remoteFile || normalizeJson(remoteFile.content) !== normalizeJson(jsonContent)) {
    await putFile(repo, token, path, jsonContent, remoteFile?.sha, 'MealLog sync templates');
  }

  return { pulled, changed };
}

/** 複数月をまとめて同期 */
export async function syncMonths(repo, token, months) {
  let pulled = 0;
  for (const ym of months) {
    const r = await syncMonth(repo, token, ym);
    pulled += r.pulled;
  }
  return { pulled };
}
