import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { ClockStore } from './clock'
import { evaluateTimelineEnvironment } from './camera'
import { evaluatePlayCameraPose } from './camera/playCamera'
import { GateSet } from './gate'
import { clamp01, evaluateBookSignals } from './signals'
import { compileSpreadStow } from './stow/assign'
import { normalizedDihedral } from './stow/dihedral'
import { stowIsDrawn } from './stow/evaluate'
import { SpanningVFoldNode, StowElements } from './stow-renderer/StowRenderer'
import type { BookRuntimeProps, RenderSpreadFrame } from './types'
import { PaperSlab, assetFor } from './visuals/ElementVisuals'

export type { BookRuntimeProps, RuntimeSelection } from './types'

/**
 * 恒久フレーム木の描画層。
 *
 * すべての要素は収納コンパイラが割り当てた面フレームの下だけで描画し、
 * Visibility Gate は二面角がほぼ0の見開きだけを描画対象から外す。
 */
const GATE_THRESHOLDS = { openAt: 0.015, closeAt: 0.006 }

export function BookRuntime({ project, progress, foldOverride, showGuides = false, isHidden, onSelect }: BookRuntimeProps) {
  const { book } = project
  const signals = useMemo(() => evaluateBookSignals(book, progress), [book, progress])
  const gates = useMemo(() => new GateSet(GATE_THRESHOLDS), [project.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const clocks = useMemo(() => new ClockStore(), [project.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const assets = useMemo(() => new Map(project.assets.map((asset) => [asset.id, asset])), [project.assets])
  const compiled = useMemo(() => book.spreads.map((spread) => compileSpreadStow(book, spread)), [book])
  const scene = useThree((state) => state.scene)
  const camera = useThree((state) => state.camera)
  const size = useThree((state) => state.size)

  useFrame((_, delta) => clocks.advanceStory(delta))

  const width = book.format.pageWidth
  const depth = width / book.format.pageAspect
  const coverThickness = book.format.coverThickness
  const pageThickness = Math.max(0.006, book.format.pageThickness)
  const spreadCount = book.spreads.length
  const sheetAngles = signals.sheetAngles
  const stack = Math.max(book.format.pageThickness * (spreadCount + 1), coverThickness * 0.22)
  const rigX = -width * 0.5 * (1 - sheetAngles[0]) + width * 0.5 * sheetAngles[spreadCount]

  const frames: RenderSpreadFrame[] = book.spreads.map((spread, index) => {
    const openness = foldOverride && foldOverride.spreadId === spread.id
      ? clamp01(foldOverride.openness)
      : normalizedDihedral(signals.dihedrals[index])
    return {
      spread,
      index,
      t: openness,
      open: gates.evaluate(spread.id, openness),
      stow: compiled[index],
      spreadTime: signals.spreadTimes[index],
    }
  })

  const interiorSheets = useMemo(() => {
    const visible = new Set<number>()
    for (const frame of frames) {
      if (frame.t > 0.004 || frame.open || frame.index === signals.activeSpreadIndex) {
        if (frame.index >= 1) visible.add(frame.index)
        if (frame.index + 1 <= spreadCount - 1) visible.add(frame.index + 1)
      }
    }
    return [...visible].sort((a, b) => a - b)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book, progress, foldOverride])

  const environment = useMemo(() => evaluateTimelineEnvironment(book, progress), [book, progress])
  useEffect(() => {
    scene.background = new THREE.Color(environment.background)
  }, [scene, environment.background])

  useEffect(() => {
    if (showGuides) return
    const pose = evaluatePlayCameraPose(book, progress, size.width / Math.max(1, size.height))
    camera.position.set(...pose.position)
    if (camera instanceof THREE.PerspectiveCamera) camera.fov = pose.fov
    camera.lookAt(...pose.target)
    camera.updateProjectionMatrix()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book, camera, size, progress, showGuides])

  const shared = { assets, clocks, isHidden, onSelect }

  return <group>
    <ambientLight color={environment.lights.ambient.color} intensity={environment.lights.ambient.intensity} />
    <directionalLight position={environment.lights.directional.position}
      color={environment.lights.directional.color}
      intensity={environment.lights.directional.intensity} castShadow />
    <group position={[rigX, 0, 0]}>
      <group rotation={[0, 0, Math.PI * sheetAngles[0]]}>
        <PaperSlab position={[width / 2, coverThickness / 2, 0]} size={[width, coverThickness, depth]}
          color="#4f392c" edge="#2d2019"
          asset={assetFor(assets, book.frontCover.frontAsset)}
          back={assetFor(assets, book.spreads[0].leftPage.backgroundAsset ?? book.frontCover.backAsset)}
          backColor={book.appearance.paperColor} />
        <BackFace width={width} lift={0}>
          <PageClickTarget width={width} depth={depth} spreadId={frames[0].spread.id}
            side="left" onSelect={onSelect} />
          {frames[0].open && <StowElements {...shared} frame={frames[0]} side="left" />}
        </BackFace>
      </group>

      {interiorSheets.map((sheet) => {
        const before = frames[sheet - 1]
        const after = frames[sheet]
        const restY = lerpNumber(
          ((spreadCount - 1) - sheet) * pageThickness + pageThickness / 2,
          (sheet - 1) * pageThickness + pageThickness / 2,
          sheetAngles[sheet],
        )
        return <group key={`sheet-${sheet}`} position={[0, restY, 0]}
          rotation={[0, 0, Math.PI * sheetAngles[sheet]]}>
          <PaperSlab position={[width / 2, 0, 0]} size={[width, pageThickness, depth]}
            color={book.appearance.paperColor} edge={book.appearance.edgeColor}
            asset={assetFor(assets, before.spread.rightPage.backgroundAsset)}
            back={assetFor(assets, after.spread.leftPage.backgroundAsset)} />
          <group position={[width / 2, pageThickness / 2, 0]}>
            <PageClickTarget width={width} depth={depth} spreadId={before.spread.id}
              side="right" onSelect={onSelect} />
            {before.open && <StowElements {...shared} frame={before} side="right" />}
          </group>
          <BackFace width={width} lift={pageThickness / 2}>
            <PageClickTarget width={width} depth={depth} spreadId={after.spread.id}
              side="left" onSelect={onSelect} />
            {after.open && <StowElements {...shared} frame={after} side="left" />}
          </BackFace>
        </group>
      })}

      <group rotation={[0, 0, Math.PI * sheetAngles[spreadCount]]}>
        <PaperSlab position={[width / 2, -stack / 2, 0]} size={[width, stack, depth]}
          color={book.appearance.paperColor} edge={book.appearance.edgeColor}
          asset={assetFor(assets, book.spreads[spreadCount - 1].rightPage.backgroundAsset)} />
        <PaperSlab position={[width / 2, -stack - coverThickness / 2, 0]}
          size={[width, coverThickness, depth]} color="#4f392c" edge="#2d2019"
          asset={assetFor(assets, book.backCover.frontAsset)}
          back={assetFor(assets, book.backCover.backAsset)} />
        <group position={[width / 2, 0.004, 0]}>
          <PageClickTarget width={width} depth={depth} spreadId={frames[spreadCount - 1].spread.id}
            side="right" onSelect={onSelect} />
          {frames[spreadCount - 1].open
            && <StowElements {...shared} frame={frames[spreadCount - 1]} side="right" />}
        </group>
      </group>

      {frames.map((frame) => frame.open && stowIsDrawn(frame.t) && frame.stow.spanning
        .filter((span) => !isHidden?.(frame.spread.id, span.element))
        .map((span) => {
          const override = foldOverride && foldOverride.spreadId === frame.spread.id
          const leftAngle = override ? Math.PI : Math.PI * sheetAngles[frame.index]
          const rightAngle = override ? (1 - frame.t) * Math.PI : Math.PI * sheetAngles[frame.index + 1]
          return <SpanningVFoldNode key={`${frame.spread.id}:${span.element.id}`} span={span}
            leftAngle={leftAngle} rightAngle={rightAngle} assets={assets} clocks={clocks}
            spread={frame.spread} spreadTime={frame.spreadTime} onSelect={onSelect} />
        }))}

      {showGuides && <gridHelper args={[width * 2, 16, '#6d7cff', '#d9d9e8']}
        position={[0, .03, 0]} />}
      <mesh position={[0, -.31, .6]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[width * 2.5, depth * 1.8]} />
        <shadowMaterial transparent opacity={book.appearance.shadowOpacity} />
      </mesh>
    </group>
  </group>
}

function BackFace({ width, lift, children }: { width: number; lift: number; children: React.ReactNode }) {
  return <group rotation={[0, 0, Math.PI]}>
    <group position={[-width / 2, lift, 0]}>{children}</group>
  </group>
}

function PageClickTarget({ width, depth, spreadId, side, onSelect }: {
  width: number
  depth: number
  spreadId: string
  side: 'left' | 'right'
  onSelect?: BookRuntimeProps['onSelect']
}) {
  if (!onSelect) return null
  return <mesh position={[0, 0.001, 0]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={20}
    userData={{ pageDropTarget: { spreadId, side } }}
    onClick={(event) => {
      event.stopPropagation()
      onSelect({ type: 'page', spreadId, side })
    }}>
    <planeGeometry args={[width, depth]} />
    <meshBasicMaterial color="#6d7cff" transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
  </mesh>
}

function lerpNumber(from: number, to: number, progress: number): number {
  return from + (to - from) * progress
}
