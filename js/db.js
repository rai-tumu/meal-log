// IndexedDB ラッパー — 食事記録・テンプレートの永続化(端末ローカル)
const DB_NAME = 'meallog';
const DB_VERSION = 2;
const STORE = 'meals';
const TPL_STORE = 'templates';

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('date', 'date');
      }
      if (!db.objectStoreNames.contains(TPL_STORE)) {
        db.createObjectStore(TPL_STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      // 他のタブがバージョン升級を始めたら接続を手放す(升級のブロックを防ぐ)
      db.onversionchange = () => { db.close(); dbPromise = null; };
      resolve(db);
    };
    req.onerror = () => reject(req.error);
    // 別タブが古いバージョンで開いたままだと升級できない
    req.onblocked = () => reject(new Error('別のタブでアプリが開いています。すべて閉じてから再読み込みしてください'));
  });
  return dbPromise;
}

function tx(db, mode, store = STORE) {
  return db.transaction(store, mode).objectStore(store);
}

function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function putMeal(meal) {
  const db = await openDB();
  return reqToPromise(tx(db, 'readwrite').put(meal));
}

export async function getMeal(id) {
  const db = await openDB();
  return reqToPromise(tx(db, 'readonly').get(id));
}

/** 削除はトゥームストーン方式(GitHub同期で他端末にも削除を伝播するため) */
export async function markDeleted(id) {
  const meal = await getMeal(id);
  if (!meal) return;
  meal.deleted = true;
  meal.updated_at = new Date().toISOString();
  await putMeal(meal);
}

/** 全件(削除済み含む)— 同期用 */
export async function getAllMealsRaw() {
  const db = await openDB();
  return reqToPromise(tx(db, 'readonly').getAll());
}

/** 有効な記録のみ、日付・時刻順 */
export async function getAllMeals() {
  const all = await getAllMealsRaw();
  return all
    .filter(m => !m.deleted)
    .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
}

/** from/to は 'YYYY-MM-DD'(両端含む) */
export async function getMealsByRange(from, to) {
  const all = await getAllMeals();
  return all.filter(m => m.date >= from && m.date <= to);
}

/** ym は 'YYYY-MM'。削除済み含む(同期用) */
export async function getMealsByMonthRaw(ym) {
  const all = await getAllMealsRaw();
  return all.filter(m => m.date.startsWith(ym));
}

// ---------- テンプレート ----------

export async function putTemplate(tpl) {
  const db = await openDB();
  return reqToPromise(tx(db, 'readwrite', TPL_STORE).put(tpl));
}

export async function getTemplate(id) {
  const db = await openDB();
  return reqToPromise(tx(db, 'readonly', TPL_STORE).get(id));
}

/** 全件(削除済み含む)— 同期・シード投入用 */
export async function getAllTemplatesRaw() {
  const db = await openDB();
  // 古いバージョンのdb.jsがキャッシュから読み込まれた場合などにストアが無いことがある。
  // 例外にせず空配列を返し、テンプレート機能だけ静かに無効化する。
  if (!db.objectStoreNames.contains(TPL_STORE)) return [];
  return reqToPromise(tx(db, 'readonly', TPL_STORE).getAll());
}

/** 有効なテンプレートのみ、名前順 */
export async function getAllTemplates() {
  const all = await getAllTemplatesRaw();
  return all
    .filter(t => !t.deleted)
    .sort((a, b) => a.name.localeCompare(b.name, 'ja'));
}

/** 削除はトゥームストーン方式(mealsと同じ・同期で他端末へ削除を伝播) */
export async function markTemplateDeleted(id) {
  const tpl = await getTemplate(id);
  if (!tpl) return;
  tpl.deleted = true;
  tpl.updated_at = new Date().toISOString();
  await putTemplate(tpl);
}

export function newId() {
  return crypto.randomUUID ? crypto.randomUUID() :
    Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}
