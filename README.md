# 🍽 MealLog — 食事カロリー記録PWA

スマホで写真を撮る(またはテキスト入力する)だけで、AIが食事のカロリー・栄養素を推定して記録するWebアプリです。**サーバー費用・API費用は一切かかりません。**

- 📷 写真 or 💬 テキスト → Gemini API(無料枠)でカロリー・PFC自動推定
- 📱 PWA対応 — スマホのホーム画面に追加してアプリのように使える
- ☁️ GitHubプライベートリポジトリに記録を自動同期(機種変更でもデータが残る)
- 📤 Markdown / JSON / CSV でエクスポート — そのままChatGPTやClaude等のLLMに渡して食事分析に使える

## 仕組み

```
スマホ(PWA)
   ├─ 写真/テキスト → Gemini API 無料枠 → カロリー推定
   ├─ IndexedDB(端末内保存・オフライン対応)
   └─ GitHub API → プライベートリポジトリに月別 JSON/Markdown を自動コミット
```

APIキーやトークンは端末のブラウザ内(localStorage)にのみ保存され、外部に送信されません(Gemini/GitHubの公式API呼び出しを除く)。

## セットアップ

### 1. Gemini APIキーの取得(無料・クレカ不要)

1. [Google AI Studio](https://aistudio.google.com/apikey) にGoogleアカウントでログイン
2. 「APIキーを作成」をタップしてキーをコピー
3. アプリの **設定 → AI解析(Gemini)** にキーを貼り付けて「設定を保存」

> 無料枠には1日あたりのリクエスト回数上限がありますが、食事記録の用途(1日数回)なら十分です。課金設定をしない限り料金は発生しません。

### 2. GitHub同期の設定(任意・推奨)

1. データ保存用の **プライベートリポジトリ** を作成(例: `meal-log-data`)
2. [Fine-grained personal access token](https://github.com/settings/personal-access-tokens/new) を発行
   - Repository access: **Only select repositories** → `meal-log-data` のみ
   - Permissions: **Contents → Read and write** のみ
3. アプリの **設定 → GitHub同期** に `ユーザー名/meal-log-data` とトークンを入力して保存

記録するたびに `meals/YYYY-MM.json`(構造化データ)と `meals/YYYY-MM.md`(Markdownテーブル)が自動コミットされます。

### 3. スマホのホーム画面に追加

1. スマホのブラウザでアプリのURL(GitHub PagesのURL)を開く
2. **Android (Chrome)**: メニュー → 「ホーム画面に追加」
3. **iPhone (Safari)**: 共有ボタン → 「ホーム画面に追加」

## AIでの食事分析

エクスポートしたMarkdownや、データリポジトリの `meals/YYYY-MM.md` をそのままLLMに貼り付けて:

> この食事記録を分析して、栄養バランスの問題点と改善案を教えて

のように使えます。

## 開発

ビルド不要の静的サイトです。ローカルで動かすには:

```bash
python -m http.server 8000
```

## ライセンス

MIT
