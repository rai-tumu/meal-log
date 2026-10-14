// Gemini API(無料枠)で食事写真・テキストからカロリー推定

// ---------- モデル選択 ----------
// 実測(2026-08〜09: AI呼び出し111回 / 28日、平均4回/日・ピーク8回/日)にもとづく既定値。
//   写真解析(月32回)   … 盛り付けから分量を見積もる部分に精度が効くので、最新のFlashを使う。
//   提案(月30回程度)   … 好みの読み取りと献立の組み立ては推論力が効くので、写真と同じモデル。
//   テキスト解析(月79回) … 回数が多く精度差も出にくいので、無料枠の広いFlash-Liteに置く。
// 3.8 Flash は無料枠の1日上限が小さい(20回/日程度)が、写真+提案は平均2回/日なので収まる。
export const VISION_MODEL = 'gemini-3.8-flash';
export const TEXT_MODEL = 'gemini-3.5-flash-lite';
export const SUGGEST_MODEL = 'gemini-3.8-flash';
// 失敗時に落とす先。常に枠が広く、廃止予定のない世代を置くこと
// (以前の gemini-2.5-flash は 2026-10 に提供終了予定のため差し替えた)。
export const FALLBACK_MODEL = 'gemini-3.5-flash-lite';
// 落とす先そのもの(テキスト解析の既定)が失敗したときの落とし先
const SECONDARY_FALLBACK_MODEL = 'gemini-3.6-flash';

const fallbackFor = (model) => (model === FALLBACK_MODEL ? SECONDARY_FALLBACK_MODEL : FALLBACK_MODEL);

// 廃止されたモデルIDの読み替え。廃止モデルはエラーにならず別モデルへ黙って転送されたり、
// 提供終了でフォールバック続きになったりするため、保存済みの設定もここで新しいIDに寄せる。
// 値が空文字なら「自動(用途別の既定)」に戻す。
const REPLACED_MODELS = {
  'gemini-3.5-flash': 'gemini-3.8-flash', // 2026-10-08 廃止。API上は 3.6 Flash へ転送される
  'gemini-3.7-flash': 'gemini-3.8-flash', // 2026-10-08 廃止。API上は 3.8 Flash へ転送される
  'gemini-2.5-flash': '',                 // 2026-10 提供終了予定
  'gemini-2.5-flash-lite': '',
  'gemini-2.5-pro': '',
};

/** 廃止済みのモデルIDを後継に読み替える。該当しなければそのまま返す */
export function normalizeModelId(model) {
  const id = (model || '').trim();
  return Object.hasOwn(REPLACED_MODELS, id) ? REPLACED_MODELS[id] : id;
}

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
];

const endpointFor = (model) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

// 設定画面で明示指定されたモデルID。空なら用途別の既定(VISION/TEXT)を使う。
let modelOverride = '';
export function setModelOverride(model) {
  modelOverride = normalizeModelId(model);
}

// このセッションで使えないと分かったモデルと、使わない期限(ms)。毎回1回分を無駄打ちしないよう覚えておく。
// 404(廃止)はセッション中ずっと、429(上限超過)は分単位の制限で解けることが多いので一定時間だけ避ける。
const unavailableUntil = new Map();
const RATE_LIMIT_COOLDOWN_MS = 10 * 60 * 1000;

function isUnavailable(model) {
  const until = unavailableUntil.get(model);
  if (until === undefined) return false;
  if (Date.now() < until) return true;
  unavailableUntil.delete(model);
  return false;
}

const preferredModel = (kind) => modelOverride || MODEL_BY_KIND[kind] || TEXT_MODEL;

function resolveModel(kind) {
  const model = preferredModel(kind);
  return isUnavailable(model) ? fallbackFor(model) : model;
}

// ---------- タイムアウト・生成設定 ----------
// 応答待ちの上限。品数の多い写真は推論が長くなるが、上限なしだとスマホのブラウザ側で
// 通信が切れて原因の分からない失敗になるため、こちらで打ち切ってフォールバックへ回す。
const TIMEOUT_MS = { vision: 40000, text: 20000, suggest: 30000 };
const TEST_TIMEOUT_MS = 15000;
// 混雑(500/503/504)や通信断のとき、同じモデルで再試行するまでの待ち時間
const RETRY_DELAY_MS = 1500;

const isGemini3 = (model) => /^gemini-3/.test(model);
const isGemini25 = (model) => /^gemini-2\.5/.test(model);

