# AGENTS.md

このファイルは、Codex・Claude Codeなどのコーディングエージェントがこのリポジトリで作業するときの実装規約です。

tobidas は横開きの「飛び出す絵本風」Web表現を制作・再生するローカルファーストのビルダー。
React 19 + @react-three/fiber (three.js) + zustand + zod / Vite。コード注釈・ドキュメント・コミットメッセージは日本語。

## コマンド

```bash
npm run dev          # ビルダー http://localhost:5174/ (strictPort)。編集も再生も同じ画面
npm run typecheck    # tsc --noEmit
npm test             # vitest run (src/**/*.test.ts)
npm run build        # プレイヤー → public/player/ へ同梱 → ビルダーを dist/ へ。3段が順に必須
npm run samples:generate   # projects/ の3作品と catalog.json を再生成
```

単体テスト:

```bash
npx vitest run src/runtime/stow/stow.test.ts
```

```bash
npx vitest run -t "keeps every part on the paper"
```

視覚検証 (playwright 必須、`npx playwright install chromium`):

```bash
node scripts/screenshot.mjs --project projects/forest_lantern --scroll 0.5 --out shots/mid.png
```

```bash
npm run qa:holds -- --out shots/holds --phases 0.5 --turns
```

再生の操作 (再生・スクロールでの停止・終端からの再開・非表示からの復帰) の確認:

```bash
node scripts/verify-player-controls.mjs forest_lantern
```

`npm run qa:visual` は **開発サーバー起動中** に実行し、全進行値のフレームを `qa/visual/` へ出力する
(コンタクトシート生成に ImageMagick の `magick` が要る)。
`127.0.0.1` は環境により接続できないので必ず `localhost`。

再生画面は作品を**埋め込みデータからしか受け取らない** (書き出した単一HTMLと同じ経路)。
QAスクリプトは `scripts/lib/embedProject.mjs` の `servePlayerWithProject` で playwright に
HTMLの応答を差し替えさせ、配布物と同じ状態で開く。進行値は `?progress=0.34` で直接指定でき、
自動化からは `window.__tobiSetScroll(0..1)` を叩く。

## コミット

コミットメッセージは日本語で複数行になるので、**必ず一時ファイルへ書いて `git commit -F` で渡す**。

```bash
git commit -F /tmp/msg.txt
```

`-m` にインラインで長文を渡すと引用の食い違いで壊れる。とくに PowerShell のヒアストリング
(`@'` … `'@`) を bash ツールへ渡すと、囲みが解釈されず件名の先頭と本文の末尾に `@` が残る。
過去に2回やらかしている。

## 全体構造

保存形式は `src/schema/bookPackage.ts` が定義し、互換性はtobidas本体のリリースバージョンで管理する。
作品は **フォルダ** = `project.json` (交換形式) + `assets/` の実体。この一形式だけで、ZIPに束ねた
表現は持たない。ツールバーは 新規作成 / 開く / 保存 / エクスポート の4つで、開く・保存はどちらも
ファイルピッカーでフォルダを選ばせる (`showDirectoryPicker`)。

評価の流れは一方向:

```text
progress 0..1
  → signals.ts        シートの蝶番角 α → 見開き二面角 δ、ビート、保持時刻
  → stow/assign.ts    収納コンパイラ: 支持機構の割り当て + 包含検証 (開き位相・相似縮小・迂回量)
  → stow/evaluate.ts  t = δ/π だけを入力とする閉形式評価
  → BookRuntime.tsx   恒久フレーム木への描画
```

- `src/schema/` Book、Stage Element、タイムライン、audio contract、パッケージ検証 (zod)
- `src/package/` パッケージの構造、組み立て、serialization
- `src/audio/` PlayerとBuilderが共有するWeb Audio再生 capability
- `src/runtime/` 二面角信号、収納コンパイラ (`stow/`)、開姿勢の包含検査、タイムライン評価、Content Clock
- `src/builder/` 編集UI (zustand store、Viewport、各パネル、`io/`、`persistence/`、`assets/`、`i18n/`)
- `src/player/` 書き出した作品の再生画面 (`player.html` → 同梱時に `index.html`)。開発用の読み込み経路は持たない
- `scripts/samples/` 作品ごとの生成定義と紙工作ヘルパー
- `projects/` 生成された公開サンプル3作品と `catalog.json` (`forest_lantern` / `morning_walk` / `four_seasons`)
- 実装とテストが現在の仕様の一次資料。コード注釈に残る `docs/00N` 参照は、公開リポジトリに含めない内部改修プランの履歴参照

