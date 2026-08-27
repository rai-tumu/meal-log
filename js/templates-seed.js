// シードテンプレート — 栄養値は日本食品標準成分表2020年版(八訂)/増補2023年に基づく
// (成分表未収載の【推定】3品: 麦ごはん=精白米めし7:押麦めし3の計算値、
//  味噌汁=一般的レシピからの推定、カルピス=メーカー公表値ベース)
// per100g: kcal/P/F/C は可食部100gあたり。unit: 1単位(unitLabel)あたり。

// 全端末で同一レコードになるよう固定タイムスタンプ(既存シードでは変更しないこと)
export const SEED_TS = '2026-08-27T00:00:00.000Z';

export const SEED_TEMPLATES = [
  // ---- 100gあたり(グラム刻み) ----
  { id: 'seed-rice',     name: '白米(ごはん)',         mode: 'per100g', kcal: 156, protein: 2.5,  fat: 0.3, carbs: 37.1, step: 50, defaultQty: 150 },
  { id: 'seed-genmai',   name: '玄米ごはん',           mode: 'per100g', kcal: 152, protein: 2.8,  fat: 1.0, carbs: 35.6, step: 50, defaultQty: 150 },
  { id: 'seed-mugi',     name: '麦ごはん(押麦3割)',    mode: 'per100g', kcal: 152, protein: 2.7,  fat: 0.4, carbs: 36.2, step: 50, defaultQty: 150 },
  { id: 'seed-tofu',     name: '木綿豆腐',             mode: 'per100g', kcal: 73,  protein: 7.0,  fat: 4.9, carbs: 1.5,  step: 50, defaultQty: 150 },
  { id: 'seed-yogurt',   name: 'ヨーグルト(無糖)',     mode: 'per100g', kcal: 56,  protein: 3.6,  fat: 3.0, carbs: 4.9,  step: 50, defaultQty: 100 },
  { id: 'seed-apple',    name: 'りんご(皮なし)',       mode: 'per100g', kcal: 53,  protein: 0.1,  fat: 0.2, carbs: 15.5, step: 50, defaultQty: 200 },
  { id: 'seed-nashi',    name: '梨',                   mode: 'per100g', kcal: 38,  protein: 0.3,  fat: 0.1, carbs: 11.3, step: 50, defaultQty: 250 },
  { id: 'seed-milk',     name: '牛乳',                 mode: 'per100g', kcal: 61,  protein: 3.3,  fat: 3.8, carbs: 4.8,  step: 50, defaultQty: 200 },
  { id: 'seed-calpis',   name: 'カルピス(希釈)',       mode: 'per100g', kcal: 45,  protein: 0.3,  fat: 0,   carbs: 11.0, step: 50, defaultQty: 200 },
  { id: 'seed-chicken',  name: 'サラダチキン',         mode: 'per100g', kcal: 105, protein: 23.0, fat: 1.5, carbs: 0.5,  step: 50, defaultQty: 100 },
  // ---- 1単位あたり(個数) ----
  { id: 'seed-egg',      name: '卵',                   mode: 'unit', kcal: 71,  protein: 6.1, fat: 5.1, carbs: 0.2,  unitLabel: '個',     defaultQty: 1 },
  { id: 'seed-natto',    name: '納豆',                 mode: 'unit', kcal: 83,  protein: 7.4, fat: 4.5, carbs: 5.4,  unitLabel: 'パック', defaultQty: 1 },
  { id: 'seed-shokupan', name: '食パン(6枚切)',        mode: 'unit', kcal: 149, protein: 5.3, fat: 2.5, carbs: 27.8, unitLabel: '枚',     defaultQty: 1 },
  { id: 'seed-banana',   name: 'バナナ',               mode: 'unit', kcal: 84,  protein: 1.0, fat: 0.2, carbs: 20.3, unitLabel: '本',     defaultQty: 1 },
  { id: 'seed-miso',     name: '味噌汁(豆腐・わかめ)', mode: 'unit', kcal: 40,  protein: 3.0, fat: 1.5, carbs: 4.5,  unitLabel: '杯',     defaultQty: 1 },
];