/**
 * モデル世代に合わせた generationConfig。
 * - 3.x: 思考量を thinkingLevel で抑える(既定のままだと品数に比例して思考が伸び、遅延とタイムアウトの主因になる)。
 *   temperature は公式推奨どおり既定の1.0に任せる(下げるとループや劣化が起き得るとされる)。
 * - 2.5: 思考を thinkingBudget で上限を切り、temperature は従来どおり指定する。
 * thinkingLevel と thinkingBudget を同時に送ると400になるので、必ずどちらか一方にする。
 */
function generationConfigFor(model, temperature) {
  const config = { response_mime_type: 'application/json' };
  if (isGemini3(model)) {
    config.thinkingConfig = { thinkingLevel: 'low' };
  } else {
    config.temperature = temperature;
    if (isGemini25(model)) config.thinkingConfig = { thinkingBudget: 1024 };
  }
  return config;
}

// ---------- 呼び出しログ(原因調査用) ----------
// 1試行ごとに端末内へ記録する。設定画面で集計とコピーができる。キーや画像そのものは残さない。
const LOG_KEY = 'meallog-ai-log';
const LOG_MAX = 200;

function readLog() {
  try { return JSON.parse(localStorage.getItem(LOG_KEY)) || []; } catch { return []; }
}

function appendLog(entry) {
  try {
    const log = readLog();
    log.push(entry);
    localStorage.setItem(LOG_KEY, JSON.stringify(log.slice(-LOG_MAX)));
  } catch { /* 記録できなくても解析は続ける */ }
}

export function getCallLog() {
  return readLog();
}

export function clearCallLog() {
  try { localStorage.removeItem(LOG_KEY); } catch { /* noop */ }
}

/**
 * ログの集計。呼び出し(callId)単位の成否と、モデル別の試行成績を返す。
 * @returns {{calls: number, failedCalls: number, fellBackCalls: number,
 *   byModel: Array<{model, attempts, failures, avgMs, reasons: object, served: string[]}>}}
 */
