# AGENTS_DEV.md

このファイルは、tobidas本体を変更するコーディングエージェント向けの実装規約です。

作業前にルートの `AGENTS.md` も読み、作品形式と制作規約を守ってください。
作品データや素材だけを変更する場合、このファイルを読む必要はありません。

tobidasはReact 19、@react-three/fiber（three.js）、zustand、zod、Viteで構成します。
コード注釈、技術文書、コミットメッセージは日本語で記述します。

## 本体のリリースとデプロイ

ビルダー本体の公開デプロイは、ユーザーから明示的に指示された場合だけ実行します。
公開サンプルや公開 demo の更新指示は、ビルダー本体のデプロイ指示とは別に扱い、推測で本体をデプロイしません。

ビルダー本体をリリースするときは、バージョンを更新し、リリースタグを作成して GitHub へ push してからデプロイします。
タグ付き push までを含む本体リリースの明示指示がない場合は、ローカルの検証と変更内容の報告までに留めます。

## 開発コマンド

```bash
npm run dev          # ビルダー http://localhost:5174/（strictPort）
npm run typecheck    # tsc --noEmit
npm test             # vitest run（src/**/*.test.ts）
npm run build        # プレイヤーを同梱してからビルダーを dist/ へ出力
npm run build:public # Origin Trialトークン必須の公開WebMCPビルド
```

単体テストは対象ファイルまたはテスト名を指定して実行できます。

```bash
npx vitest run src/runtime/stow/stow.test.ts
npx vitest run -t "keeps every part on the paper"
```

再生制御を変更した場合は、次のスクリプトでも確認します。

```bash
node scripts/verify-player-controls.mjs forest_lantern
```

`npm run qa:visual` は開発サーバーの起動中に実行します。
全進行値のフレームを `qa/visual/` へ出力し、コンタクトシートの生成にはImageMagickの `magick` を使います。
開発サーバーには `127.0.0.1` ではなく `localhost` で接続します。

再生画面は作品を埋め込みデータからだけ受け取ります。
QAスクリプトは `scripts/lib/embedProject.mjs` の `servePlayerWithProject` でPlaywrightのHTML応答を差し替え、配布物と同じ状態で開きます。
進行値は `?progress=0.34` で指定でき、自動化からは `window.__tobiSetScroll(0..1)` を呼べます。

## コミット

コミットはユーザーから明示的に依頼された場合だけ実行します。
検証が完了していても、依頼がなければ変更をコミットせず、作業ツリーの状態と差分を報告します。

複数行のコミットメッセージは一時ファイルへ書き、`git commit -F` で渡します。

```bash
git commit -F /tmp/msg.txt
```

PowerShellのヒアストリングを別のシェルへ渡すと引用が崩れるため、長文を `-m` に直接渡しません。

## ソース構造

保存形式は `src/schema/bookPackage.ts` が定義し、互換性はtobidas本体のリリースバージョンで管理します。

評価は次の順に進みます。

```text
progress 0..1
  → signals.ts        シートの蝶番角 α → 見開き二面角 δ、ビート、保持時刻
  → stow/assign.ts    支持機構の割り当て、包含検証、補正
  → stow/evaluate.ts  t = δ/π だけを入力とする閉形式評価
  → BookRuntime.tsx   恒久フレーム木への描画
```

- `src/schema/`：Book、Stage Element、タイムライン、音声契約、zodによる検証
- `src/package/`：パッケージの構造、組み立て、serialization
- `src/audio/`：PlayerとBuilderが共有するWeb Audio再生機能
- `src/runtime/`：二面角信号、収納コンパイラ、包含検査、タイムライン評価、Content Clock
- `src/builder/`：zustand store、Viewport、各パネル、入出力、永続化、素材、i18n
- `src/player/`：書き出した作品の再生画面。開発用の作品読み込み経路は持たない
- `scripts/samples/`：作品ごとの生成定義と紙工作ヘルパー
- `projects/`：生成された公開サンプルと `catalog.json`

実装とテストを現在の仕様の一次資料とします。

## 表示言語

