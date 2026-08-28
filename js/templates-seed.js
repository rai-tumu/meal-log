// シードテンプレート — 栄養値は日本食品標準成分表2020年版(八訂)/増補2023年に基づく
// 炭水化物は成分表の「炭水化物」欄(利用可能炭水化物ではない)を採用している。
// 果物の1個あたりの値は「100gあたりの値 × 可食部の目安重量」で換算。
// 【推定】は成分表未収載のため計算値を用いた品目。
// mode 'per100g': kcal/P/F/C は可食部100gあたり、step はグラムの刻み幅。
// mode 'unit':    kcal/P/F/C は1単位(unitLabel)あたり、step は個数の刻み幅。

// 全端末で同一レコードになるよう固定タイムスタンプ(既存シードでは変更しないこと)
export const SEED_TS = '2026-08-27T00:00:00.000Z';

export const SEED_TEMPLATES = [
  // ---- 米(100gあたり・50g刻み) ----
  { id: 'seed-rice',   name: '白米(ごはん)',      category: 'rice', mode: 'per100g', kcal: 156, protein: 2.5, fat: 0.3, carbs: 37.1, step: 50, defaultQty: 150 },
  { id: 'seed-genmai', name: '玄米ごはん',        category: 'rice', mode: 'per100g', kcal: 152, protein: 2.8, fat: 1.0, carbs: 35.6, step: 50, defaultQty: 150 },
  { id: 'seed-mugi',   name: '麦ごはん(押麦3割)', category: 'rice', mode: 'per100g', kcal: 152, protein: 2.7, fat: 0.4, carbs: 36.2, step: 50, defaultQty: 150 },

  // ---- 果物(1個/1本あたり・0.5刻み。粒で食べるものは100gあたり) ----
  { id: 'seed-banana', name: 'バナナ', category: 'fruit', mode: 'unit', kcal: 84,  protein: 1.0, fat: 0.2, carbs: 20.3, unitLabel: '本', step: 0.5, defaultQty: 1 },
  { id: 'seed-apple',  name: 'りんご', category: 'fruit', mode: 'unit', kcal: 133, protein: 0.3, fat: 0.5, carbs: 38.8, unitLabel: '個', step: 0.5, defaultQty: 1 },
  { id: 'seed-mikan',  name: 'みかん', category: 'fruit', mode: 'unit', kcal: 37,  protein: 0.5, fat: 0.1, carbs: 9.0,  unitLabel: '個', step: 0.5, defaultQty: 1 },
  { id: 'seed-nashi',  name: '梨',     category: 'fruit', mode: 'unit', kcal: 95,  protein: 0.8, fat: 0.3, carbs: 28.3, unitLabel: '個', step: 0.5, defaultQty: 1 },
  { id: 'seed-momo',   name: '桃',     category: 'fruit', mode: 'unit', kcal: 65,  protein: 1.0, fat: 0.2, carbs: 17.3, unitLabel: '個', step: 0.5, defaultQty: 1 },
  { id: 'seed-kiwi',   name: 'キウイ', category: 'fruit', mode: 'unit', kcal: 43,  protein: 0.9, fat: 0.2, carbs: 11.4, unitLabel: '個', step: 0.5, defaultQty: 1 },
  { id: 'seed-ichigo', name: 'いちご', category: 'fruit', mode: 'per100g', kcal: 31, protein: 0.9, fat: 0.1, carbs: 8.5,  step: 50, defaultQty: 100 },
  { id: 'seed-budou',  name: 'ぶどう', category: 'fruit', mode: 'per100g', kcal: 58, protein: 0.4, fat: 0.1, carbs: 15.7, step: 50, defaultQty: 100 },

  // ---- 卵 ----
  { id: 'seed-egg', name: '卵', category: 'egg', mode: 'unit', kcal: 71, protein: 6.1, fat: 5.1, carbs: 0.2, unitLabel: '個', step: 1, defaultQty: 1 },
];

// 旧シード(米・果物・卵以外)。読み込み時にトゥームストーン化して他端末からも消す。
export const RETIRED_SEED_IDS = [
  'seed-tofu', 'seed-yogurt', 'seed-milk', 'seed-calpis',
  'seed-chicken', 'seed-natto', 'seed-shokupan', 'seed-miso',
];

// 記録画面での表示順とラベル
export const CATEGORIES = [
  { key: 'rice',  label: '米' },
  { key: 'fruit', label: '果物' },
  { key: 'egg',   label: '卵' },
  { key: 'other', label: 'その他' },
];
