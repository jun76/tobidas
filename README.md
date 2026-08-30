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

WebMCP対応ブラウザでは、URLへ特別なクエリを付けなくても、ページ起動時からWebMCPツールを発見できます。
AIモードの画面は必要に応じてツールバーから開きます。WebMCP非対応ブラウザでブラウザ操作AIを使う場合も、同じボタンからAIモードを開けます。
ツールバーの「AI操作のヒント」から、WebMCPの接続状態、公開版のOrigin Trial、Chrome・Edge・Firefoxそれぞれの設定、対応AI環境、フォールバックを区別して確認できます。
AIモードは外部AIとの通信を追加せず、作品と素材は通常モードと同じくブラウザ内に残ります。
AIモードの有効状態と操作結果は作品データへ保存されません。

### WebMCPを使う

tobidasは、WebMCPに対応したブラウザでは、ページ起動時からページ内の操作をAI向けの構造化ツールとして公開します。
WebMCPはAIモードとは別の画面やモードではなく、同じ作品操作へ接続する実装経路です。AIモードの画面を開かなくてもツールは発見できます。

WebMCPを使える場合は、AIが対象ID、正規化座標、タイムラインの型をそのまま指定できます。
ツールの実行結果には、storeへ反映した後の対象、収納やレイアウトの補正、検証件数を含めます。
アセット本体のアップロード、外部URLの取得、削除、保存、エクスポートはWebMCPツールから行いません。
アセットの取り込みは、従来どおりAIモードのファイル入力を使います。

WebMCPツールはAIモードの画面には表示されません。
WebMCP対応AIまたはModel Context Tool Inspectorがページを開くと、登録済みツールを発見できます。
ブラウザのコンソールで確認する場合は、次の式が使えます。

```js
const context = document.modelContext ?? navigator.modelContext
const tools = context ? await context.getTools() : []
tools.map((tool) => tool.name)
```

#### 利用経路