## 表示言語

**ビルダーUIの文言は `src/builder/i18n/` の辞書だけが持つ**。原本は `ja.ts` で、`Dict` 型がそこから
導かれるので、`en.ts` の抜けや余りは型検査で落ちる。部品からは `useT()`、部品の外 (store・`io/`) からは
`t()` で引く。語順は言語で変わるので、値を差し込む文言は文字列連結ではなく関数で持つ。
既定は日本語で、選択は localStorage (`tobidas.locale`) に覚える。作品データにも書き出しにも入らない。

**検証・診断のメッセージは英語で固定**し、辞書へ入れない (`schema/bookValidate.ts`、`runtime/stow/`、
`package/`)。これらは純粋モジュールが返す値で、テストもそのまま照合する。ビルダーの `io/` が出す
インポート/書き出しの失敗はUIの文言なので辞書側。

**書き出した再生画面 (`src/player/`) も英語で固定**。切り替えUIは持たない。

作品データの既定の名前 (新規作品名・見開き名・部品名) は投入時の表示言語で決まるが、
入った後は作品データなので言語を切り替えても追従しない。

## 守るべき不変条件

**制作者が作るのは完全に開いた見開きだけ**。開閉の途中姿勢は保存せず収納コンパイラが決定的に導出する。
要素の評価にビート種別や露出度を持ち込まない (入力は正規化二面角 t のみ)。同じ進行値は
前進・逆再生・ランダムアクセスで必ず同じ姿勢を返す。

**閉じ際の 30° では部品はもう動かない** (`stow/evaluate.ts` の `STOW_SETTLED_DEG` と `settledT`)。
二面角が残り30°を切ったら収納は完了していて、そこから先は紙だけが閉じる。ページをめくる
始まりと終わりは隣の見開きが浅く開いて手前へかぶさる区間で、紙どうしの隙間がいちばん狭い。
そこで部品が起きていると閉じてくる紙を突き抜けて一瞬ちらつく。見えるかどうかはカメラ次第で
変わるので、露出ではなく角度で切る。`assign.ts` の包含検証も同じ `settledT` を通すため、
検証と描画がずれない。

**更に浅い 2° では部品を描かない** (`STOW_HIDDEN_DEG` と `stowIsDrawn`)。残っている理由は
**背表紙のきわ**だけ。向かい合う二面の隙間は背表紙で 0 へ収束するので、綴じ目に置いた部品は
二面角がいくら開いていても隙間で隠せない。抜ける帯の幅は リフト / sin(二面角) で決まり、
リフトが 0.002 なら 2° で 0.057 = 実質見えない。0° では二面が完全に重なって綴じ目の部品が
丸ごと隣の面へ出るので、そこが下限。切るのは `StowElements` と見開きまたぎパネルの2か所だけ。
`STOW_HIDDEN_DEG < STOW_SETTLED_DEG` は必須で、動いている最中に消すと部品が起きたまま突然消える。

**空中の部品 (strut) は 60° から薄れさせる** (`STRUT_FADE_DEG` と `strutFade`)。紙に貼った・
立てた部品は閉じてくる紙そのものが隠すが、透明支持片で浮かせた部品にはその紙が無い。とくに
背表紙の上 (x≈0) に浮かせた部品は、隙間が綴じ目で 0 へ収束するせいでどれだけ開いていても
隙間に隠れず、紙面から離れて宙にいるぶん 2° の帯にも入らない。送りの最中に前の見開きの
ランタンが次の見開きの上へ丸ごと残るのがこれ。切るのは他の閾値と同じく角度だけで判断し、
露出やカメラは持ち込まない。ただし宙のものを突然消すと目立つので、60°→30° の30度かけて
不透明度を 0 まで落とす。収納が終わる 30° で 0 に達しているので、そこから先の「紙だけが
閉じる」区間に空中の部品は一つも描かれていない。開くときは同じ式を逆にたどる。掛かるのは
strut だけで、子部品は親から係数を継ぐ (`StowRenderer` の `fade`)。

