import { z } from 'zod'

/**
 * 作品ごとに保存する制作方針の上限。
 * 長文の制作メモがundo履歴やWebMCPの戻り値を占有しすぎないようにする。
 */
export const AUTHORING_GUIDE_TEXT_LIMIT = 12_000

const guideTextSchema = z.string().max(AUTHORING_GUIDE_TEXT_LIMIT)

export const AUTHORING_GUIDE_KEYS = [
  'creativeIntent',
  'storyStructure',
  'languageAndText',
  'visualStyle',
  'coverPresentation',
  'spreadGround',
  'spatialBackground',
  'partsAndVariety',
  'characterContinuity',
  'scaleAndDepth',
  'paperEngineering',
  'bodyText',
  'assetQuality',
  'cameraLightingAndMotion',
  'soundDirection',
  'qualityReview',
  'additionalInstructions',
] as const

export type AuthoringGuideKey = (typeof AUTHORING_GUIDE_KEYS)[number]

export const authoringGuideLocaleSchema = z.object({
  creativeIntent: guideTextSchema,
  storyStructure: guideTextSchema,
  languageAndText: guideTextSchema,
  visualStyle: guideTextSchema,
  coverPresentation: guideTextSchema,
  spreadGround: guideTextSchema,
  spatialBackground: guideTextSchema,
  partsAndVariety: guideTextSchema,
  characterContinuity: guideTextSchema,
  scaleAndDepth: guideTextSchema,
  paperEngineering: guideTextSchema,
  bodyText: guideTextSchema,
  assetQuality: guideTextSchema,
  cameraLightingAndMotion: guideTextSchema,
  soundDirection: guideTextSchema,
  qualityReview: guideTextSchema,
  additionalInstructions: guideTextSchema,
})

export type AuthoringGuideLocale = z.infer<typeof authoringGuideLocaleSchema>

export const authoringGuideSchema = z.object({
  ja: authoringGuideLocaleSchema,
  en: authoringGuideLocaleSchema,
})

export type AuthoringGuide = z.infer<typeof authoringGuideSchema>

/** 新規作品へ複製する日本語の制作ガイド既定値。作品ごとに編集して保存する。 */
export const DEFAULT_AUTHORING_GUIDE_JA: AuthoringGuideLocale = {
  creativeIntent: '子どもから大人まで楽しめる、優しい表現。',
  storyStructure: '物語の見開きは5つ。各見開きに異なる物語上の役割、場面の変化、視覚的な焦点を持たせる。',
  languageAndText: 'タイトルと本文は日本語。本文は紙面で読みやすい量に収める。',
  visualStyle: '手描きの絵本らしい表現。素材間で絵柄、比率、色、縮尺、光の方向を揃える。',
  coverPresentation: '表紙の外側、表紙の内側、背表紙を別々の面として扱う。タイトルは表紙に置き、外側の絵を内側へそのまま重複させない。',
  spreadGround: '見開き画像は主に地面や床として使う。飛び出す部品にする人物、建物、木、橋、道具などの目立つ絵は地面画像へ描き込まない。',
  spatialBackground: '見開きごとに淡い遠景を別に用意する。霞、遠いシルエット、景色で奥行きを作り、主役の飛び出す部品と競合させない。',
  partsAndVariety: '地面を含め、見開きごとに少なくとも4つのビジュアル部品を使い、そのうち少なくとも3つを独立した立体部品にする。人物、建物、動物、道具、植物、光の欠片などを使い分け、背景と部品で同じ画像を使わない。',
  characterContinuity: '再登場する人物は見分けられるようにしつつ、見開きごとにポーズ、表情、服装、持ち物、光のいずれかを変えた別素材にする。',
  scaleAndDepth: '同じ場面の縮尺に属する物どうしの比率を保つ。遠景を行動の後ろへ置き、手前の部品を背景パネルより明確に前へ置く。',
  paperEngineering: '部品を所属ページ内に収め、大きな部品を綴じ目付近へ密集させない。閉じたときに対向ページを横切らないようにし、背景パネルを奥へ置いて先に起こす。',
  bodyText: '物語の本文、キャプション、台詞は所属ページに印刷されたものとして扱う。本文は紙面へ固定し、保持中は表示し、パーティクル、常時モーション、演出用タイムラインを付けない。',
  assetQuality: '切り抜き素材には本物の透過を使う。チェッカーボードや白背景を焼き込まず、不要な透明余白を切り取り、地面・遠景・部品の間で主題を重複させない。',
  cameraLightingAndMotion: 'カメラ、照明変化、常時モーション、パーティクル、タイムライン演出は、視線誘導、場面の変化、奥行きの強化に役立つ場合だけ使う。動きを増やす目的だけでは追加しない。',
  soundDirection: '最後の物語見開きの後を除き、組み込みのページめくり音を使う。BGMは1つにし、登場、魔法、足音、水、風など物語上の出来事に合う効果音を加える。',
  qualityReview: '各見開きを保持の始め、中間、終わりとページ遷移の中間で確認する。多様性、本文の読みやすさ、紙面への固定、奥行き、包含、衝突を確認して完成とする。',
  additionalInstructions: '',
}

