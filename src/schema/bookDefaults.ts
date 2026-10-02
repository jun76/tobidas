import { DEFAULT_BOOK_LIGHTS, type Book, type Page, type Spread } from './book'
import { createDefaultAuthoringGuide } from './authoringGuide'
import type { BookProject } from './bookPackage'
import type { ParentSpace, StageElement, StageElementType } from './stageElement'
import { makeMechanism } from './mechanism'

let counter = 0
export function bookId(prefix = 'id') { counter = (counter + 1) % 1296; return `${prefix}_${Date.now().toString(36)}${counter.toString(36).padStart(2, '0')}` }

export function createPage(partial: Partial<Page> = {}): Page { return { ...partial } }
export function createSpread(name = 'Spread 1', partial: Partial<Spread> = {}): Spread {
  return {
    id: bookId('spread'),
    name,
    leftPage: createPage(),
    rightPage: createPage(),
    elements: [],
    sequence: { holdSeconds: 3.5, turnSeconds: 1.5 },
    timeline: { tracks: [] },
    ...partial,
  }
}
export function createBook(partial: Partial<Book> = {}): Book {
  return {
    sequence: { coverOpenSeconds: 1.5 },
    readAloud: true,
    format: { pageAspect: 1.25, pageWidth: 8, coverThickness: .18, pageThickness: .015, gutter: .08, binding: 'left' },
    appearance: { paperColor: '#f4ecd8', edgeColor: '#c9b99b', roughness: .9, background: '#cfe2e8', shadowOpacity: .35, showSupports: false },
    // 谷に沿う起立面と支持ブリッジを、新規作品の最初の視点から確認できるようにする。
    camera: { position: [8, 8, 14], target: [0, 1, 0], fov: 42 }, lights: structuredClone(DEFAULT_BOOK_LIGHTS),
    frontCover: {}, spreads: [createSpread()], backCover: {}, ...partial,
  }
}
export function createBookProject(name = 'New pop-up book'): BookProject {
  return { id: bookId('book'), name, authoringGuide: createDefaultAuthoringGuide(), book: createBook(), assets: [], updatedAt: new Date().toISOString() }
}

export function createStageElement(
  type: StageElementType = 'visual',
  parent: ParentSpace = { type: 'right-page' },
  _legacyMechanism?: unknown,
): StageElement {
  const common = {
    id: bookId('element'), name: 'Part', visible: true, opacity: 1, parent,
    baseTransform: { position: [0, .005, 0] as [number, number, number], rotation: [-90, 0, 0] as [number, number, number], scale: [1, 1, 1] as [number, number, number] },
    pivot: [0.5, 0] as [number, number], layer: 0, motion: [], clock: 'visible-elapsed' as const,
    stow: { fallDirection: 'auto' as const, stagger: 0 },
  }
  if (type === 'visual') return {
    ...common, type, width: 2, height: 2, billboard: false,
    backgroundColor: '#00000000', foregroundColor: '#2e241b', text: '', fontSize: .35,
    align: 'center', speech: 'none', font: 'rounded', bold: true, italic: false, underline: false,
    particles: { enabled: false, color: '#fff3a0', count: 6, size: .45, drift: .05, period: 11 },
  }
  if (type === 'particle') return {
    ...common, type, width: 2, height: 2, billboard: false,
    particles: { color: '#fff3a0', count: 6, size: .45, drift: .05, period: 11 },
  }
  if (type === 'part') return {
    ...common, type,
    baseTransform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    part: { definition: { builtin: 'flat', version: 1 }, mount: { type: 'output', nodeId: '$book', portId: parent.type === 'left-page' ? 'left-page' : 'right-page' }, parameters: {}, materials: {} },
  }
  if (type === 'assembly') return {
    ...common, type, mechanism: makeMechanism('box'),
    baseTransform: { ...common.baseTransform, position: [0, 0, 0], rotation: [0, 0, 0] },
  }
  return { ...common, type, baseTransform: { ...common.baseTransform, rotation: [0, 0, 0] } }
}