**寝かせた部品を紙より厚く浮かせない** (`SURFACE_Y` + `layer × LAYER_LIFT` < `pageThickness / 2`)。
角度で切るだけでは足りない。向かい合う二面の隙間は背表紙で 0 へ収束するので、綴じ目のきわに
置いた部品は二面角がいくら開いていても隙間で隠せず、リフトが紙の厚みを越えていると隣の面へ
抜けて見える。ページ送りの最中、まだ大きく開いている前の見開きの綴じ目に次の見開きの部品が
一瞬だけ現れるのはこれ。

**ただし薄くしすぎてもいけない。紙面との前後を決めているのはこのリフトだけである**
(下限は `pageThickness / 4`、`stow.test.ts` が両側から挟む)。寝た部品は紙とほぼ同一平面に
いるので、線形深度の分解能 `距離² / near × 2⁻²⁴` を越える高さが要る。見開きを見込む距離 40 では
分解能が 3e-4 に達し、リフトを 0.001 まで削ると 3 段しか離れない。紙が視線に対して寝るほど
射影が縮むので、二面角 45° あたりで紙面の部品が軒並み埋もれて全滅する (実際に一度やった)。
`layerDepthBias` の polygonOffset を当てにしてはいけない — 実装依存で丸ごと無視されることがあり
(headless Chromium の WebKit WebGL では -5000 単位でも動かない)、同一平面の前後の保証にならない。
層どうしの順は `renderOrder` (100 + layer) の描画順が持つ (深度が同値なら後から描いたほうが勝つ)
ので、`LAYER_LIFT` は層を離すためではなく順に積むだけの微量でよい。

**畳まれたら中身も畳む**。収納が動かすのは要素の原点だけなので、原点からの隔たりを持つものと
住人の変位は、自分で展開係数 f に従う責任がある。部品が寝るときの回転は接地線まわりの90度なので、
開姿勢では紙面と平行だった隔たりが寝かせたあとは紙面の法線へ倒れる。従わせ忘れると中身だけ
紙面から持ち上がり、ページの傾きに乗って本の外や隣の面へ飛び出す。回り続ける板も同じ理由で
立ち上がり、次の見開きの背表紙付近へ前の見開きの部品が残って見える。現在の担い手は2つ:
子部品 (`evaluateChildPose` — 親からの隔たりと content motion の両方) と、
光の欠片の雲の広がり (`visuals/sparkleField.ts`)。どちらも f=1 では制作値へ厳密に一致する。
同種のものを足すときは同じ約束を守る。

**ただし自転 (`spin`) は畳まない** (`MotionDelta.spinDeg`)。自転角は住人時間に比例して積み上がる
ので、f を掛けると表示速度が θ′·f + **θ·f′** になり、f が動く瞬間 (= ページ送り) だけ何十倍もの
速さで逆回転する。しかも表示していた時間が長いほど酷くなる (実測: 30秒で通常の20倍)。
往復運動の振れ幅は有界なのでこの項は無害で、分けるのは自転だけ。子は `f <= 0` で描画ごと
落ちるので、自転を制作値の向きへ戻す必要がそもそもない。上位の部品は 30°..2° の間まだ
描かれるため畳まないといけないので、一回転へ折り返してから畳む (`evaluateStow`)。
「f=1 で制作値へ厳密一致」と「f=0 で制作値へ戻る」を両立させる連続な畳み方は存在しない
(円周上の写像の次数が 1 と 0 で変わる) ので、暴走ではなく折り返しの飛びを採っている。