ビルダーUIの文言は `src/builder/i18n/` の辞書だけが持ちます。
原本は `ja.ts` で、`Dict` 型をそこから導くため、`en.ts` の不足や余分な項目は型検査で検出します。
React部品からは `useT()`、部品の外からは `t()` を使います。
値を差し込む文言は、言語ごとの語順を保てるよう文字列連結ではなく関数で定義します。

既定言語は日本語です。
選択はlocalStorageの `tobidas.locale` に保存し、作品データや書き出しには含めません。

検証と診断のメッセージは英語で固定し、辞書へ入れません。
対象は `schema/bookValidate.ts`、`runtime/stow/`、`package/` などの純粋モジュールです。
ビルダーの入出力処理が表示する失敗はUI文言なので辞書へ入れます。

書き出した再生画面も英語で固定し、言語切り替えUIを持ちません。

作品データの既定名は投入時の表示言語で決まります。
作成後は作品データとして扱い、UI言語の変更には追従させません。

## 収納と描画の不変条件

制作者が保存するのは完全に開いた見開きだけです。
開閉途中の姿勢は保存せず、収納コンパイラが決定的に導出します。
要素の評価には正規化二面角 `t` だけを使い、同じ進行値は前進、逆再生、ランダムアクセスで同じ姿勢を返します。

二面角が30°を切るまでに部品の収納を完了させます。
`stow/evaluate.ts` の `STOW_SETTLED_DEG` と `settledT`、`assign.ts` の包含検証は同じ閾値を使います。
この区間より後は紙だけが閉じるため、部品を動かすと隣の見開きを貫通します。

二面角が2°を切ったら部品を描きません。
`STOW_HIDDEN_DEG` と `stowIsDrawn` を使い、`STOW_HIDDEN_DEG < STOW_SETTLED_DEG` を保ちます。
綴じ目では向かい合う二面の隙間が0へ収束するため、完全に閉じた状態まで部品を描くと隣の面へ抜けます。

開姿勢から `airborne-route` へ分類された空中部品は60°から30°までの間に不透明度を0へ落とします。
`AIRBORNE_FADE_DEG` と `airborneFade` で角度だけから決め、露出やカメラを入力にしません。
子部品は親から係数を継ぎます。

寝かせた部品のリフトは、次の範囲に収めます。

```text
pageThickness / 4 <= SURFACE_Y + layer × LAYER_LIFT < pageThickness / 2
```

下限は線形深度バッファ上で紙面より前に出すために必要です。
上限は向かい側の紙を抜けないために必要です。
`layerDepthBias` の `polygonOffset` は実装依存で無視されるため、紙面との前後を保証する用途には使いません。
層どうしの順序は `renderOrder` が持ちます。

親が畳まれるときは、子部品の親原点からの隔たりとContent Motionの変位も展開係数 `f` に従わせます。
畳む先は開姿勢での足跡ではなく親の原点です。
足跡は左右の面にまたがる場合があり、片面内への収納を保証できません。
`f <= 0` の子は `ChildNode` で描画対象から外します。

自転 `MotionDelta.spinDeg` は子部品の畳み係数に掛けません。
積算角へ `f` を掛けると表示速度に `θ·f′` が加わり、ページ送り中だけ急速に逆回転します。
上位部品で自転を畳む場合は、`evaluateStow` で一回転へ折り返してから畳みます。

保存形式は支持機構を持ちません。
収納コンパイラは開姿勢から `page-glue`、`flap`、`v-fold`、`airborne-route` 相当の内部結果を導出します。
中央線をまたぐ接地起立面は左右の面が作る楔で評価し、`SpanningVFoldNode` が描画します。
紙面へ接していない要素はコンパイル結果の `airborne-route` となり、外側迂回とフェードを使います。
紙面へ接したビジュアル部品が見開き中央線をまたぐ場合は、中央線交差を優先します。
紙面へ接していない平面部品は中央線折りへ昇格させず、`airborne-route` の外側迂回を優先します。
起立部品は二翼へ自動昇格し、紙面接着された平置き部品は中央線で分割して左右ページへ追従させます。
パーティクルは奥行きを持つ雲ではなく、ビジュアル矩形上へ配置します。
その矩形が空中にあれば、ほかのビジュアル部品と同じ接地判定で `airborne-route` を選びます。
平面自体の回転は制限せず、ほかの平面部品と同じ編集、包含判定、谷折りを使います。

