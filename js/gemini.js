// Gemini API(無料枠)で食事写真・テキストからカロリー推定

// ---------- モデル選択 ----------
// 実測(2026-08〜09: AI呼び出し111回 / 28日、平均4回/日・ピーク8回/日)にもとづく既定値。
//   写真解析(月32回)   … 盛り付けから分量を見積もる部分に精度が効くので、最上位のFlashを使う。
//   提案(月30回程度)   … 好みの読み取りと献立の組み立ては推論力が効くので、写真と同じモデル。
//   テキスト解析(月79回) … 回数が多く精度差も出にくい。単価は2.5 Flashと同額のまま世代だけ
//                          新しくできるFlash-Liteに置く。
export const VISION_MODEL = 'gemini-3.5-flash';
export const TEXT_MODEL = 'gemini-3.5-flash-lite';
export const SUGGEST_MODEL = 'gemini-3.5-flash';
// モデル廃止(404)や上限超過(429)のときに落とす先。常に枠の広い世代を置くこと。
export const FALLBACK_MODEL = 'gemini-2.5-flash';

// 用途(kind)ごとの既定モデル
const MODEL_BY_KIND = {
  vision: VISION_MODEL,
  text: TEXT_MODEL,
  suggest: SUGGEST_MODEL,
};

/** 設定画面のモデル選択に出す候補。値が空文字なら用途別の既定を使う。 */
export const MODEL_OPTIONS = [
  { value: '', label: `自動(写真・提案: ${VISION_MODEL} / テキスト: ${TEXT_MODEL})` },
  { value: VISION_MODEL, label: `${VISION_MODEL}(すべてこれで解析)` },
  { value: TEXT_MODEL, label: `${TEXT_MODEL}(すべてこれで解析)` },
  { value: FALLBACK_MODEL, label: `${FALLBACK_MODEL}(すべてこれで解析)` },
];

const endpointFor = (model) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

// 設定画面で明示指定されたモデルID。空なら用途別の既定(VISION/TEXT)を使う。
let modelOverride = '';
export function setModelOverride(model) {
  modelOverride = (model || '').trim();
}

// このセッションで使えないと分かったモデル。毎回1回分を無駄打ちしないよう覚えておく。
// 429(日次上限)も含めるが、翌日や再読み込み後にはまた既定モデルから試される。
const unavailableModels = new Set();

function resolveModel(kind) {
  const model = modelOverride || MODEL_BY_KIND[kind] || TEXT_MODEL;
  return unavailableModels.has(model) ? FALLBACK_MODEL : model;
}

const PROMPT = `あなたは栄養士です。与えられた食事(写真またはテキスト)に含まれる料理を特定し、
日本の一般的な提供量を基準に、品目ごとの推定カロリーと栄養素を算出してください。

品目の分け方(重要):
- 品目は「メニューに載る料理名」の単位で数えること。ルー・具材・調味料・ご飯・麺などの材料単位に分解しないこと。
- ご飯やナンと一緒に食べる料理は1品にまとめること(例: カレー+ご飯 → 「カレーライス」、牛肉+ご飯 → 「牛丼」)。まとめた品目のkcal/栄養素には、ご飯やルーなど構成要素すべての分を含めること。
- ソース・タレ・薬味・調味料・油は独立した品目にせず、その分のカロリーを料理側に含めて算出すること。
- 別皿・別容器で提供される別の料理(定食の味噌汁やサラダ、寿司の各ネタ、ドリンク、デザートなど)は、それぞれ別の品目としてよい。
- 悪い例: 「カレーのルー」「じゃがいも」「白米」を別品目にする。良い例: 「カレーライス」として1品にまとめる。

必ず次のJSON形式のみで回答してください:
{
  "items": [
    {"name": "品目名(日本語)", "kcal": 数値, "protein": 数値, "fat": 数値, "carbs": 数値}
  ],
  "note": "推定の根拠や量の想定などの補足(簡潔に)"
}

- kcalは整数、protein/fat/carbsはグラム単位の数値(小数1桁まで)
- 量が写真から判断できる場合は考慮すること
- 食事と関係ない入力の場合は items を空配列にすること`;