畳む先は **親の原点**であって、開姿勢での足跡ではない。足跡へ降ろす案は成り立たない —
軌道する部品の軸は背表紙の上に置かれることがあり、その足跡は左右両方の面にまたがる。
収納先は片面なので、足跡を保つと必ず面の外へ出る。原点へ畳むのが、親の検証済みの足跡から
出ないことを保証できる唯一の畳み方。ただし畳み切った子は点でしかなく、背表紙の上に軸を置いた
軌道部品はそこへ集まるので、`f <= 0` の子は `ChildNode` が描画ごと落とす。

支持機構は4種で、`stow.mechanism: 'auto'` なら開姿勢から判定される:
`page-glue` (紙面接着) / `flap` (接地線ヒンジで起立) / `v-fold` (背をまたぐ二つ折り) / `strut` (透明支持片で空中)。
`parent: 'spread'` の v-fold だけは面フレームではなく楔 (左右の面の角度) で評価され、`SpanningVFoldNode` が描く。

**音は冪等でない** (`runtime/soundCues.ts`)。「同じ進行値は必ず同じ姿勢を返す」は空間の不変条件で、
音へ適用するとスクラブのたびに同じ音が鳴る。効果音は跨いだ瞬間の出来事として扱い、前へ連続再生して
いる間に跨いだときだけ一度鳴らす (逆再生・つまみの飛ばし・停止中は鳴らさない)。姿勢の評価器へ音を
持ち込まず、再生位置を進める側が前後の位置を渡して問う。

時間軸は2本あり混同しない:

- **オーサードタイムライン** — 見開きの保持区間の秒。progress から決定的に評価する (`runtime/timeline/evaluate.ts`)
- **Content Motion / Resident Time** — 表示中ずっと続く周期運動。`ClockStore` が Visibility Gate の
  mount/unmount を跨いで経過時間を保持する。装飾トラック (`stowFlourish`) は t=0,1 で必ず効かない

「部品が本を貫通する・紙面からはみ出す」の判定基準は目視ではなく2つの機械検査:

1. コンパイル時の包含検証 (`stow/assign.ts` の `verifyAndCorrect`) — 閉じられるか。位相の自動遅延と
   閉じ際の相似縮小で吸収し、解消できなければ `warnings`
2. 開姿勢の包含検査 (`stow/containment.ts`) — 保持中の全時刻・全モーション位相で紙の上にいるか。
   3作品ぶんを `src/schema/bookPackage.test.ts` が errors/warnings ゼロで要求する

背景 (`sourcePreset: 'depth-layer'`) は必ず左右どちらか片面の直下に属し、片面幅を越えられない
(`store.ts` の `constrainSinglePageBackground` と `bookValidate.ts` の両方で強制)。

## サンプル作品の変更手順

`projects/*/project.json` は生成物。**直接編集しない** (次の生成で消える)。作り方は2通り:

- **作品の構造を変える**なら `scripts/samples/<work>.mjs` を直して `npm run samples:generate`
- **画面で見て詰めた位置・大きさ**は `scripts/samples/overrides/<work>.json` へ書く。
  鍵は `見開きID/要素ID`、値は `position` / `rotation` / `scale` / `width` / `height` /
  `layer` / `opacity` / `visible` / `asset` と `remove`。生成の最後に当たり、要素を消すと
  参照の無くなった素材も落ちる (`scripts/samples/overrides.mjs`)

手直しの loop は `npm run samples:generate && npm run samples:check`。上書きも包含検査を通るので、
畳めない位置へ動かせば落ちる。検査は直せる値を添えて言う
(`needs width <= 14.36 or z >= -1.84` / `needs height <= 2.50 or z >= -0.27`) ので、その範囲へ寄せる。
**紙のほうが正しく、上書きは紙に勝てない**。

定義は世界座標ではなく紙工作の語彙で書く
(`shared.mjs`: `flat`=page-glue / `stand`=flap / `arch`=v-fold / `hover`=strut、ほかに `caption`,
`signText`, `sparkle`, `pivotGroup`)。位置は片面内の正規化座標 `u` (背表紙0→小口1)、`v` (奥0→手前1)。
紙面に収まらない配置・畳めない高さは投入時に throw して生成を止める設計なので、失敗メッセージを
無効化せず配置を直す。