| 利用場所 | ブラウザ側の有効化 | 利用者の操作 |
| --- | --- | --- |
| [公開Web版](https://tobidas.9rsgy78c9c.workers.dev/) | 対象Originとブラウザ向けのWebMCP Origin Trialトークンを配信HTMLへ組み込む | 対応するトークンがあるChrome・Edgeでは開くだけ。Firefoxはブラウザ設定を使う |
| ローカルclone版 | Chrome・Edge・Firefoxで、それぞれ下記のWebMCP設定を有効化 | 設定後にブラウザを再起動し、`http://localhost:5174/` を開く |
| WebMCP非対応のブラウザ・AI環境 | WebMCPは使わない | 従来どおり一つの「AIモード」から意味付きDOM、ARIA、フォーム操作を使う |

Origin Trialや各ブラウザ設定でブラウザAPIを有効にすることと、そのツールを発見・呼び出せるAI環境を使うことは別の条件です。
ブラウザ側でWebMCPが有効でも、呼び出し元のAIクライアントがページ定義ツールの一覧取得と実行に対応していなければ、構造化ツールは利用できません。
この対応状況はAIクライアントの種類、バージョン、選択モデルによって異なる場合があります。
ツールバーの「AIツール利用可能」はページへの登録完了を示す表示であり、呼び出し元AIからの取得成功までは保証しません。
利用時はAI環境からツール一覧を取得し、まず `tobidas-get-state` を呼び出して接続を確認します。
ChromeのWebMCP Origin TrialはChrome 149〜156が対象で、終了予定日は2026年11月17日です。
公式公開版の登録には[WebMCP Origin Trial登録画面](https://developer.chrome.com/origintrials/#/register_trial/4163014905550602241)を使います。

#### ブラウザごとの動作状況

WebMCPの対応状況はブラウザごとに異なります。

| ブラウザ | WebMCPの利用経路 | 確認できている内容 |
| --- | --- | --- |
| Chrome | 公開版はOrigin Trial、ローカル版はChrome設定 | 19個のimperativeツール。対応環境では宣言的フォームAPIも利用可能 |
| Edge | Edge用Origin TrialまたはEdge設定 | 19個のimperativeツール。対応環境では宣言的フォームAPIも利用可能 |
| Firefox | `about:config`で `dom.modelcontext.enabled` と `dom.modelcontext.testing.enabled` を有効化 | `navigator.modelContext`から19個のimperativeツール。`document.modelContext`と宣言的フォームAPIは未確認 |

ローカルclone版では、現在のブラウザに合う設定を有効にして再起動します。Chromeは `chrome://flags/#enable-webmcp-testing`、Edgeは `edge://flags/#enable-webmcp-testing` を使います。
公開Web版では対象Originとブラウザ向けのOrigin TrialトークンをHTMLへ組み込み、そのトークンに対応するChromeまたはEdgeで利用者側の設定を不要にします。トークンはOriginと提供元ごとに発行されるため、別ドメインや別ブラウザへそのまま流用できません。
Firefoxの `dom.modelcontext.*` は実験・テスト用の内部設定です。Firefoxでは現状、旧APIの `navigator.modelContext` 経由でimperativeツールを利用します。
WebMCPの対応状況は、[WebMCPの実装状況](https://github.com/webmachinelearning/webmcp/blob/main/implementation-status.md)を参照してください。

WebMCPを使えない環境では、AIモードのDOM、ARIA、フォーム操作がそのまま使われます。
利用可否はブラウザだけで決まらず、ブラウザ設定またはOrigin Trialと、呼び出し元AIによるページツールの一覧取得・実行対応の組み合わせで決まります。

#### 提供するツール

WebMCPを利用できる条件では、ページ起動時に次のimperativeツールを登録します。AIモードの画面を開く必要はありません。

| 分類 | ツール | 内容 |
| --- | --- | --- |
| 読み取り | `tobidas-get-state` | アセット本体を含めず作品状態を取得する。最初に呼び出して見開きIDと部品IDを得る。範囲は作品全体、現在の見開き、現在の選択から選び、省略時は作品全体 |
| 読み取り | `tobidas-get-spread` | ページ、部品、タイムラインを含む1つの見開きを取得する。`tobidas-get-state`で得た見開きIDを渡す |
| 読み取り | `tobidas-get-element` | 安定した見開きIDと部品IDで部品を取得する。IDは状態または見開き取得結果から得る |
| 読み取り | `tobidas-list-assets` | 後の配置やBGM割り当てに使うアセットのメタデータと参照情報を取得する。バイナリの返却やファイルのアップロードは行わない |
| 読み取り | `tobidas-validate-book` | 最新の検証エラーと警告を取得する。見開きIDを渡すと、その見開きの文脈に絞る |
| セッション | `tobidas-select-target` | 作品、光源、表紙、見開き、ページ、部品を人が確認できる対象として選択する。見開き、ページ、部品には対応するIDを渡す |
| セッション | `tobidas-set-preview` | 表示中のプレビューを作品全体の正規化進行値、または見開きの保持時刻へ移動する。進行値、または見開きIDと保持区間内の秒数を指定する |
| セッション | `tobidas-enter-play` | 人が作品を確認できる再生モードへ切り替える。表示中の編集セッションだけを変更する |
| セッション | `tobidas-enter-edit` | 構造化された作品編集ができる編集モードへ戻る。表示中の編集セッションだけを変更する |
| 編集 | `tobidas-place-asset` | 取り込み済みの画像、SVG、動画をプリセットと正規化ページ座標で配置する。アセットはAIモードのファイル入力で先に取り込み、配置は通常の検証とundo履歴を通す |
| 編集 | `tobidas-create-visual` | 既存のtobidasプリセットでテキストまたは光のパーティクル部品を作成する。通常のレイアウト検証とundo履歴を通す |
| 編集 | `tobidas-update-element` | レイアウト補正と検証を通して部品を更新する。入力は型付きの全体更新であり任意JSON置換ではなく、省略した項目は現在値を保つ |
| 編集 | `tobidas-move-element` | 通常の制約を保ちながら部品をページまたは別の部品へ付け替える。共通の編集、検証、undo経路を通す |
| 編集 | `tobidas-add-timeline-key` | 見開きの保持区間へ型付きタイムラインキーを追加または置換する。時刻と値は対象プロパティに対して検証する |
| 編集 | `tobidas-assign-bgm` | 取り込み済みの音声アセットを作品のBGMへ割り当てる。アセットはAIモードのファイル入力で先に取り込む |
| 編集 | `tobidas-clear-bgm` | 通常の編集、検証、undo経路を通して作品のBGMを解除する |
| 編集 | `tobidas-add-spread` | 通常の編集とundo経路を通して見開きを追加、複製、移動する。削除はWebMCPから公開しない |
| 編集 | `tobidas-undo` | 通常の履歴を使って直前の編集を取り消す。取り消し後の選択とプレビュー状態を返す |
| 編集 | `tobidas-redo` | 通常の履歴を使って取り消した編集をやり直す。やり直し後の選択とプレビュー状態を返す |

配置フォームには、宣言的APIの検証用に `tobidas-place-asset-form` も付けています。
このフォームは通常の送信経路を残したまま使う補助的な公開であり、imperativeの `tobidas-place-asset` と同じ名前は使いません。
`toolautosubmit`は付けていないため、フォームの自動送信によって利用者の確認を省略しません。

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

リポジトリには、プロンプトから作品の設計、素材準備、AIモードでの構築、検証までを支援する [`tobidas-create` スキル](./.agents/skills/tobidas-create/SKILL.md) も同梱しています。スキル対応のCodexやエージェント環境から利用できます。

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

WebMCP Origin Trialを使う公開ビルドでは、発行されたトークンを `.env.webmcp-public` へ設定して `npm run build:public` を使います。

```dotenv
WEBMCP_ORIGIN_TRIAL_TOKEN=対象Origin向けのChromeトークン
# Edge側のOrigin Trialにも参加する場合だけ追加
WEBMCP_EDGE_ORIGIN_TRIAL_TOKEN=対象Origin向けのEdgeトークン
```

`build:public` はChrome用トークンがない場合に失敗し、署名、対象Origin、機能名、有効期限を検査します。
サブドメイン対象とThird-party matchingがOFFであることも確認し、トークンを `<meta http-equiv="origin-trial">` として `dist/index.html` へ組み込みます。
トークンは配信HTMLから読める公開値ですが期限があるため、ソースへ固定せずビルド環境で更新します。
公式公開版のトークンは `https://tobidas.9rsgy78c9c.workers.dev` に対して発行します。セルフホスト先が別Originなら、そのOriginを別途Origin Trialへ登録してください。
Chromeの現在のtrialは2026年11月17日に終了予定です。延長や正式提供の状況を確認し、期限前にトークンと案内を更新します。

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

## FAQ

### Codex Appのgpt-5.6-lunaからWebMCP toolを呼べないのですが？

tobidasのツール登録ではなく、呼び出し元であるCodex AppのBrowser連携におけるモデル別対応の問題と考えられます。
確認した環境では、ページ側のWebMCP APIと「AIツール利用可能」の表示は有効でも、gpt-5.6-lunaはツール一覧取得時に `gpt-5.6-luna does not support command "webmcp_list_tools"` で停止しました。同じページとブラウザ環境で、gpt-5.6-solとgpt-5.6-terraからはツール一覧の取得と `tobidas-get-state` の実行に成功しています。

このエラーは `tobidas-get-state` を呼ぶ前にCodex App側で発生するため、tobidasのWebMCP登録、Origin Trial、ブラウザ設定の失敗ではありません。OpenAIの公開情報には、gpt-5.6-lunaがCodex Appの `webmcp_list_tools` に非対応であるという明示的な記載はなく、完全一致する公式issueも確認できていません。一方、公式trackerには[モデルによってBrowserプラグインの利用可否が変わる問題](https://github.com/openai/codex/issues/33592)や、[gpt-5.6-terra／lunaでツール注入が欠落する問題](https://github.com/openai/codex/issues/33250)が未解決バグとして報告されています。

現時点ではgpt-5.6-solまたはgpt-5.6-terraを使うか、一つの「AIモード」から意味付きDOM、ARIA、フォーム操作へフォールバックしてください。AIクライアントやモデルの対応は更新される可能性があるため、tobidas自体は特定のCodexモデルを必須条件にしていません。

## プライバシー

tobidasはローカルファーストです。作品、画像、音声、フォントは利用者のブラウザ内で処理されます。
自動保存にはIndexedDBを使います。オンライン版の配信サーバーへ作品データを送信する機能はありません。

## ライセンス

ソフトウェアコードと文書は[Apache License 2.0](./LICENSE)で提供します。

`projects/**`のサンプル作品、`scripts/samples/assets/**`の同梱素材、ファビコンなどのビジュアル・音声素材は
Apache-2.0の対象外です。[ASSET_LICENSE.md](./ASSET_LICENSE.md)の条件が適用されます。