/** 新規作品へ複製する英語の制作ガイド既定値。日本語の既定値も表示言語切り替え用に保持する。 */
export const DEFAULT_AUTHORING_GUIDE_EN: AuthoringGuideLocale = {
  creativeIntent: 'A gentle expression that children and adults can enjoy.',
  storyStructure: 'Use five story spreads. Give every spread a distinct narrative role, scene change, and visual focus.',
  languageAndText: 'Use an English title and English in-story text. Keep page text concise enough to remain readable on the paper.',
  visualStyle: 'Use a hand-drawn picture-book style. Keep style, proportions, palette, scale, and light direction coherent across assets.',
  coverPresentation: 'Prepare the front exterior, front interior, and back cover as distinct surfaces. Put the title on the front cover and keep interior cover art intentional rather than duplicating the exterior.',
  spreadGround: 'Use spread page images primarily as ground surfaces. Do not bake prominent people, buildings, trees, bridges, tools, or other objects that should become pop-up parts into the ground image.',
  spatialBackground: 'Prepare a separate pale spatial background for each spread. Use haze, distant silhouettes, or scenery that creates depth without competing with the main pop-up parts.',
  partsAndVariety: 'Use at least four visual parts per spread including the ground, with at least three separate 3D parts. Prefer varied people, buildings, animals, tools, plants, and light fragments. Do not reuse one image as both background and part.',
  characterContinuity: 'Keep recurring characters recognizable, but use a distinct asset on each spread with a scene-specific change in pose, expression, clothing, held object, or lighting.',
  scaleAndDepth: 'Preserve relative scale among objects that belong to the same scene scale. Place distant scenery behind the action and keep foreground parts clearly in front of background panels.',
  paperEngineering: 'Keep parts on their owning page, avoid crowding large parts near the gutter, and avoid layouts that cross the opposite page when closing. Put background panels at the rear and make them rise before foreground parts.',
  bodyText: 'Treat story text, captions, and dialogue as printing on the owning page. Keep body text page-attached, visible throughout the hold, and free of particles, resident motion, and directing timelines.',
  assetQuality: 'Use clean cutout assets with real transparency. Do not bake checkerboards or white backgrounds into cutouts, trim unintended transparent margins, and avoid duplicated subjects between ground, background, and parts.',
  cameraLightingAndMotion: 'Use camera movement, lighting changes, resident motion, particles, and timeline effects only when they guide attention, explain a scene change, or strengthen depth. Avoid effects added only to increase activity.',
  soundDirection: "Use the built-in page-turn sound for transitions except after the final story spread. Use one BGM and add scene-specific effects when they support entrances, magic, footsteps, water, wind, or other narrative events.",
  qualityReview: 'Review every spread at the beginning, middle, and end of its hold and at the midpoint of page transitions. Check variety, readable text, paper attachment, depth order, containment, and collisions before completion.',
  additionalInstructions: '',
}

const LEGACY_DEFAULT_AUTHORING_GUIDE_EN: Partial<AuthoringGuideLocale> = {
  creativeIntent: 'Define the intended reader, emotional arc, and the one experience each spread should support.',
  storyStructure: 'Use five story spreads unless requested otherwise. Give every spread a distinct narrative role, scene change, and visual focus.',
  languageAndText: 'Use an English title and English in-story text unless requested otherwise. Keep page text concise enough to remain readable on the paper.',
  visualStyle: 'Use a hand-drawn picture-book style unless requested otherwise. Keep style, proportions, palette, scale, and light direction coherent across assets.',
}

/** 新規作品へ複製する言語別の制作ガイド既定値。 */
export const DEFAULT_AUTHORING_GUIDE: AuthoringGuide = {
  ja: DEFAULT_AUTHORING_GUIDE_JA,
  en: DEFAULT_AUTHORING_GUIDE_EN,
}

/** 旧形式の単一本文を、既定値を失わない言語別形式へ移行する。 */
export function migrateAuthoringGuide(value: unknown): unknown {
  const legacy = authoringGuideLocaleSchema.safeParse(value)
  if (!legacy.success) return value
  const ja = {} as AuthoringGuideLocale
  const en = {} as AuthoringGuideLocale
  for (const key of AUTHORING_GUIDE_KEYS) {
    const text = legacy.data[key]
    if (text === DEFAULT_AUTHORING_GUIDE_EN[key] || text === LEGACY_DEFAULT_AUTHORING_GUIDE_EN[key]) {
      ja[key] = DEFAULT_AUTHORING_GUIDE_JA[key]
      en[key] = DEFAULT_AUTHORING_GUIDE_EN[key]
    } else {
      ja[key] = text
      en[key] = text
    }
  }
  return { ja, en }
}

export function createDefaultAuthoringGuide(): AuthoringGuide {
  return structuredClone(DEFAULT_AUTHORING_GUIDE)
}
