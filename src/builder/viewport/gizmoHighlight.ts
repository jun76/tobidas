import * as THREE from 'three'
import type { TransformControls as TransformControlsImpl } from 'three-stdlib'

/**
 * ギズモのホバー強調を差し替える。
 *
 * three-stdlib の TransformControls は、ホバー中のハンドルを「不透明度1・色を白へ50%寄せる」で
 * 示し、それ以外を0.25まで落とす (controls/TransformControls.js の updateMatrixWorld)。
 * 二軸操作の矩形は塗り面積があるので白へ寄せても明るく読めるが、軸は太さ1pxの Line なので
 * 白へ寄せた瞬間に明るい紙面へ溶けて消える。LineBasicMaterial の linewidth は WebGL で効かず、
 * 線そのものを太らせる手はない。
 *
 * そこで軸ごとに太い棒 (Mesh) を仕込んでおき、ホバー中だけその軸へ重ねて描く。色は白へ寄せず
 * 素の彩度で出し、ホバー外の減光も 0.25 では落としすぎなので緩める。棒はギズモ本体と同じ
 * ハンドル群へ入れるので、視線と平行な軸を隠す判定も裏返しの反転も本体と同じ扱いを受ける。
 */

const IDLE_OPACITY = 0.45
const BAR_RADIUS = 0.024
const AXES = ['X', 'Y', 'Z'] as const
const MODES = ['translate', 'rotate', 'scale'] as const
const AXIS_COLORS: Record<Axis, number> = { X: 0xff0000, Y: 0x00ff00, Z: 0x0000ff }

type Axis = (typeof AXES)[number]
type Mode = (typeof MODES)[number]
type GizmoMaterial = THREE.Material & {
  color: THREE.Color
  opacity: number
  tempColor?: THREE.Color
  tempOpacity?: number
}
type Handle = THREE.Object3D & { material?: GizmoMaterial }
type GizmoRoot = THREE.Object3D & {
  gizmo: Partial<Record<Mode, THREE.Object3D>>
  axis: string | null
  mode: Mode
  enabled: boolean
}

export function emphasizeHoveredAxis(control: TransformControlsImpl): void {
  const root = (control as unknown as { gizmo?: GizmoRoot }).gizmo
  if (!root || root.userData.hoverEmphasis === true) return
  root.userData.hoverEmphasis = true
  installBars(root)
  const base = root.updateMatrixWorld.bind(root)
  root.updateMatrixWorld = (force?: boolean) => {
    base(force)
    highlight(root)
  }
}

/** 軸に沿った太い棒。原点から +axis 方向へ length だけ伸びる (ギズモの軸線と同じ張り方) */
function straightBar(axis: Axis, length: number): THREE.BufferGeometry {
  const geometry = new THREE.CylinderGeometry(BAR_RADIUS, BAR_RADIUS, length, 10, 1, false)
  geometry.translate(0, length / 2, 0)
  if (axis === 'X') geometry.rotateZ(-Math.PI / 2)
  if (axis === 'Z') geometry.rotateX(Math.PI / 2)
  return geometry
}

/** 回転リングに重ねる太い半円。ギズモ側は (0, cosθ, sinθ) の半円なので基底を入れ替えて合わせる */
function ringBar(axis: Axis): THREE.BufferGeometry {
  const geometry = new THREE.TorusGeometry(1, BAR_RADIUS, 6, 44, Math.PI)
  geometry.applyMatrix4(new THREE.Matrix4().makeBasis(
    new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(0, 0, 1),
    new THREE.Vector3(1, 0, 0),
  ))
  if (axis === 'Y') geometry.rotateZ(-Math.PI / 2)
  if (axis === 'Z') geometry.rotateY(Math.PI / 2)
  return geometry
}

function barGeometry(mode: Mode, axis: Axis): THREE.BufferGeometry {
  if (mode === 'rotate') return ringBar(axis)
  // 拡大の軸線だけ 0.8 で止まり、その先に立方体のつまみが載る
  return straightBar(axis, mode === 'scale' ? 0.8 : 1)
}

function installBars(root: GizmoRoot): void {
  for (const mode of MODES) {
    const group = root.gizmo[mode]
    if (!group) continue
    for (const axis of AXES) {
      const bar = new THREE.Mesh(barGeometry(mode, axis), new THREE.MeshBasicMaterial({
        color: AXIS_COLORS[axis],
        depthTest: false,
        depthWrite: false,
        transparent: true,
        side: THREE.DoubleSide,
        fog: false,
        toneMapped: false,
      }))
      bar.name = axis
      bar.renderOrder = Infinity
      bar.visible = false
      bar.userData.hoverBar = true
      group.add(bar)
    }
  }
}

function highlight(root: GizmoRoot): void {
  const group = root.gizmo[root.mode]
  if (!group) return
  const axis = root.enabled ? root.axis : null
  for (const child of group.children) {
    const handle = child as Handle
    const hovered = axis !== null
      && (handle.name === axis || (handle.name.length === 1 && axis.includes(handle.name)))
    if (handle.userData.hoverBar === true) handle.visible = handle.visible && hovered
    const material = handle.material
    if (!material || !('opacity' in material)) continue
    if (hovered) {
      if (material.tempColor) material.color.copy(material.tempColor)
      material.opacity = 1
    } else if (axis !== null) {
      material.opacity = (material.tempOpacity ?? material.opacity) * IDLE_OPACITY
    }
  }
}