/**
 * 画像をリサイズしてbase64(JPEG)に変換。無料枠と通信量の節約のため縮小する。
 * @param {File} file
 * @returns {Promise<{base64: string, mimeType: string, dataUrl: string}>}
 */
export async function prepareImage(file, maxSize = 1024) {
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

  const img = await new Promise((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error('画像を読み込めませんでした'));
    el.src = dataUrl;
  });

  const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);

  const jpegUrl = canvas.toDataURL('image/jpeg', 0.8);
  return {
    base64: jpegUrl.split(',')[1],
    mimeType: 'image/jpeg',
    dataUrl: jpegUrl,
  };
}

function postToModel({ apiKey, model, body }) {
  return fetch(`${endpointFor(model)}?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });
}

/**
 * JSONモードでGeminiを呼び、パース済みオブジェクトを返す。
 * 指定モデルが使えない(404)/上限超過(429)なら、枠の広いモデルへ1度だけ落として続行する。
 * 記録できないより、少し精度の落ちるモデルでも記録できる方を優先する。
 * @returns {Promise<{parsed: object, model: string, fellBack: boolean}>}
 */
async function callGeminiJson({ apiKey, parts, temperature, parseErrorMessage, kind = 'text' }) {
  const body = JSON.stringify({
    contents: [{ parts }],
    generationConfig: {
      response_mime_type: 'application/json',
      temperature,
    },
  });

  let model = resolveModel(kind);
  let res = await postToModel({ apiKey, model, body });
  let fellBack = false;

  if (!res.ok && model !== FALLBACK_MODEL && (res.status === 404 || res.status === 429)) {
    unavailableModels.add(model);
    model = FALLBACK_MODEL;
    fellBack = true;
    res = await postToModel({ apiKey, model, body });
  }

  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    if (res.status === 400 && errBody.includes('API_KEY')) {
      throw new Error('APIキーが無効です。設定を確認してください。');
    }
    if (res.status === 429) {
      throw new Error('無料枠の利用上限に達しました。しばらく待ってから試してください。');
    }
    if (res.status === 404) {
      throw new Error(`モデル ${model} を利用できません。設定画面でモデルを変更してください。`);
    }
    throw new Error(`Gemini APIエラー (${res.status})`);
  }

  const data = await res.json();
  const textOut = data?.candidates?.[0]?.content?.parts?.map(p => p.text).join('') ?? '';
  try {
    return { parsed: JSON.parse(textOut), model, fellBack };
  } catch {
    throw new Error(parseErrorMessage);
  }
}

/**
 * 食事を解析する。imageかtextのどちらかを渡す。
 * @returns {Promise<{items: Array, note: string, model: string, fellBack: boolean}>}
 *   model は実際に応答したモデルID、fellBack はフォールバックが起きたかどうか
 */
export async function analyzeFood({ apiKey, image, text }) {
  const parts = [{ text: PROMPT }];
  if (image) {
    parts.push({ inline_data: { mime_type: image.mimeType, data: image.base64 } });
  }
  if (text) {
    parts.push({ text: `食事内容: ${text}` });
  }

  const { parsed, model, fellBack } = await callGeminiJson({
    apiKey,
    parts,
    temperature: 0.2,
    parseErrorMessage: '解析結果を読み取れませんでした。もう一度試すか手動入力してください。',
    kind: image ? 'vision' : 'text',
  });

  const items = (parsed.items || []).map(it => ({
    name: String(it.name ?? ''),
    kcal: Math.round(Number(it.kcal) || 0),
    protein: Number(it.protein) || 0,
    fat: Number(it.fat) || 0,
    carbs: Number(it.carbs) || 0,
  })).filter(it => it.name);

  return { items, note: String(parsed.note ?? ''), model, fellBack };
}

const SUGGEST_PROMPT = `あなたは、その人の食事履歴を熟知した管理栄養士です。
これまでの記録から好みを読み取り、「次に何を食べるか」の候補を提案してください。

必ず次のJSON形式のみで回答してください:
{
  "suggestions": [
    {
      "name": "料理名(日本語)",
      "reason": "その人の好みや状況を踏まえた提案理由(50字程度)",
      "kcal": 数値,
      "type": "外食" または "自炊",
      "hint": "自炊なら作り方の要点、外食なら選び方のコツ(40字程度)"
    }
  ]
}

提案のルール:
- 候補は4件。バリエーションを持たせ、同系統の料理ばかりにしないこと
- 「よく食べている料理」はその人の好みの証拠として扱い、系統(味付け・食材・ジャンル)を踏まえた候補を出すこと
- ただし「直近に食べたもの」と同じ料理は避けること
- 残りカロリーが提示されている場合は、その範囲に収まる候補を優先すること
- 日本で一般的に食べられる、実際に用意できる料理にすること
- reason では「〇〇をよく召し上がっているので」のように、履歴を踏まえたことが伝わる書き方をすること`;

/**
 * 好みプロファイルをもとに食事候補を提案する。
 * @param {object} profile suggest.js の buildProfile() の結果
 * @param {string} mode 'any' | 'eatout' | 'cook'
 * @param {string} mood 気分の自由入力(任意)
 * @returns {Promise<Array<{name,reason,kcal,type,hint}>>}
 */
export async function suggestMeals({ apiKey, profile, mode = 'any', mood = '' }) {
  const lines = [];

  if (profile.ranking.length > 0) {
    lines.push('【よく食べている料理(回数順)】');
    lines.push(profile.ranking.map(r => `${r.name} (${r.count}回, 約${r.avgKcal}kcal)`).join(' / '));
  } else {
    lines.push('【よく食べている料理】記録がまだ少ないため不明');
  }

  const slotEntries = Object.entries(profile.bySlot || {});
  if (slotEntries.length > 0) {
    lines.push('【時間帯ごとの傾向】');
    lines.push(slotEntries.map(([slot, names]) => `${slot}: ${names.join('、')}`).join(' / '));
  }

  if (profile.recentItems.length > 0) {
    lines.push(`【直近3日に食べたもの(避けたい)】${profile.recentItems.join('、')}`);
  }

  lines.push(`【今から食べる区分】${profile.slot}`);

  if (profile.remainingKcal !== null) {
    lines.push(`【今日の残りカロリー】${profile.remainingKcal} kcal(目標 ${profile.targetKcal} kcal のうち ${profile.todayKcal} kcal 摂取済み)`);
  } else if (profile.kcalPerMeal > 0) {
    lines.push(`【1食あたりの平均】約 ${profile.kcalPerMeal} kcal`);
  }

  const modeText = { eatout: '外食で食べられるものだけを提案してください。', cook: '自炊で作れるものだけを提案してください。' }[mode];
  if (modeText) lines.push(`【条件】${modeText}`);

  if (mood.trim()) lines.push(`【今の気分・リクエスト】${mood.trim()}`);

  if (profile.recordCount < 10) {
    lines.push('【注記】記録がまだ少ないため、好みの推定は控えめにし、一般的で失敗の少ない候補を中心に提案してください。');
  }

  const { parsed } = await callGeminiJson({
    apiKey,
    parts: [{ text: SUGGEST_PROMPT }, { text: lines.join('\n') }],
    temperature: 0.9, // 提案は毎回変化してほしいので高め
    parseErrorMessage: '提案を読み取れませんでした。もう一度試してください。',
    kind: 'suggest',
  });

  return (parsed.suggestions || []).map(s => ({
    name: String(s.name ?? ''),
    reason: String(s.reason ?? ''),
    kcal: Math.round(Number(s.kcal) || 0),
    type: s.type === '自炊' ? '自炊' : '外食',
    hint: String(s.hint ?? ''),
  })).filter(s => s.name);
}

/**
 * 設定画面の接続テスト用。写真解析に使うモデルで疎通を確認する
 * (テキスト用は写真用より枠の広いモデルなので、こちらが通れば実用上は足りる)。
 * @returns {Promise<{model: string}>} 応答したモデルID
 */
export async function testConnection(apiKey, model) {
  // 空文字は「自動」の意味なので、写真解析の既定モデルを試す
  const target = (model || '').trim() || VISION_MODEL;
  const body = JSON.stringify({ contents: [{ parts: [{ text: 'test: reply "ok"' }] }] });
  const res = await postToModel({ apiKey, model: target, body });
  if (res.status === 404) {
    throw new Error(`モデル ${target} を利用できません。モデルIDを確認してください。`);
  }
  if (!res.ok) throw new Error(`接続失敗 (${res.status})`);
  return { model: target };
}
