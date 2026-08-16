# tobidas

<p align="center">
  <img src="./.github/assets/tobidas.png" alt="tobidasの飛び出す絵本ビルダー画面">
</p>

<p align="center"><strong>飛び出す絵本のようなWeb作品を、ブラウザで組み立てて公開する。</strong></p>

<p align="center">
  <a href="https://tobidas.9rsgy78c9c.workers.dev/">オンライン版を使う</a>
  ·
  <a href="https://tobidas-demo.9rsgy78c9c.workers.dev/">公開作例を見る</a>
  ·
  <a href="./README.en.md">English</a>
</p>

<p align="center">
  <img alt="Release: 0.1.3" src="https://img.shields.io/badge/Release-0.1.3-5a68d8">
  <img alt="License: Apache-2.0" src="https://img.shields.io/badge/License-Apache--2.0-blue">
  <img alt="Local-first" src="https://img.shields.io/badge/Data-local--first-brightgreen">
  <img alt="React 19" src="https://img.shields.io/badge/React-19-61dafb">
</p>

## tobidasとは

tobidasは、横開きの「飛び出す絵本風」Web作品を制作・再生するローカルファーストのビルダーです。
完全に開いた見開きを編集すると、ページを開閉するときの紙面や部品の動きを自動で組み立てます。

[tobidas.9rsgy78c9c.workers.dev](https://tobidas.9rsgy78c9c.workers.dev/) ですぐに使えます。
作品データや読み込んだ素材はブラウザ内で処理され、tobidasのサーバーへアップロードされません。
このリポジトリをクローンして、自分の環境や静的ホスティングで運用することもできます。

## 主な機能

- 紙面接着、起立、中央線をまたぐ部品の自動二つ折り
- 空中部品を開姿勢から判定し、小口の外側へ自動収納
- 画像、SVG、音声、Webフォント、テキスト、透明な平面上のパーティクルの配置
- 位置、回転、拡大率、不透明度、表示、素材、背景、照明、カメラのタイムライン制御
- 3Dギズモとプロパティパネルによる見開き編集
- BGMとページめくりなどの効果音
- 日本語／英語UI
- 利用者側のブラウザ操作AI向け状態表示と直接操作
- ブラウザ内の自動保存
- 単一HTML、または静的ホスト向けZIPへの書き出し

## オンライン版を使う

1. [tobidas.9rsgy78c9c.workers.dev](https://tobidas.9rsgy78c9c.workers.dev/) をChromeまたはEdgeで開きます。
2. 「新規作成」で作品を作るか、「開く」で既存の作品フォルダを選びます。
3. 素材を読み込み、プリセットを選んで見開きへ配置します。
4. 右上の「再生」でページの開閉と演出を確認します。
5. 「保存」で編集用フォルダを保存し、「エクスポート」で公開用ファイルを書き出します。

フォルダの読み書きにFile System Access APIを使うため、デスクトップ版ChromeまたはEdgeを推奨します。

## ブラウザ操作AIから使う

ツールバーの「AIモード」を有効にすると、現在の作品、見開き、選択部品、アセットID、検証結果を意味付きDOMから確認できます。
AIモードは、左側の操作ペインと右側のビューポートを約1対2で表示する専用ワークスペースへ切り替わります。
通常の編集ペインとタイムラインは重複表示されず、利用者はビューポートを見ながらブラウザ操作AIの選択と編集結果を確認できます。

操作ペインには、安定したIDを持つ対象ツリー、素材読込、画像の直接配置、テキストとパーティクルの作成、選択部品の更新、undoとredo、再生、検証結果をまとめています。
画像はCanvas上でドラッグせず、左右ページと正規化座標を指定して配置できます。
位置や所属ページが紙面の制約によって補正された場合は、要求値と採用値を操作結果から取得できます。
各入力には名前と役割が付いているため、ブラウザ操作AIは画面上の並び順やCSSクラスに依存せず操作できます。

ブラウザ操作AIから最初から有効にする場合は、URLへ `?ai=1` を付けます。
AIモードは外部AIとの通信を追加せず、作品と素材は通常モードと同じくブラウザ内に残ります。
AIモードの有効状態と操作結果は作品データへ保存されません。

## 作品フォルダ

作品はJSONと素材をまとめたフォルダです。

```text
my-book/
├─ project.json
└─ assets/
   ├─ page-left.png
   ├─ character.webp
   └─ page-turn.wav
```

保存形式の互換性は、tobidas本体のリリースバージョンで管理します。

公開用の書き出しは2種類あります。

- **単一HTML** — 素材を1ファイルに埋め込みます。ダウンロード後、そのままブラウザで開けます。
- **静的ホスト** — `index.html`と`assets/`をZIPにまとめます。Cloudflare Pagesなどの静的ホスティング向けです。

## サンプル作品

[Chasing the Forest Lanternをブラウザで見る](https://tobidas-demo.9rsgy78c9c.workers.dev/)
— `forest_lantern`をtobidasから単一HTMLとして書き出して公開した作例です。
インストールせず、そのままページの開閉、立体表現、アニメーション、サウンドを体験できます。

`projects/`には、すぐに読み込める4つのサンプル作品があります。

- `forest_lantern` — Chasing the Forest Lantern
- `morning_walk` — The Walk to School
- `four_seasons` — One Window, Four Seasons
- `crooked_castle` — The Crooked Castle

リポジトリをダウンロードまたはクローンし、ビルダーの「開く」から各フォルダを選んでください。
サンプル作品と同梱素材には、ソフトウェアとは別の利用条件があります。
詳しくは[アセットライセンス](./ASSET_LICENSE.md)を参照してください。

## ローカルで起動する

必要なもの:

- Node.js 20.19以降、または22.12以降
- npm
- デスクトップ版ChromeまたはEdge

```bash
git clone https://github.com/jun76/tobidas.git
cd tobidas
npm ci
npm run dev
```

`http://localhost:5174/`を開きます。

## セルフホスト

```bash
npm ci
npm run build
```

生成された`dist/`を静的ホスティングへ配置してください。Cloudflare Pagesでは次の設定を使えます。

| 設定 | 値 |
|---|---|
| Build command | `npm run build` |
| Build output directory | `dist` |
| Node.js | 22以降 |

アプリはドメインのルートで配信する構成です。サブパスへ配置する場合は、
`vite.config.ts`の`base`とプレイヤー取得先の調整が必要です。

## 開発

```bash
npm run typecheck
npm test
npm run build
```

エージェント向けの作品制作規約は[AGENTS.md](./AGENTS.md)、
tobidas本体の実装規約は[AGENTS_DEV.md](./AGENTS_DEV.md)にまとめています。

## プライバシー

tobidasはローカルファーストです。作品、画像、音声、フォントは利用者のブラウザ内で処理されます。
自動保存にはIndexedDBを使います。オンライン版の配信サーバーへ作品データを送信する機能はありません。

## ライセンス

ソフトウェアコードと文書は[Apache License 2.0](./LICENSE)で提供します。

`projects/**`のサンプル作品、`scripts/samples/assets/**`の同梱素材、ファビコンなどのビジュアル・音声素材は
Apache-2.0の対象外です。[ASSET_LICENSE.md](./ASSET_LICENSE.md)の条件が適用されます。