## 時間と音

空間の姿勢は進行値から決定的に評価しますが、効果音は位置を跨いだ瞬間の出来事として扱います。
前へ連続再生している間にキューを跨いだときだけ鳴らし、逆再生、位置の飛ばし、停止中には鳴らしません。
姿勢の評価器へ音の状態を持ち込みません。

時間軸は次の2本です。

- **オーサードタイムライン**：見開きの保持区間の秒。進行値から決定的に評価する
- **Content MotionまたはResident Time**：表示中に続く周期運動。Visibility Gateのmountとunmountを跨いで経過時間を保持する

装飾トラック `stowFlourish` は `t=0` と `t=1` で必ず無効になります。

## 包含検査

部品の貫通や紙面からのはみ出しは、目視だけで判定しません。

1. `stow/assign.ts` の `verifyAndCorrect` が、開き位相の遅延、閉じ際の相似縮小、迂回量を使って収納可能性を検査する
2. `stow/containment.ts` が、保持中の全時刻と全モーション位相について開姿勢の紙面包含を検査する

補正できない問題は `warnings` に残します。
公開サンプルへの合否判定には使いません。紙面より高く積む作品のように、はみ出しを
意図して選ぶことがあるためです。判断は `analyzeBookContainment` の結果を見て人が下します。

ルート部品は左右どちらかのページに属します。
ビルダーは変形後の下端を論理紙面以上へ補正し、中央線を越えた部品の所属ページを開姿勢を保ったまま切り替えます。
背景プリセットは見開き幅と画像比率から初期寸法を決めるだけで、作成後は通常のビジュアル部品として扱います。

## ビルダーと再生画面

`builder/store.ts` を編集状態の唯一の情報源にします。
`commit()` はclone、変更、検証、最大60件のundo追加、500msデバウンスのIndexedDB保存を順に行います。
DBは `tobidas` の単一スロットです。
検証結果はステータスバーへ表示し、エラーのあるパッケージはインポートを拒否します。

AIブラウザ操作モードも `builder/store.ts` のアクションと `commit()` を使います。
DOMから作品オブジェクトを直接変更したり、検証、undo、レイアウト正規化、自動保存を迂回するAI専用経路を作ったりしません。
AIモードの有効状態、フォーム入力、操作結果は編集セッションの状態であり、作品データと公開用書き出しへ含めません。

ギズモ操作の保存先は `applyGizmoTransform` が軸ごとに決めます。
トラックが支配する軸はキーへ、それ以外は `baseTransform` へ書きます。
トラックがある軸の `baseTransform` は描画に現れず収納コンパイラの入力だけを変えるため、そこへ書きません。

公開用の書き出しは単一HTMLと静的ホスト用ZIPの2種類です。
どちらも `public/player/` の同梱プレイヤーを読み、Bookデータを `<script id="tobidas-project">` へ注入します。
このファイルは `npm run build` の3段のビルドで生成します。

単一HTMLは素材をdata URLのまま埋め込むため、`file://` で開けます。
静的ホスト用ZIPは素材を `assets/` へ出し、Bookデータには相対URLを保存します。
外部素材を参照する作品を `file://` で開く方式は、WebGLテクスチャのcross-origin制約により対応しません。

再生カメラは `evaluatePlayCameraPose` が見開きごとに決めます。
カメラキーのある見開きは保存値をそのまま使い、自動フィットを重ねません。
カメラキーのない見開きだけ、作者カメラへ画面比率と展開量に応じた自動フィットを合成します。
カメラキーは見開きのタイムラインにposition、target、fovの3トラックで保存します。
赤いマーカーは保存値、青い枠は再生位置を表し、カメラキーがある場合は一致します。

対数深度バッファは有効にしません。
`gl_FragDepth` を使うと `polygonOffset` が無効になり、重ねた板がちらつくためです。
線形深度の精度は `near = 0.3` で確保し、`camera.test.ts` が近接クリップと遠距離精度を検査します。