寸法は「画面に映える大きさ」で個別に決めない。`scaleOf(metersPerUnit)` で縮尺を定め、
実物の高さ表 `REAL` (shared.mjs) を通して書く。個別に決めると犬も郵便ポストも家も1単位前後へ寄り、
大小の梯子が潰れて遠近感が読めなくなる。縮尺は紙面に描かれた模様の粒 (敷石・落ち葉) から逆算する。
縮尺は舞台ごとに分けてよい (`morning_walk` の `street` / `near` / `crossing` / `room`)。
とくに手前の小物と人は、屋外の実寸のままだと敷石の染みにしか見えないので一段大きい縮尺へ回す。
**分けてよいのは縮尺であって、同じ縮尺の中の比ではない**。犬とポストと子どもの比は実物のまま保つ。

遠景の作り方は絵の性質で選ぶ。木立のような繰り返しの地紋なら、片面ごとの立ち板を
`BACKDROP_WIDTH` で2枚並べてよい (`forest_lantern`) — 綴じ目の継ぎ目が読めない。
家並みや稜線のように見分けのつくパノラマは背をまたぐアーチ一枚で通す (`morning_walk`)。
2枚に割ると綴じ目で絵が切れて短冊が2本に見え、さらに片面幅に縦横比を掛けたぶんで
高さが頭打ちになり、家並みが低い帯にしかならない。アーチの幅は奥行き v が決める
(`z - width×0.089` が紙面の奥を越えられない) ので、奥へ置くほど細い。
手前のアーチより奥、かつ翼が紙面へ収まる v を選ぶ。
見出しの枠を立てるなら `signText` で必ず文字を入れる。空の白板を並べない。

**素材の実体は WebP**。`.mjs` 内の SVG は寸法とレイアウトを宣言する下書きにすぎず、`art()` は
同名の `scripts/samples/assets/<work>/<id>.webp` を読み込んで同梱する (無いと生成が落ちる)。
生成済み素材の取り込みは `node scripts/adopt-alt-asset.mjs <work> <ref内パス> <出力名.webp> --width W`
(紙面背景は `--page`、`--keep-top` / `--keep-bottom` で帯を選ぶ)。ImageMagick の `magick` が要る。
取り込み元の `ref/assets_alt/` はgit追跡外で、成果物のWebPだけが管理対象。

**表紙の英字タイトルは絵に焼き込んである** (`node scripts/bake-cover-titles.mjs`、`--preview` で
ref/ へ出すだけ)。部品として立てられないのは、表紙を開く区間が見開きの保持区間の外にあり、
そこに置ける要素も時刻も無いから。取り込み元は `ref/covers-src/<work>.webp` の**字の入っていない
原画**で、adopt-alt-asset と同じ約束。焼き込み済みの素材を入力にすると字が二重になるので、
入力を `scripts/samples/assets/` へ向けてはいけない。

**音は3作品で共通**で、`scripts/samples/assets/audio/` に実体を置く (絵と違って作品ごとに分けない)。
`work.bgm('bgm.mp3')` が作品に一つのBGM (冒頭からループ、音量は編集UIの既定 0.7) を、
`work.pageTurns('page-turn.wav')` が見開きの保持区間の終わり — つまり送りの始まり — へ
ページをめくる音の点を置く。**最後の見開きには置かない**。そこで起きるのは送りではなく
本を閉じる動作で、紙が一枚めくれる音は表紙が閉じる絵と噛み合わない。表表紙側にも音は無い
(効果音は見開きの保持区間の中にしか置けず、表紙を開く区間はその外にある)。`pageTurns` は
見開きを全部組んでから呼ぶ。個別に置くなら見開きの `s.cue(素材ID, [時刻])`。

