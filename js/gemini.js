// Gemini API(無料枠)で食事写真・テキストからカロリー推定
const MODEL = 'gemini-2.5-flash';
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

const PROMPT = `あなたは栄養士です。与えられた食事(写真またはテキスト)に含まれる料理・食品を特定し、
日本の一般的な提供量を基準に、品目ごとの推定カロリーと栄養素を算出してください。

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

/**
 * 食事を解析する。imageかtextのどちらかを渡す。
 * @returns {Promise<{items: Array, note: string}>}
 */
export async function analyzeFood({ apiKey, image, text }) {
  const parts = [{ text: PROMPT }];
  if (image) {
    parts.push({ inline_data: { mime_type: image.mimeType, data: image.base64 } });
  }
  if (text) {
    parts.push({ text: `食事内容: ${text}` });
  }

  const res = await fetch(`${ENDPOINT}?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts }],
      generationConfig: {
        response_mime_type: 'application/json',
        temperature: 0.2,
      },
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    if (res.status === 400 && body.includes('API_KEY')) {
      throw new Error('APIキーが無効です。設定を確認してください。');
    }
    if (res.status === 429) {
      throw new Error('無料枠の利用上限に達しました。しばらく待つか手動入力してください。');
    }
    throw new Error(`Gemini APIエラー (${res.status})`);
  }

  const data = await res.json();
  const textOut = data?.candidates?.[0]?.content?.parts?.map(p => p.text).join('') ?? '';
  let parsed;
  try {
    parsed = JSON.parse(textOut);
  } catch {
    throw new Error('解析結果を読み取れませんでした。もう一度試すか手動入力してください。');
  }

  const items = (parsed.items || []).map(it => ({
    name: String(it.name ?? ''),
    kcal: Math.round(Number(it.kcal) || 0),
    protein: Number(it.protein) || 0,
    fat: Number(it.fat) || 0,
    carbs: Number(it.carbs) || 0,
  })).filter(it => it.name);

  return { items, note: String(parsed.note ?? '') };
}

/** 設定画面の接続テスト用 */
export async function testConnection(apiKey) {
  const res = await fetch(`${ENDPOINT}?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: 'test: reply "ok"' }] }] }),
  });
  if (!res.ok) throw new Error(`接続失敗 (${res.status})`);
  return true;
}