自前のシェーダには `logdepthbuf` チャンクを4つとも入れます。
頂点側は `<common>` と `<logdepthbuf_pars_vertex>`、`gl_Position` の後の `<logdepthbuf_vertex>` を使います。
断片側は `<logdepthbuf_pars_fragment>` と `main` 冒頭の `<logdepthbuf_fragment>` を使います。
`<common>` を省くと `isPerspectiveMatrix` が定義されず、シェーダのリンクに失敗します。

部品の投入経路は「プリセットを選んでからアセットをドラッグ」に統一します。
画像5種類と効果音はドラッグを待つトグル、BGM、パーティクル、テキストは押した時点で処理します。
選択中のプリセットがアセット一覧とドロップ先を決め、未選択では配置できません。

AIブラウザ操作モードの直接配置は、ブラウザ操作AIがCanvas座標を推定せずに済むための代替操作面です。
プリセットID、ページ、既存アセット、正規化座標を明示し、通常のドラッグ配置と同じstoreアクションと初期姿勢を使います。

WebMCPはAIモードと同じ作品操作へ接続する構造化ツール経路です。
ユーザー向けのAIモードをWebMCPの有無で分割せず、`document.modelContext` または `navigator.modelContext` をfeature detectして、利用できる場合だけ登録します。
アプリ起動中にWebMCPを登録し、アプリをアンマウントすると `AbortController` で登録を解除します。非対応ブラウザでは既存の意味付きDOM、ARIA、フォーム操作を使います。
WebMCPの登録、実行、失敗時のフォールバックは `src/builder/ai/webmcp.ts` と `src/builder/ai/webmcpTypes.ts` に閉じ込めます。
公式公開版は `WEBMCP_ORIGIN_TRIAL_TOKEN` を設定した `npm run build:public` で生成し、対象Origin用トークンを `dist/index.html` のmetaへ注入します。Chromeトークンはサブドメイン対象とThird-party matchingをOFFにして発行します。Edge用トークンは `WEBMCP_EDGE_ORIGIN_TRIAL_TOKEN` で追加できます。
`build:public` はChrome用トークンがない場合に失敗させます。通常の `npm run build` とローカル開発ではトークンを要求せず、現在のブラウザに応じてChrome、Edge、FirefoxそれぞれのWebMCP設定を案内します。
Tipsは `src/builder/ai/webmcpEnvironment.ts` で公式公開Origin、ローカルclone、別Originと、Chrome、Edge、Firefoxを区別しますが、WebMCPの利用判定には使いません。利用判定は常にAPIのfeature detectを正とします。
ツールの編集処理は `src/builder/ai/commands.ts` の共通コマンドを通し、storeの `commit()`、検証、undo、自動保存を迂回させません。
アセットのバイナリをWebMCP引数へ渡さず、アップロードはAIモードのファイル入力に残します。
ブラウザ別の実測条件と公開するツールは `README.md` の「ブラウザ操作AIから使う」に記載します。

音声は作品に1つのBGMと、音声トラック上の効果音キューで構成します。
1ファイルの上限は `AUDIO_BYTE_LIMIT` の3MBです。
音量は投入時の既定値で固定し、効果音どうしの重なりは許可します。
制作中はdata URLの実体が作品データとundoスタックへ入るため、上限を越える素材を受け付けません。
data URLはWeb Audio、外部ファイルは `HTMLAudioElement` で再生します。
外部ファイルのフェードは要素の `volume` で行い、効果音の重なりは要素を増やして実現します。
`createMediaElementSource` は `file://` で無音になる場合があるため使いません。

再生画面の音楽ボタンは停止ではなく消音を切り替えます。
消音中も曲を進め、解除時は同じ位置から音を戻します。
`stop` は再生自体を終了するときだけ使います。

アイコンは `lucide-react` を `src/ui/Icon.tsx` 経由で使います。
記号、絵文字、アイコンフォント、CDNのスプライトを直接使いません。
意味はボタンの `aria-label` と `title` に持たせ、SVGは支援技術から隠します。