**部品の寸法の出典は実WebPだけ**。下書きSVGが宣言する width/height は素案で、`art()` は採らない
(`shared.mjs` の `webpSize` がファイルのヘッダから読む)。幅は `wide(高さ, 素材ID)` で引き、
縦横比は実ファイルが持つ。数値の px 対を手で書くと、素材を差し替えたときに必ずずれる。

**絵の周囲に透明の余白を残さない**。世界寸法は画像の枠に割り当たるので、余白があるぶん絵は
小さく描かれ、立ち板なら接地線から浮く。画像サイズを見ても枠しか分からないため、点検は
アルファの外接矩形で行う (`node scripts/trim-assets.mjs` が下見、`--apply` で切る)。
差し替わる連番・パノラマの左右半分・重ねる2枚は枠を共有させ、回転する部品は枠の中心を保つ
(スクリプトの `GROUPS` と `KEEP_CENTER`)。切ったあと `wide()` は自動で追従するが、
`arch` のように幅と高さを直に書いた部品は、絵が枠いっぱいへ育つぶん寸法を決め直すこと。

`bookPackage.test.ts` は3作品それぞれの演出内容 (電車が一度だけ通る、家が順に灯る、季節が順に渡る等) を
構造として検査する。演出を変えたらこのテストも合わせて更新する。素材は全WebP・1作品あたり合計12MB未満が要件。

**サンプル中の文言は英語**。`caption` / `signText` の text と、catalog に出る title / description が対象。
コード注釈とコミットメッセージは日本語のまま。

`curry_recipe` と `solar_system` は公開対象から外し、`ref/retired-samples/<id>/` へ退避してある
(定義 `.mjs`、素材 `assets/`、生成物 `project/` の3点セット)。`ref/` はgit追跡外。戻すときは
3点を元の場所へ返し、`generate-samples.mjs` の `BUILDERS` と `bookPackage.test.ts` のカタログ検査へ足す。

## ビルダー / 再生の実装メモ

- `builder/store.ts` が唯一の状態源。`commit()` が structuredClone → 変更 → `validateBookProject` →
  undo スタック (60) → 500ms デバウンスで IndexedDB 保存。DBは `tobidas` の単一スロット
- 検証結果はステータスバーに出る。エラーのあるパッケージはインポートを拒否する
- ギズモ操作の反映先は `applyGizmoTransform` が軸ごとに決める。トラックが支配している軸は
  キーへ、それ以外は baseTransform へ書く。トラックのある軸の baseTransform は描画に現れず、
  収納コンパイラの入力にだけ効いてしまうため、ここへ書いてはいけない
- 公開用の書き出しは2通りで、素材の実体をどこへ置くかだけが違う。どちらも
  `public/player/` の同梱プレイヤー (JS/CSSをインライン化した単一HTML) を fetch し、Bookデータを
  `<script id="tobidas-project">` へ注入する。`npm run build` を通していないと成立しない
  - **単一HTML** — 実体を data URL のまま埋め込み `<作品名>.html` を1ファイルで保存する。file:// で開ける
  - **静的ホスト** — 実体を元の形式で `assets/` へ出し、Bookデータには相対URLだけ残して `.site.zip` に束ねる
- **素材を外へ出したまま file:// で開くことはできない**。file:// のページから見ると隣のファイルは
  別オリジンで、画像は `<img>` としては読めてもWebGLのテクスチャにする段で cross-origin として弾かれる。
  プレイヤーは全面WebGLなので絵が出ない。だから両立させず、書き出す時点で配り方を選ばせる。
  音声だけは HTMLAudioElement のまま鳴らせば file:// でも通る
- 再生カメラは2択で、`evaluatePlayCameraPose` が見開きごとに決める。編集ビューと再生ビューが同じ式を共有する
  - **カメラキーのある見開き**は保存値をそのまま使う。自動フィットを重ねると画面の縦横比で
    注視点から引き伸ばされ、カメラを打った意味が消える。縦長の画面では構図が見切れるが、
    それは制作者が決めた画作りの結果。ビルダーの赤いマーカー (保存値) と青い枠 (再生位置) が
    一致するのもこの約束による
  - **カメラキーのない見開き**は作者カメラ + 縦横比・見開きの展開量に応じた自動フィットの合成
