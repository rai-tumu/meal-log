// IndexedDB ラッパー — 食事記録の永続化(端末ローカル)
const DB_NAME = 'meallog';
const DB_VERSION = 1;
const STORE = 'meals';

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
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(db, mode) {
  return db.transaction(STORE, mode).objectStore(STORE);
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

export function newId() {
  return crypto.randomUUID ? crypto.randomUUID() :
    Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}