export function summarizeCallLog(log = readLog()) {
  const calls = new Map();
  const models = new Map();
  for (const e of log) {
    const c = calls.get(e.callId) || { ok: false, fellBack: false };
    if (e.ok) c.ok = true;
    if (e.fellBack) c.fellBack = true;
    calls.set(e.callId, c);

    const m = models.get(e.model) || { model: e.model, attempts: 0, failures: 0, totalMs: 0, reasons: {}, served: [] };
    m.attempts++;
    if (e.served && !m.served.includes(e.served)) m.served.push(e.served);
    m.totalMs += e.ms || 0;
    if (!e.ok) {
      m.failures++;
      const key = e.status ? `${e.reason}:${e.status}` : (e.finishReason ? `${e.reason}:${e.finishReason}` : e.reason);
      m.reasons[key] = (m.reasons[key] || 0) + 1;
    }
    models.set(e.model, m);
  }
  const callList = [...calls.values()];
  return {
    calls: callList.length,
    failedCalls: callList.filter(c => !c.ok).length,
    fellBackCalls: callList.filter(c => c.fellBack).length,
    byModel: [...models.values()].map(({ totalMs, ...m }) => ({ ...m, avgMs: Math.round(totalMs / m.attempts) })),
  };
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
  "note": "推定の根拠や量の想定などの補足(60字以内で簡潔に)"
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

/** 1試行の失敗。reason で種類を、status/finishReason で詳細を表す */
class GeminiError extends Error {
  constructor(reason, { status = 0, finishReason = '', detail = '' } = {}) {
    super(reason);
    this.reason = reason; // 'timeout' | 'network' | 'http' | 'finish' | 'parse'
    this.status = status;
    this.finishReason = finishReason;
    this.detail = detail;
  }
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * タイムアウト付きでPOSTし、応答JSONまで読み切る(本文の受信中に固まることもあるため、そこまで含めて打ち切る)。
 * @returns {Promise<object>} レスポンスJSON
 */
async function postJson({ apiKey, model, body, timeoutMs }) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    let res;
    try {
      res = await fetch(`${endpointFor(model)}?key=${encodeURIComponent(apiKey)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal: ctrl.signal,
      });
    } catch {
      throw new GeminiError(ctrl.signal.aborted ? 'timeout' : 'network');
    }
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new GeminiError('http', { status: res.status, detail });
    }
    try {
      return await res.json();
    } catch {
      throw new GeminiError(ctrl.signal.aborted ? 'timeout' : 'parse');
    }
  } finally {
    clearTimeout(timer);
  }
}

/** 候補テキストを取り出してJSONとして読む。途中で切れた・ブロックされた応答はここで弾く */
function parseCandidate(data) {
  const blockReason = data?.promptFeedback?.blockReason;
  if (blockReason) throw new GeminiError('finish', { finishReason: blockReason });
  const cand = data?.candidates?.[0];
  const finishReason = cand?.finishReason || '';
  if (finishReason && finishReason !== 'STOP') throw new GeminiError('finish', { finishReason });
  const textOut = cand?.content?.parts?.map(p => p.text).join('') ?? '';
  try {
    return JSON.parse(textOut);
  } catch {
    throw new GeminiError('parse', { detail: textOut });
  }
}

const isApiKeyError = (err) => err.reason === 'http' && err.status === 400 && err.detail.includes('API_KEY');
// 同じモデルでもう一度試す価値がある失敗(一時的な混雑・通信断)
const isTransient = (err) =>
  err.reason === 'network' || (err.reason === 'http' && [500, 503, 504].includes(err.status));
// フォールバック先のモデルなら通る見込みがある失敗。キー不正や安全フィルタはモデルを変えても同じ
function canFallBack(err) {
  if (isApiKeyError(err)) return false;
  if (err.reason === 'finish') return err.finishReason === 'MAX_TOKENS';
  return true;
}

/** 最終的な失敗を、ユーザーが次に何をすればよいか分かるメッセージにする */
function userMessage(err, { model, kind, parseErrorMessage }) {
  switch (err.reason) {
    case 'timeout':
      return kind === 'vision'
        ? `解析に時間がかかりすぎたため中断しました(${TIMEOUT_MS.vision / 1000}秒)。品数の多い写真は少し時間をおいて再試行するか、手動で入力してください。`
        : `応答に時間がかかりすぎたため中断しました(${TIMEOUT_MS[kind] / 1000}秒)。もう一度試してください。`;
    case 'network':
      return navigator.onLine === false
        ? 'オフラインのため解析できません。通信環境を確認してください。'
        : 'Gemini APIに接続できませんでした。通信環境を確認してもう一度試してください。';
    case 'finish':
      return err.finishReason === 'MAX_TOKENS'
        ? '解析結果が長くなりすぎて途中で切れました。品数を分けて撮影するか、手動で入力してください。'
        : `安全フィルタ等により解析できませんでした (${err.finishReason})。手動で入力してください。`;
    case 'parse':
      return parseErrorMessage;
  }
  if (isApiKeyError(err)) return 'APIキーが無効です。設定を確認してください。';
  if (err.status === 429) return '無料枠の利用上限に達しました。しばらく待ってから試してください。';
  if (err.status === 404) return `モデル ${model} を利用できません。設定画面でモデルを変更してください。`;
  if ([500, 503, 504].includes(err.status)) return `Geminiが混雑しています (${err.status})。少し時間をおいて試してください。`;
  let apiMsg = '';
  try { apiMsg = JSON.parse(err.detail)?.error?.message || ''; } catch { /* 本文がJSONでない */ }
  return `Gemini APIエラー (${err.status})${apiMsg ? ': ' + apiMsg.slice(0, 100) : ''}`;
}

/** フォールバックした理由を、解析結果の横に出せる短い言葉にする */
function fallbackReasonOf(err) {
  if (err.reason === 'timeout') return '応答が遅すぎたため';
  if (err.reason === 'network') return '通信エラーのため';
  if (err.reason === 'finish') return `出力が途中で切れたため(${err.finishReason})`;
  if (err.reason === 'parse') return '応答を読み取れなかったため';
  if (err.status === 429) return '利用上限(429)に達したため';
  if (err.status === 404) return 'モデルが使えない(404)ため';
  return `エラー(${err.status})のため`;
}

/** base64のinline_dataから、送った画像のおおよそのKBを出す(ログ用) */
function imageKB(parts) {
  const b64 = parts.find(p => p.inline_data)?.inline_data.data;
  return b64 ? Math.round(b64.length * 3 / 4 / 1024) : 0;
}

/**
 * JSONモードでGeminiを呼び、パース済みオブジェクトを返す。
 * - 混雑(500/503/504)・通信断は同じモデルで1度だけ再試行する。
 * - タイムアウトは同じモデルだと再び遅いので、再試行せずフォールバックへ回す。
 * - それでも失敗したら、枠が広く応答の速いモデルへ1度だけ落として続行する。
 * 記録できないより、少し精度の落ちるモデルでも記録できる方を優先する。
 * @returns {Promise<{parsed: object, model: string, fellBack: boolean, fallbackReason: string}>}
 */
async function callGeminiJson({ apiKey, parts, temperature, parseErrorMessage, kind = 'text' }) {
  if (navigator.onLine === false) {
    throw new Error(userMessage(new GeminiError('network'), { kind }));
  }
  const callId = Math.random().toString(36).slice(2, 10);
  const kb = imageKB(parts);
  let model = resolveModel(kind);
  // 直前の404/429で既定モデルを避けている間も、切り替わっていることが画面で分かるようにする
  let fellBack = model !== preferredModel(kind);
  let fallbackReason = fellBack ? `${preferredModel(kind)} が直前に失敗したため` : '';
  let retried = false;

  for (;;) {
    const body = JSON.stringify({ contents: [{ parts }], generationConfig: generationConfigFor(model, temperature) });
    const started = Date.now();
    const entry = { at: new Date().toISOString(), callId, kind, model, fellBack, imageKB: kb };
    try {
      const data = await postJson({ apiKey, model, body, timeoutMs: TIMEOUT_MS[kind] || TIMEOUT_MS.text });
      const u = data?.usageMetadata || {};
      entry.tokens = { prompt: u.promptTokenCount, thoughts: u.thoughtsTokenCount, output: u.candidatesTokenCount };
      // 廃止モデルは別モデルへ黙って転送されるので、実際に応答したモデルも残す
      if (data?.modelVersion) entry.served = data.modelVersion;
      const parsed = parseCandidate(data);
      appendLog({ ...entry, ok: true, ms: Date.now() - started,
        items: (parsed.items || parsed.suggestions || []).length });
      return { parsed, model, fellBack, fallbackReason };
    } catch (err) {
      if (!(err instanceof GeminiError)) throw err;
      appendLog({ ...entry, ok: false, ms: Date.now() - started, reason: err.reason,
        status: err.status || undefined, finishReason: err.finishReason || undefined,
        detail: err.detail ? err.detail.slice(0, 300) : undefined });

      if (isTransient(err) && !retried) {
        retried = true;
        await sleep(RETRY_DELAY_MS);
        continue;
      }
      if (!fellBack && canFallBack(err)) {
        if (err.status === 404) unavailableUntil.set(model, Infinity);
        if (err.status === 429) unavailableUntil.set(model, Date.now() + RATE_LIMIT_COOLDOWN_MS);
        fallbackReason = `${model} が${fallbackReasonOf(err)}`;
        model = fallbackFor(model);
        fellBack = true;
        retried = true; // フォールバック先では再試行しない(待ち時間が延びすぎるため)
        continue;
      }
      throw new Error(userMessage(err, { model, kind, parseErrorMessage }));
    }
  }
}

/**
 * 食事を解析する。imageかtextのどちらかを渡す。
 * @returns {Promise<{items: Array, note: string, model: string, fellBack: boolean, fallbackReason: string}>}
 *   model は実際に応答したモデルID、fellBack はフォールバックが起きたかどうか、fallbackReason はその理由
 */
export async function analyzeFood({ apiKey, image, text }) {
  const parts = [{ text: PROMPT }];
  if (image) {
    parts.push({ inline_data: { mime_type: image.mimeType, data: image.base64 } });
  }
  if (text) {
    parts.push({ text: `食事内容: ${text}` });
  }

  const { parsed, model, fellBack, fallbackReason } = await callGeminiJson({
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

  return { items, note: String(parsed.note ?? ''), model, fellBack, fallbackReason };
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
    temperature: 0.9, // 提案は毎回変化してほしいので高め(3.x には送らず既定の1.0を使う)
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
 * @returns {Promise<{model: string, served: string}>} 指定したモデルIDと、実際に応答したモデル(modelVersion)
 */
export async function testConnection(apiKey, model) {
  // 空文字は「自動」の意味なので、写真解析の既定モデルを試す
  const target = normalizeModelId(model) || VISION_MODEL;
  const body = JSON.stringify({ contents: [{ parts: [{ text: 'test: reply "ok"' }] }] });
  let data;
  try {
    data = await postJson({ apiKey, model: target, body, timeoutMs: TEST_TIMEOUT_MS });
  } catch (err) {
    if (err.status === 404) throw new Error(`モデル ${target} を利用できません。モデルIDを確認してください。`);
    if (err.reason === 'timeout') throw new Error(`接続失敗 (${TEST_TIMEOUT_MS / 1000}秒以内に応答なし)`);
    if (err.reason === 'network') throw new Error('接続失敗 (通信エラー)');
    throw new Error(`接続失敗 (${err.status || err.reason})`);
  }
  return { model: target, served: data?.modelVersion || '' };
}
