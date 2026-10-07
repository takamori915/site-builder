# Memo Site Builder

メモを書きためて、その内容から AI（Claude）がブログ・ポートフォリオ・ウェブサイトを作るアプリです。
サーバー不要の静的サイトなので、GitHub Pages などにそのまま置いて使えます。

## 機能

- **📝 メモ**: メモの作成・編集・削除、タグ、検索、CSV入出力（Kakumee の CSV も取り込み可）
- **🪄 サイト生成**: 選んだメモをもとに、Claude が1ファイル完結のHTMLサイトを生成
  - 種類: ブログ / ポートフォリオ / ウェブサイト
  - 雰囲気・メインカラー・追加要望を指定可能
  - プレビュー（サンドボックス化された iframe）、HTML表示、ダウンロード、コピー、全画面表示
  - 「修正する」欄から追加の指示で作り直し
  - 生成履歴をブラウザに最大20件保存

## 使い方

1. [Anthropic Console](https://console.anthropic.com/settings/keys) で API キーを発行します（API 利用料がかかります）。
2. 「📝 メモ」タブでメモを書きます。
3. 「🪄 サイト生成」タブで、作るもの・使うメモ・デザインを選び、API キーを入力して「サイトを生成する」を押します。
4. できあがったHTMLをダウンロードし、GitHub Pages や Netlify などにアップロードすれば公開できます。

API キーはブラウザから Anthropic API に直接送信されます（このアプリ用のサーバーはありません）。
「このブラウザにキーを保存する」をオンにした場合は localStorage に保存されるため、共用PCではオフにしてください。

## データの保存

メモ・生成したサイトはブラウザの localStorage（`msb-notes` / `msb-sites`）に保存されます。
ブラウザのデータ削除で消えるため、メモは CSV 出力で、サイトはダウンロードでバックアップしてください。

## 公開（GitHub Pages）

リポジトリの Settings → Pages で、Source を「Deploy from a branch」、ブランチを `main` / `/ (root)` にすると
`https://<ユーザー名>.github.io/site-builder/` で使えるようになります。
（非公開リポジトリで Pages を使うには GitHub の有料プランが必要です）

## ファイル構成

- `index.html` — 画面
- `app.js` — メモ管理（MemoStore / MemoEditor）とサイト生成（SiteGenerator）
- `style.css` — スタイル