- **対数深度バッファは使えない** (`runtime/camera/view.ts` の `VIEW_GL`)。シェーダから
  `gl_FragDepth` を書くため `polygonOffset` が丸ごと無効になる。同じ場所に重ねた板どうしの
  取り合いを均しているのが `layerDepthBias` の polygonOffset なので、これを失うと重ね置きが
  ちらつく。紙面へ寝かせた部品を紙より前に置いているのはこちらではなく `SURFACE_Y` の
  幾何のリフトのほう (上の不変条件)。polygonOffset は実装依存で無視されうるので、
  紙面との前後をそちらへ預けてはいけない。
  精度は `near` で稼ぐ: 線形深度の分解能は `距離² / near × 2⁻²⁴` で、`near = 0.3` なら
  距離200まで紙の隙間 `pageThickness/2` を割らない。上げすぎると寄ったときに手前の部品が
  前面でクリップされる。`camera.test.ts` が両方を固定している
- 自前のシェーダを書くときは `logdepthbuf` チャンクを4つとも差し込んでおく。今は `#ifdef` で
  消えるが、誰かが対数深度を有効にしたときにそのオブジェクトだけ壊れないようにするため。
  頂点は `<common>` + `<logdepthbuf_pars_vertex>` と gl_Position の後の `<logdepthbuf_vertex>`、
  断片は `<logdepthbuf_pars_fragment>` と main 頭の `<logdepthbuf_fragment>`。`<common>` を
  忘れると `isPerspectiveMatrix` が無くてリンクで転け、材質ごと描かれなくなる。現在の担い手は
  光の欠片の `SparkleMaterial` (`visuals/ElementVisuals.tsx`) 一つだけ
- カメラキーは見開きのタイムライン (`target.type === 'camera'` の position / target / fov トラック)。
  ビューポートの保存ボタンが現在の見開き時刻へ3本まとめて打ち、赤いカメラマーカー
  (`SavedCameraMarkers`) が編集中の見開きのぶんだけ立つ。枠をつつくとその時刻へ飛ぶ
- 部品の投入は**プリセットを選んでからアセットをドラッグ**の一本。画像の5つと効果音は
  トグル (掴むものを待つ)、BGM・パーティクル・テキストは押した瞬間に用が済む。選択中のプリセットが
  アセット一覧の中身とドロップ先 (紙面 / 中央全域) を決める。未選択では落とせない
- 音声は BGM (`project.audio`、作品に一つ、冒頭からループ) と効果音 (音声トラックの `cue` キー、
  時刻だけを持つ点) の2つ。音量は既定値で固定し、重なりは許す。1本 3MB まで (`AUDIO_BYTE_LIMIT`)。
  上限は編集の重さで決めている (制作中は data URL のまま作品データと undo スタックへ乗る)
- 音声の再生経路は実体の在り処で分かれる (`audio/playback.ts`)。data URL は `decodeAudioData` から
  Web Audio へ、外部ファイルは HTMLAudioElement のまま鳴らす。後者はフェードを `volume` で作り、
  効果音の重なりは要素を増やして作る。`createMediaElementSource` は使えない (file:// で無音化されうる)
- 再生画面の音楽ボタンは**消音の切り替え** (`AudioPlayback.setMuted`)。動画プレイヤーのミュートと
  同じで、消している間も曲は流れ続け、戻すとその間に進んだ続きから鳴る。`stop` と `play` で
  往復させると音源を作り直すことになり、必ず頭から鳴ってしまう。`stop` は再生をやめるとき用
- アイコンは `lucide-react` を `src/ui/Icon.tsx` 経由で使う (寸法・線幅・`aria-hidden` はここだけで決める)。
  記号や絵文字を直に書かない。**アイコンフォントやCDN参照のスプライトは使えない** —
  同梱プレイヤーは単一HTMLへインライン化され `file://` で開かれるので、外部ファイル参照は成立しない。
  意味はボタンの `aria-label` / `title` が持ち、SVGは支援技術から隠す
