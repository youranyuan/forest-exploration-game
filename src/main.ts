import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js'
import './style.css'
import { createHouse } from './houses'
import { houseLayout, houseTerrace, isHouseReserved } from './house-layout'
import { createFantasySky } from './sky'

// 场景是所有 3D 物体的容器。
const scene = new THREE.Scene()
// 天空和雾使用相近的浅蓝色，形成轻微空气透视而不是生硬的纯色背景。
scene.background = new THREE.Color(0xaedcf3)
scene.fog = new THREE.Fog(0xb9deee, 30, 62)

// 摄像机从玩家后上方观察场景：略高、略远的第三人称俯视角，仍能看清角色。
const camera = new THREE.PerspectiveCamera(64, window.innerWidth / window.innerHeight, 0.1, 1000)
const cameraOffset = new THREE.Vector3(0, 10.5, 13)
const cameraLookOffset = new THREE.Vector3(0, 0.9, -1.35)
const cameraLookTarget = new THREE.Vector3()
const desiredCameraPosition = new THREE.Vector3()
const desiredCameraLookTarget = new THREE.Vector3()
let cameraHasInitialPosition = false

// 渲染器把场景绘制到浏览器中的 canvas 元素。
const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFSoftShadowMap
renderer.outputColorSpace = THREE.SRGBColorSpace
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1.05
document.querySelector<HTMLDivElement>('#app')!.appendChild(renderer.domElement)

// 地面提供玩家移动的空间。
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(46, 46),
  new THREE.MeshStandardMaterial({ color: 0x547d57, roughness: 0.95 }),
)
ground.rotation.x = -Math.PI / 2
ground.receiveShadow = true
scene.add(ground)
// 原平面保留为逻辑参考，视觉上由下面的不规则浮岛顶面替代。
ground.visible = false

// 网格线保留方向提示，但降低对画面的干扰。
const grid = new THREE.GridHelper(46, 46, 0xd7f0cf, 0x7fa87d)
const gridMaterials = Array.isArray(grid.material) ? grid.material : [grid.material]
for (const material of gridMaterials) {
  material.transparent = true
  material.opacity = 0.22
}
scene.add(grid)
grid.visible = false

// 明亮边线让 30 × 30 的可玩区域更容易识别。
const border = new THREE.LineLoop(
  new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(-23, 0.03, -23),
    new THREE.Vector3(23, 0.03, -23),
    new THREE.Vector3(23, 0.03, 23),
    new THREE.Vector3(-23, 0.03, 23),
  ]),
  new THREE.LineBasicMaterial({ color: 0xe9f6d9 }),
)
scene.add(border)
border.visible = false

// 可玩范围扩展为约 46 × 46，并保持浮岛自然的非矩形边缘。
const islandOutline = [
  new THREE.Vector2(-23, -16), new THREE.Vector2(-19, -21),
  new THREE.Vector2(-11, -22), new THREE.Vector2(-2, -21),
  new THREE.Vector2(7, -22), new THREE.Vector2(16, -20),
  new THREE.Vector2(22, -15), new THREE.Vector2(21, -6),
  new THREE.Vector2(23, 3), new THREE.Vector2(21, 11),
  new THREE.Vector2(17, 18), new THREE.Vector2(9, 21),
  new THREE.Vector2(1, 20), new THREE.Vector2(-7, 22),
  new THREE.Vector2(-15, 20), new THREE.Vector2(-21, 15),
  new THREE.Vector2(-20, 8), new THREE.Vector2(-23, 1),
  new THREE.Vector2(-21, -8),
]

function isPointInsideIsland(x: number, z: number) {
  let inside = false
  for (let index = 0, previous = islandOutline.length - 1; index < islandOutline.length; previous = index, index += 1) {
    const currentPoint = islandOutline[index]
    const previousPoint = islandOutline[previous]
    const intersects = (currentPoint.y > z) !== (previousPoint.y > z)
      && x < ((previousPoint.x - currentPoint.x) * (z - currentPoint.y)) / (previousPoint.y - currentPoint.y) + currentPoint.x
    if (intersects) inside = !inside
  }
  return inside
}

function isInsidePlayableIsland(x: number, z: number) {
  // 给玩家锚点留出半个角色宽度，避免视觉上走出草地边缘。
  const edgePadding = 0.42
  return [
    [x, z], [x - edgePadding, z], [x + edgePadding, z],
    [x, z - edgePadding], [x, z + edgePadding],
  ].every(([testX, testZ]) => isPointInsideIsland(testX, testZ))
}

function createIslandShapeGeometry(scale = 1) {
  const shape = new THREE.Shape()
  islandOutline.forEach((point, index) => {
    // ShapeGeometry 在 XY 平面创建；翻转第二个坐标后旋转到 XZ 平面。
    if (index === 0) shape.moveTo(point.x * scale, -point.y * scale)
    else shape.lineTo(point.x * scale, -point.y * scale)
  })
  shape.closePath()
  const geometry = new THREE.ShapeGeometry(shape)
  geometry.rotateX(-Math.PI / 2)
  return geometry
}

function createGrassPatch(points: THREE.Vector2[], color: number) {
  const shape = new THREE.Shape()
  points.forEach((point, index) => {
    if (index === 0) shape.moveTo(point.x, -point.y)
    else shape.lineTo(point.x, -point.y)
  })
  shape.closePath()

  const geometry = new THREE.ShapeGeometry(shape)
  geometry.rotateX(-Math.PI / 2)
  const patch = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({ color, roughness: 1 }),
  )
  // 略微抬高，避免和草地顶面发生闪烁；它不参与任何碰撞。
  patch.position.y = 0.018
  patch.receiveShadow = true
  scene.add(patch)
}

function createGroundColorPatches() {
  // 这些独立色层未来可直接替换为 albedo / normal / roughness 贴图；当前保持轻量的低多边形表现。
  createGrassPatch([
    new THREE.Vector2(-14, -9), new THREE.Vector2(-9, -12),
    new THREE.Vector2(-4, -10), new THREE.Vector2(-6, -5),
    new THREE.Vector2(-12, -4),
  ], 0x4d8950)
  createGrassPatch([
    new THREE.Vector2(5, -12), new THREE.Vector2(12, -11),
    new THREE.Vector2(14, -5), new THREE.Vector2(10, -2),
    new THREE.Vector2(5, -5),
  ], 0x609d59)
  createGrassPatch([
    new THREE.Vector2(-13, 4), new THREE.Vector2(-9, 2),
    new THREE.Vector2(-5, 5), new THREE.Vector2(-6, 10),
    new THREE.Vector2(-12, 11), new THREE.Vector2(-14, 8),
  ], 0x568f53)
  createGrassPatch([
    new THREE.Vector2(5, 7), new THREE.Vector2(12, 6),
    new THREE.Vector2(13, 11), new THREE.Vector2(7, 14),
    new THREE.Vector2(2, 12),
  ], 0x669f5d)
  createGrassPatch([
    new THREE.Vector2(-2, -4), new THREE.Vector2(3, -5),
    new THREE.Vector2(5, -1), new THREE.Vector2(2, 2),
    new THREE.Vector2(-3, 1),
  ], 0x7ab66c)
  createGrassPatch([
    new THREE.Vector2(-8, -1), new THREE.Vector2(-4, -3),
    new THREE.Vector2(-1, -1), new THREE.Vector2(-2, 2),
    new THREE.Vector2(-6, 3),
  ], 0x628f4f)
  createGrassPatch([
    new THREE.Vector2(8, -2), new THREE.Vector2(12, -1),
    new THREE.Vector2(13, 3), new THREE.Vector2(10, 5),
    new THREE.Vector2(6, 3),
  ], 0x83ad62)
  createGrassPatch([
    new THREE.Vector2(-3, 7), new THREE.Vector2(1, 5),
    new THREE.Vector2(4, 7), new THREE.Vector2(3, 10),
    new THREE.Vector2(-1, 11),
  ], 0x739f57)
}

function createFloatingIsland() {
  const islandTop = new THREE.Mesh(
    createIslandShapeGeometry(),
    new THREE.MeshStandardMaterial({ color: 0x5a9759, roughness: 0.95 }),
  )
  islandTop.position.y = 0.004
  islandTop.receiveShadow = true
  scene.add(islandTop)

  // 较亮的内层草地让活动区域有层次，同时仍遵循岛屿的自然轮廓。
  const islandCenterGrass = new THREE.Mesh(
    createIslandShapeGeometry(0.77),
    new THREE.MeshStandardMaterial({ color: 0x74b268, roughness: 1 }),
  )
  islandCenterGrass.position.y = 0.012
  islandCenterGrass.receiveShadow = true
  scene.add(islandCenterGrass)

  createGroundColorPatches()

  // 三层轮廓向下逐渐缩小，组成完整连续的低多边形岩石岛体。
  const ringScales = [1, 0.78, 0.42]
  const ringHeights = [-0.03, -2.1, -5.1]
  const positions: number[] = []
  const indices: number[] = []
  for (let ring = 0; ring < ringScales.length; ring += 1) {
    for (const point of islandOutline) {
      positions.push(point.x * ringScales[ring], ringHeights[ring], point.y * ringScales[ring])
    }
  }

  const pointCount = islandOutline.length
  for (let ring = 0; ring < ringScales.length - 1; ring += 1) {
    for (let index = 0; index < pointCount; index += 1) {
      const next = (index + 1) % pointCount
      const topLeft = ring * pointCount + index
      const topRight = ring * pointCount + next
      const bottomLeft = (ring + 1) * pointCount + index
      const bottomRight = (ring + 1) * pointCount + next
      indices.push(topLeft, topRight, bottomLeft, topRight, bottomRight, bottomLeft)
    }
  }

  const bottomCenter = positions.length / 3
  positions.push(0, -6.1, 0)
  const bottomRing = (ringScales.length - 1) * pointCount
  for (let index = 0; index < pointCount; index += 1) {
    indices.push(bottomRing + index, bottomRing + (index + 1) % pointCount, bottomCenter)
  }

  const rockBodyGeometry = new THREE.BufferGeometry()
  rockBodyGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  rockBodyGeometry.setIndex(indices)
  rockBodyGeometry.computeVertexNormals()
  const rockBody = new THREE.Mesh(
    rockBodyGeometry,
    new THREE.MeshStandardMaterial({ color: 0x4f493f, roughness: 1, flatShading: true }),
  )
  rockBody.castShadow = true
  rockBody.receiveShadow = true
  scene.add(rockBody)
}

createFloatingIsland()

type PlatformDefinition = {
  x: number
  z: number
  width: number
  depth: number
  height: number
}

type RampDefinition = {
  x: number
  z: number
  width: number
  length: number
  height: number
  axis: 'x' | 'z'
}

// 高台和坡道定义集中管理。坡道的低端都朝向负轴，高端连接对应高台。
const terrainDefinitions: { platforms: PlatformDefinition[]; ramps: RampDefinition[] } = {
  platforms: [
    { x: -9, z: -6, width: 4, depth: 4, height: 1.4 },
    { x: 8, z: 6, width: 5, depth: 3.5, height: 1.8 },
    { x: -8, z: 8, width: 3.5, depth: 4, height: 1.1 },
    { x: 14, z: -9, width: 4.5, depth: 4.2, height: 1.5 },
    { x: -14, z: 9, width: 4.5, depth: 4, height: 1.7 },
    houseTerrace,
  ],
  ramps: [
    { x: -9, z: -9.25, width: 2.2, length: 2.5, height: 1.4, axis: 'z' },
    { x: 4.25, z: 6, width: 2.2, length: 2.5, height: 1.8, axis: 'x' },
    { x: -8, z: 5, width: 2, length: 2, height: 1.1, axis: 'z' },
    { x: 10.5, z: -9, width: 2.2, length: 2.5, height: 1.5, axis: 'x' },
    { x: -14, z: 5.75, width: 2.2, length: 2.5, height: 1.7, axis: 'z' },
  ],
}

const platformSideMaterial = new THREE.MeshStandardMaterial({ color: 0x806e56, roughness: 1 })
const platformTopMaterial = new THREE.MeshStandardMaterial({ color: 0x5d995e, roughness: 0.9 })
const rampMaterial = new THREE.MeshStandardMaterial({ color: 0x4f824e, roughness: 0.9 })

for (const platform of terrainDefinitions.platforms) {
  const bodyHeight = platform.height - 0.12
  const platformBody = new THREE.Mesh(
    new THREE.BoxGeometry(platform.width, bodyHeight, platform.depth),
    platformSideMaterial,
  )
  platformBody.position.set(platform.x, bodyHeight / 2, platform.z)
  platformBody.castShadow = true
  platformBody.receiveShadow = true
  scene.add(platformBody)

  const platformTop = new THREE.Mesh(
    new THREE.BoxGeometry(platform.width, 0.12, platform.depth),
    platformTopMaterial,
  )
  platformTop.position.set(platform.x, platform.height - 0.06, platform.z)
  platformTop.castShadow = true
  platformTop.receiveShadow = true
  scene.add(platformTop)
}

for (const ramp of terrainDefinitions.ramps) {
  const rampGeometry = ramp.axis === 'z'
    ? new THREE.BoxGeometry(ramp.width, 0.2, ramp.length)
    : new THREE.BoxGeometry(ramp.length, 0.2, ramp.width)
  const rampMesh = new THREE.Mesh(rampGeometry, rampMaterial)
  const rampAngle = Math.atan2(ramp.height, ramp.length)
  if (ramp.axis === 'z') rampMesh.rotation.x = -rampAngle
  else rampMesh.rotation.z = rampAngle
  rampMesh.position.set(ramp.x, ramp.height / 2 + 0.1, ramp.z)
  rampMesh.castShadow = true
  rampMesh.receiveShadow = true
  scene.add(rampMesh)
}

function getGroundHeightAt(x: number, z: number) {
  for (const ramp of terrainDefinitions.ramps) {
    const alongPosition = ramp.axis === 'x' ? x : z
    const acrossPosition = ramp.axis === 'x' ? z : x
    const alongCenter = ramp.axis === 'x' ? ramp.x : ramp.z
    const acrossCenter = ramp.axis === 'x' ? ramp.z : ramp.x
    const minimum = alongCenter - ramp.length / 2
    const maximum = alongCenter + ramp.length / 2

    if (alongPosition >= minimum && alongPosition <= maximum && Math.abs(acrossPosition - acrossCenter) <= ramp.width / 2) {
      return ((alongPosition - minimum) / ramp.length) * ramp.height
    }
  }

  for (const platform of terrainDefinitions.platforms) {
    if (Math.abs(x - platform.x) <= platform.width / 2 && Math.abs(z - platform.z) <= platform.depth / 2) {
      return platform.height
    }
  }

  return 0
}

// 这些视觉层不参与碰撞或高度判断，只让路线更容易区分。
const pathMaterials = [
  new THREE.MeshStandardMaterial({ color: 0xb79a69, roughness: 1 }),
  new THREE.MeshStandardMaterial({ color: 0xaa8d61, roughness: 1 }),
]

function createPath(points: THREE.Vector2[], width: number, materialIndex: number) {
  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index]
    const end = points[index + 1]
    const deltaX = end.x - start.x
    const deltaZ = end.y - start.y
    const length = Math.hypot(deltaX, deltaZ)
    const segment = new THREE.Mesh(
      new THREE.BoxGeometry(width, 0.025, length + 0.08),
      pathMaterials[(materialIndex + index) % pathMaterials.length],
    )
    const centerX = (start.x + end.x) / 2
    const centerZ = (start.y + end.y) / 2
    segment.position.set(centerX, getGroundHeightAt(centerX, centerZ) + 0.02, centerZ)
    segment.rotation.y = Math.atan2(deltaX, deltaZ)
    segment.receiveShadow = true
    scene.add(segment)
  }
}

function createTerrainVisualLayers() {
  // 三条分段路线分别引导玩家绕墙、前往右侧坡道与左上坡道。
  createPath([
    new THREE.Vector2(0, 0), new THREE.Vector2(-3.4, 0.2),
    new THREE.Vector2(-3.7, -2.5), new THREE.Vector2(-6, -3.5),
  ], 0.8, 0)
  createPath([
    new THREE.Vector2(0, 0), new THREE.Vector2(0, -2.5),
    new THREE.Vector2(3.5, -2.5), new THREE.Vector2(4, 1),
    new THREE.Vector2(3.2, 4.5),
  ], 0.85, 1)
  createPath([
    new THREE.Vector2(0, 0), new THREE.Vector2(-2, 1),
    new THREE.Vector2(-5.5, 1.4), new THREE.Vector2(-7, 3),
    new THREE.Vector2(-8, 4),
  ], 0.75, 0)
  createPath([
    new THREE.Vector2(3, -3), new THREE.Vector2(7, -5),
    new THREE.Vector2(10.2, -8), new THREE.Vector2(11.5, -9),
  ], 0.85, 1)
  createPath([
    new THREE.Vector2(-6, 4), new THREE.Vector2(-9, 5),
    new THREE.Vector2(-11, 6), new THREE.Vector2(-14, 5.2),
  ], 0.8, 0)
}

createTerrainVisualLayers()

function createPathDetail(points: THREE.Vector2[], color: number) {
  const shape = new THREE.Shape()
  points.forEach((point, index) => {
    if (index === 0) shape.moveTo(point.x, -point.y)
    else shape.lineTo(point.x, -point.y)
  })
  shape.closePath()
  const geometry = new THREE.ShapeGeometry(shape)
  geometry.rotateX(-Math.PI / 2)
  const detail = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({ color, roughness: 1 }),
  )
  detail.position.y = 0.036
  detail.receiveShadow = true
  scene.add(detail)
}

function createPathDetails() {
  // 少量不规则土色压痕打破道路的均匀感，仍然只是视觉层。
  createPathDetail([
    new THREE.Vector2(-1.5, -0.18), new THREE.Vector2(-0.4, -0.14),
    new THREE.Vector2(-0.55, 0.1), new THREE.Vector2(-1.65, 0.16),
  ], 0x9d8259)
  createPathDetail([
    new THREE.Vector2(-3.75, -1.9), new THREE.Vector2(-3.43, -1.1),
    new THREE.Vector2(-3.15, -1.2), new THREE.Vector2(-3.48, -2.05),
  ], 0xc4a878)
  createPathDetail([
    new THREE.Vector2(0.3, -1.9), new THREE.Vector2(1.4, -2.9),
    new THREE.Vector2(1.7, -2.66), new THREE.Vector2(0.65, -1.67),
  ], 0x987f58)
  createPathDetail([
    new THREE.Vector2(3.35, 1.15), new THREE.Vector2(3.72, 2.2),
    new THREE.Vector2(4.04, 2.1), new THREE.Vector2(3.67, 1.02),
  ], 0xc1a371)
  createPathDetail([
    new THREE.Vector2(-5.25, 1.32), new THREE.Vector2(-4.35, 1.16),
    new THREE.Vector2(-4.18, 1.47), new THREE.Vector2(-5.1, 1.67),
  ], 0x9f865e)
  createPathDetail([
    new THREE.Vector2(-7.28, 3.12), new THREE.Vector2(-6.65, 2.52),
    new THREE.Vector2(-6.4, 2.82), new THREE.Vector2(-7.05, 3.45),
  ], 0xc4a878)
}

createPathDetails()

// 石墙数据集中管理：横墙、竖墙和 L 形组合为金币制造绕行路线。
const obstacleDefinitions = [
  { x: 0, z: -1, width: 5.5, depth: 0.55, height: 1.2 },
  { x: 3, z: -0.2, width: 0.55, depth: 3.2, height: 1.45 },
  { x: -3, z: 2.3, width: 3.5, depth: 0.55, height: 1.15 },
  { x: -4.7, z: 3.7, width: 0.55, depth: 3.2, height: 1.35 },
  { x: 1.5, z: 3.7, width: 0.55, depth: 5, height: 1.4 },
  { x: 3.5, z: 9.5, width: 3.5, depth: 0.55, height: 1.1 },
  { x: -0.5, z: 8, width: 5, depth: 0.55, height: 1.25 },
]
const obstacleBoxes: THREE.Box3[] = []
const wallMaterial = new THREE.MeshStandardMaterial({ color: 0x726b61, roughness: 0.95 })

for (const definition of obstacleDefinitions) {
  const wall = new THREE.Mesh(
    new THREE.BoxGeometry(definition.width, definition.height, definition.depth),
    wallMaterial,
  )
  wall.position.set(definition.x, definition.height / 2, definition.z)
  wall.castShadow = true
  wall.receiveShadow = true
  scene.add(wall)
  obstacleBoxes.push(new THREE.Box3().setFromObject(wall))
  // 规则方块继续专门负责 AABB 碰撞；下面会用不规则岩石替换它的视觉外观。
  wall.visible = false
}

// 立方体保留为移动、收集和摄像机的逻辑锚点。
// GLB 成功加载后会隐藏它，改由 3D 角色作为可见玩家。
const player = new THREE.Mesh(
  new THREE.BoxGeometry(1, 1, 1),
  new THREE.MeshStandardMaterial({ color: 0x55aaff }),
)
const playerAnchorHeight = 0.5
player.position.y = playerAnchorHeight
player.castShadow = true
scene.add(player)
const initialPlayerPosition = player.position.clone()

let character: THREE.Object3D | null = null
let characterGroundOffset = 0
let animationMixer: THREE.AnimationMixer | null = null
let walkAction: THREE.AnimationAction | null = null
let isWalkAnimationPlaying = false

function updateCharacterPosition() {
  if (!character) return

  character.position.x = player.position.x
  character.position.y = player.position.y - playerAnchorHeight + characterGroundOffset
  character.position.z = player.position.z
}

const gltfLoader = new GLTFLoader()
gltfLoader.load(
  '/models/player.glb',
  (gltf) => {
    character = gltf.scene

    // 将不同来源模型统一调整为约 1.6 个场景单位高。
    const originalSize = new THREE.Box3().setFromObject(character).getSize(new THREE.Vector3())
    const targetCharacterHeight = 1.6
    const characterScale = originalSize.y > 0 ? targetCharacterHeight / originalSize.y : 1
    character.scale.setScalar(characterScale)

    // 缩放后重新计算包围盒，用最低点将角色脚底贴到 y = 0 的地面。
    const scaledBox = new THREE.Box3().setFromObject(character)
    characterGroundOffset = -scaledBox.min.y
    updateCharacterPosition()

    character.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.castShadow = true
        object.receiveShadow = true
      }
    })

    scene.add(character)
    player.visible = false
    console.info(`Player model loaded. Applied scale: ${characterScale}`)

    if (gltf.animations.length === 0) {
      console.warn('Player model loaded, but it does not contain any animations.')
      return
    }

    // 只有一个动画时直接使用；多个动画时优先选择名称包含 walk 的动画。
    const walkClip =
      gltf.animations.length === 1
        ? gltf.animations[0]
        : gltf.animations.find((clip) => /walk/i.test(clip.name)) ?? gltf.animations[0]

    animationMixer = new THREE.AnimationMixer(character)
    walkAction = animationMixer.clipAction(walkClip)
    walkAction.setLoop(THREE.LoopRepeat, Infinity)
    console.info(`Player walk animation ready: ${walkClip.name || '(unnamed)'}`)
  },
  undefined,
  (error) => {
    console.error('Could not load player model from /models/player.glb:', error)
  },
)

type AnimalPlacement = {
  x: number
  z: number
  scaleVariation: number
  rotationY: number
  area: string
}

type AnimalDefinition = {
  label: 'Deer' | 'Stag' | 'Fox' | 'Wolf'
  file: string
  targetHeight: number
  placements: AnimalPlacement[]
}

// 位置均为平坦草地，避开道路中心、水面、房屋入口与出生点。
const animalDefinitions: AnimalDefinition[] = [
  {
    label: 'Deer', file: 'Deer.gltf', targetHeight: 1.15,
    placements: [
      { x: -6, z: -0.5, scaleVariation: 1, rotationY: 0.75, area: '出生点西侧草地' },
      { x: 7, z: -6.5, scaleVariation: 0.96, rotationY: -0.6, area: '东南草地区域' },
    ],
  },
  {
    label: 'Stag', file: 'Stag.gltf', targetHeight: 1.38,
    placements: [
      { x: 11, z: 2, scaleVariation: 1, rotationY: -1.25, area: '东侧开阔草地' },
    ],
  },
  {
    label: 'Fox', file: 'Fox.gltf', targetHeight: 0.56,
    placements: [
      { x: -13, z: -2, scaleVariation: 0.96, rotationY: 1.05, area: '西侧树林边缘' },
      { x: 6, z: 12, scaleVariation: 1.04, rotationY: -2.1, area: '东北岩石草地' },
    ],
  },
  {
    label: 'Wolf', file: 'Wolf.gltf', targetHeight: 0.86,
    placements: [
      { x: 16, z: 4, scaleVariation: 1, rotationY: 2.4, area: '东部外围草地' },
    ],
  },
]

const animalMixers: THREE.AnimationMixer[] = []

function chooseIdleClip(animations: THREE.AnimationClip[]) {
  return animations.find((clip) => /^idle$/i.test(clip.name))
    ?? animations.find((clip) => /idle/i.test(clip.name))
    ?? animations[0]
}

function createAnimal(
  definition: AnimalDefinition,
  template: THREE.Object3D,
  animations: THREE.AnimationClip[],
  baseScale: number,
  placement: AnimalPlacement,
) {
  const animal = cloneSkinned(template)
  animal.scale.setScalar(baseScale * placement.scaleVariation)
  animal.rotation.y = placement.rotationY

  // 每一个实例在缩放、旋转后重新计算包围盒，再以最低点贴到当前地形表面。
  const animalBox = new THREE.Box3().setFromObject(animal)
  const groundHeight = getGroundHeightAt(placement.x, placement.z)
  animal.position.set(placement.x, groundHeight - animalBox.min.y, placement.z)
  animal.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      object.castShadow = true
      object.receiveShadow = true
    }
  })
  scene.add(animal)

  const mixer = new THREE.AnimationMixer(animal)
  const idleClip = chooseIdleClip(animations)
  if (idleClip) {
    const idleAction = mixer.clipAction(idleClip)
    idleAction.setLoop(THREE.LoopRepeat, Infinity).play()
    console.info(`${definition.label} idle animation playing: ${idleClip.name || '(unnamed)'}`)
  } else {
    console.warn(`${definition.label} model loaded, but it does not contain any animation clips.`)
  }
  animalMixers.push(mixer)

  const finalHeight = animalBox.getSize(new THREE.Vector3()).y
  console.info(`${definition.label} placed in ${placement.area}; final height: ${finalHeight}`)
}

function loadAnimalAsset(definition: AnimalDefinition) {
  gltfLoader.load(
    `/models/animals/${definition.file}`,
    (gltf) => {
      console.log(gltf.animations.map((animation) => animation.name))

      const originalHeight = new THREE.Box3().setFromObject(gltf.scene).getSize(new THREE.Vector3()).y
      const baseScale = originalHeight > 0 ? definition.targetHeight / originalHeight : 1
      definition.placements.forEach((placement) => {
        createAnimal(definition, gltf.scene, gltf.animations, baseScale, placement)
      })
      console.info(`${definition.label} model loaded once; created ${definition.placements.length} instance(s).`)
    },
    undefined,
    (error) => {
      console.error(`Could not load ${definition.label} model from /models/animals/${definition.file}:`, error)
    },
  )
}

animalDefinitions.forEach(loadAnimalAsset)

type CoinSpawnType = 'ground' | 'elevated' | 'route' | 'far'

type CoinSpawnPoint = {
  id: string
  type: CoinSpawnType
  x: number
  z: number
}

const coinsPerRound = 8

// 所有点都避开石墙、出生点与高台侧面；高台和坡道点复用 getGroundHeightAt() 放置。
const coinSpawnPoints: CoinSpawnPoint[] = [
  { id: 'ground-south-west', type: 'ground', x: -3, z: -2 },
  { id: 'ground-south-east', type: 'ground', x: 3, z: -3 },
  { id: 'ground-east', type: 'ground', x: 4, z: 3 },
  { id: 'ground-north-west', type: 'ground', x: -4, z: 4 },
  { id: 'ground-north', type: 'ground', x: 0, z: 6 },
  { id: 'ground-far-west', type: 'ground', x: -7, z: -1 },
  { id: 'elevated-south-west', type: 'elevated', x: -9, z: -6 },
  { id: 'elevated-south-west-east', type: 'elevated', x: -8, z: -5 },
  { id: 'elevated-east', type: 'elevated', x: 8, z: 6 },
  { id: 'elevated-east-north', type: 'elevated', x: 9, z: 5 },
  { id: 'elevated-north-west', type: 'elevated', x: -8, z: 8 },
  { id: 'route-south-west-ramp', type: 'route', x: -9, z: -9.2 },
  { id: 'route-east-ramp', type: 'route', x: 4.2, z: 6 },
  { id: 'route-north-west-ramp', type: 'route', x: -8, z: 5 },
  { id: 'route-south-east-detour', type: 'route', x: 2.7, z: -2.6 },
  { id: 'route-west-detour', type: 'route', x: -5.8, z: 1.5 },
  { id: 'far-ground-south', type: 'far', x: 6, z: -14 },
  { id: 'far-ground-east', type: 'far', x: 17, z: -3 },
  { id: 'far-ground-north-east', type: 'far', x: 14, z: 13 },
  { id: 'far-ground-north-west', type: 'far', x: -17, z: 14 },
  { id: 'far-ground-west', type: 'far', x: -18, z: -5 },
  { id: 'elevated-south-east', type: 'elevated', x: 14, z: -9 },
  { id: 'elevated-south-east-north', type: 'elevated', x: 15, z: -8 },
  { id: 'elevated-north-west-outer', type: 'elevated', x: -14, z: 9 },
  { id: 'elevated-north-west-outer-east', type: 'elevated', x: -13, z: 10 },
  { id: 'route-south-east-outer-ramp', type: 'route', x: 10.4, z: -9 },
  { id: 'route-north-west-outer-ramp', type: 'route', x: -14, z: 5.7 },
]

let activeCoinSpawnPoints: CoinSpawnPoint[] = []
const collectibles: THREE.Group[] = []
const collectibleBaseHeights = new Map<THREE.Group, number>()
const coinVisuals = new Map<THREE.Group, THREE.Object3D>()
const collectingCoins = new Set<THREE.Group>()

type CoinCollectEffect = {
  collectible: THREE.Group
  visual: THREE.Object3D | null
  originalScale: THREE.Vector3
  startPosition: THREE.Vector3
  apexPosition: THREE.Vector3
  elapsed: number
  duration: number
}

type CoinParticle = {
  mesh: THREE.Mesh
  material: THREE.MeshBasicMaterial
  velocity: THREE.Vector3
  elapsed: number
  duration: number
}

const coinCollectEffects: CoinCollectEffect[] = []
const coinParticles: CoinParticle[] = []
const particleGeometry = new THREE.SphereGeometry(0.07, 6, 6)
let coinTemplate: THREE.Object3D | null = null

function addCoinVisual(collectible: THREE.Group) {
  if (!coinTemplate) return

  const coin = coinTemplate.clone(true)
  const baseHeight = collectibleBaseHeights.get(collectible) ?? 0.5

  // 新模型默认平躺，绕 X 轴旋转 90° 后成为竖立的硬币。
  coin.rotation.x = Math.PI / 2

  // 旋转后重新计算包围盒，居中并让最低点悬浮在地面上方。
  const coinBox = new THREE.Box3().setFromObject(coin)
  const coinCenter = coinBox.getCenter(new THREE.Vector3())
  coin.position.x = -coinCenter.x
  const groundHeight = getGroundHeightAt(collectible.position.x, collectible.position.z)
  coin.position.y = groundHeight - coinBox.min.y - baseHeight + 0.12
  coin.position.z = -coinCenter.z
  coin.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      object.castShadow = true
      object.receiveShadow = true
    }
  })
  collectible.add(coin)
  coinVisuals.set(collectible, coin)
}

function chooseCoinSpawnPoints() {
  const selected: CoinSpawnPoint[] = []

  function chooseOne(type?: CoinSpawnType) {
    const candidates = coinSpawnPoints.filter((point) => !selected.includes(point) && (!type || point.type === type))
    const choice = candidates[Math.floor(Math.random() * candidates.length)]
    selected.push(choice)
  }

  // 固定配额保证每局都有平地、高台、路线与远区探索目标。
  chooseOne('ground')
  chooseOne('ground')
  chooseOne('ground')
  chooseOne('elevated')
  chooseOne('elevated')
  chooseOne('route')
  chooseOne('far')
  chooseOne()

  console.info('Coin spawn points for this round:', selected.map((point) => point.id))
  return selected
}

function spawnCoins() {
  activeCoinSpawnPoints = chooseCoinSpawnPoints()

  for (const spawnPoint of activeCoinSpawnPoints) {
    // Group 是收集判定和浮动动画的锚点，GLB 会在加载后附加到它上面。
    const collectible = new THREE.Group()
    collectible.position.set(spawnPoint.x, getGroundHeightAt(spawnPoint.x, spawnPoint.z) + playerAnchorHeight, spawnPoint.z)
    scene.add(collectible)
    collectibles.push(collectible)
    collectibleBaseHeights.set(collectible, collectible.position.y)
    addCoinVisual(collectible)
  }
}

function clearCollectibles() {
  clearCoinCollectEffects()
  collectibles.forEach((collectible) => scene.remove(collectible))
  collectibles.length = 0
  collectibleBaseHeights.clear()
  coinVisuals.clear()
}

spawnCoins()

const coinLoader = new GLTFLoader()
coinLoader.load(
  '/models/coin.glb',
  (gltf) => {
    coinTemplate = gltf.scene

    // 以模型最长边为基准，自动缩放为适合本场景的拾取物大小。
    const originalSize = new THREE.Box3().setFromObject(coinTemplate).getSize(new THREE.Vector3())
    const largestDimension = Math.max(originalSize.x, originalSize.y, originalSize.z)
    const targetCoinSize = 0.75
    const coinScale = largestDimension > 0 ? targetCoinSize / largestDimension : 1
    coinTemplate.scale.setScalar(coinScale)

    collectibles.forEach(addCoinVisual)

    console.info(`Coin model loaded. Applied scale: ${coinScale}`)
  },
  undefined,
  (error) => {
    console.error('Could not load coin model from /models/coin.glb:', error)
  },
)

type NatureGrassTestDefinition = {
  file: string
  label: string
  position: THREE.Vector2
  targetHeight: number
}

// 临时测试区：出生点南侧三列草簇，不加入碰撞或任何游戏状态。
const natureGrassTestDefinitions: NatureGrassTestDefinition[] = [
  { file: 'grass_leafs.glb', label: 'grass_leafs', position: new THREE.Vector2(0, -6), targetHeight: 0.5 },
  { file: 'grass_leafsLarge.glb', label: 'grass_leafsLarge', position: new THREE.Vector2(5, -6), targetHeight: 0.68 },
]

// 比主地面略深的自然草色，用于测试区内的轻微株间变化。
const natureGrassColors = [0x639957, 0x73a861, 0x819c55, 0x52864c].map((color) => new THREE.Color(color))

function recolorNatureGrassMaterials(root: THREE.Object3D, color: THREE.Color) {
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return

    const sourceMaterials = Array.isArray(object.material) ? object.material : [object.material]
    const clonedMaterials = sourceMaterials.map((material) => {
      const clonedMaterial = material.clone()
      if ('color' in clonedMaterial) {
        ;(clonedMaterial as THREE.MeshStandardMaterial).color.copy(color)
      }
      if (clonedMaterial instanceof THREE.MeshStandardMaterial) {
        clonedMaterial.roughness = 0.92
        clonedMaterial.metalness = 0
      }
      return clonedMaterial
    })
    object.material = Array.isArray(object.material) ? clonedMaterials : clonedMaterials[0]
  })
}

const natureGrassTemplates = new Map<string, { template: THREE.Object3D; scale: number }>()
const natureGrassMaterialVariants = new WeakMap<THREE.Material, THREE.Material[]>()
let natureGrassCoverageCreated = false

function applyNatureGrassMaterialVariant(root: THREE.Object3D, colorIndex: number) {
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return
    const sourceMaterials = Array.isArray(object.material) ? object.material : [object.material]
    const variants = sourceMaterials.map((sourceMaterial) => {
      let materialVariants = natureGrassMaterialVariants.get(sourceMaterial)
      if (!materialVariants) {
        materialVariants = natureGrassColors.map((color) => {
          const variant = sourceMaterial.clone()
          if ('color' in variant) (variant as THREE.MeshStandardMaterial).color.copy(color)
          if (variant instanceof THREE.MeshStandardMaterial) {
            variant.roughness = 0.92
            variant.metalness = 0
          }
          return variant
        })
        natureGrassMaterialVariants.set(sourceMaterial, materialVariants)
      }
      return materialVariants[colorIndex % materialVariants.length]
    })
    object.material = Array.isArray(object.material) ? variants : variants[0]
  })
}

function createNatureGrassCluster(x: number, z: number, modelName: string, count: number, colorOffset: number) {
  if (isHouseReserved(x, z, 1)) return
  const source = natureGrassTemplates.get(modelName)
  if (!source) return

  const cluster = new THREE.Group()
  cluster.position.set(x, getGroundHeightAt(x, z), z)
  for (let index = 0; index < count; index += 1) {
    const grass = source.template.clone(true)
    const scaleVariation = 0.72 + Math.random() * 0.42
    grass.scale.setScalar(source.scale * scaleVariation)
    grass.rotation.y = Math.random() * Math.PI * 2
    applyNatureGrassMaterialVariant(grass, colorOffset + index)

    const box = new THREE.Box3().setFromObject(grass)
    const center = box.getCenter(new THREE.Vector3())
    grass.position.set(
      -center.x + (Math.random() - 0.5) * 0.95,
      -box.min.y,
      -center.z + (Math.random() - 0.5) * 0.95,
    )
    grass.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        // 大量小草只接收阴影，避免为细小叶片生成昂贵且嘈杂的阴影贴图。
        object.castShadow = false
        object.receiveShadow = true
      }
    })
    cluster.add(grass)
  }
  scene.add(cluster)
}

function createNatureGrassCoverage() {
  if (natureGrassCoverageCreated || natureGrassTemplates.size !== natureGrassTestDefinitions.length) return
  natureGrassCoverageCreated = true

  // 大叶草靠近岩壁、水边和悬崖；较细草主要用于道路两侧和开放草地的边缘。
  const clusters: Array<[number, number, 'grass_leafs.glb' | 'grass_leafsLarge.glb', number]> = [
    [-11, -5, 'grass_leafsLarge.glb', 5], [-7, -5, 'grass_leafsLarge.glb', 4],
    [-10, -8, 'grass_leafs.glb', 4], [-7, -8, 'grass_leafs.glb', 3],
    [7, 7.5, 'grass_leafsLarge.glb', 5], [10, 7.4, 'grass_leafsLarge.glb', 4],
    [6.5, 4, 'grass_leafs.glb', 4], [11, 4, 'grass_leafs.glb', 3],
    [-10, 10, 'grass_leafsLarge.glb', 5], [-6.5, 10.5, 'grass_leafsLarge.glb', 4],
    [-6, 6, 'grass_leafs.glb', 3], [-11, 6, 'grass_leafs.glb', 3],
    [13, -7, 'grass_leafsLarge.glb', 5], [16, -10, 'grass_leafsLarge.glb', 5],
    [11, -11, 'grass_leafs.glb', 4], [17, -6, 'grass_leafs.glb', 3],
    [-16, 10, 'grass_leafsLarge.glb', 5], [-12, 12, 'grass_leafsLarge.glb', 4],
    [-16, 6, 'grass_leafs.glb', 3], [-12, 4, 'grass_leafs.glb', 3],
    [-18, -9, 'grass_leafsLarge.glb', 5], [-18, 8, 'grass_leafsLarge.glb', 4],
    [-11, 18, 'grass_leafsLarge.glb', 5], [9, 18, 'grass_leafsLarge.glb', 5],
    [19, -8, 'grass_leafsLarge.glb', 5], [19, 7, 'grass_leafsLarge.glb', 4],
    [-5, -3.8, 'grass_leafs.glb', 3], [-3.8, -2.4, 'grass_leafs.glb', 3],
    [1.2, -3.6, 'grass_leafs.glb', 3], [4.8, 1.5, 'grass_leafs.glb', 3],
    [-5.7, 2.6, 'grass_leafs.glb', 3], [-7, 3.8, 'grass_leafs.glb', 3],
    [-13, -13, 'grass_leafsLarge.glb', 4], [3, -16, 'grass_leafsLarge.glb', 4],
    [14, 13, 'grass_leafsLarge.glb', 4], [-17, 14, 'grass_leafsLarge.glb', 4],
  ]

  clusters.forEach(([x, z, model, count], index) => createNatureGrassCluster(x, z, model, count, index))
  const companionAreas = [
    [-11, -5], [8, 7.5], [-10, 10], [14, -7], [-16, 10],
    [-18, -9], [19, 7], [-5.7, 2.6], [9, 18],
  ]
  companionAreas.forEach(([x, z], index) => {
    createBush(x + 0.6, z + 0.35, index)
    createSmallRock(x - 0.45, z - 0.25, index)
    createFlower(x + 0.15, z - 0.55, index)
    createFlower(x - 0.35, z + 0.55, index + 1)
  })
  console.info(`Nature grass coverage created: ${clusters.length} clusters`)
}

function createNatureGrassTestCluster(definition: NatureGrassTestDefinition, template: THREE.Object3D, scale: number, colorOffset: number) {
  const cluster = new THREE.Group()
  const groundHeight = getGroundHeightAt(definition.position.x, definition.position.y)
  cluster.position.set(definition.position.x, groundHeight, definition.position.y)

  for (let index = 0; index < 4; index += 1) {
    const grass = template.clone(true)
    const variation = 0.84 + Math.random() * 0.25
    grass.scale.setScalar(scale * variation)
    grass.rotation.y = Math.random() * Math.PI * 2
    recolorNatureGrassMaterials(grass, natureGrassColors[(colorOffset + index) % natureGrassColors.length])

    // 每株各自根据缩放和旋转后的包围盒居中、贴地。
    const box = new THREE.Box3().setFromObject(grass)
    const center = box.getCenter(new THREE.Vector3())
    grass.position.set(
      -center.x + (Math.random() - 0.5) * 0.72,
      -box.min.y,
      -center.z + (Math.random() - 0.5) * 0.72,
    )
    grass.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.castShadow = false
        object.receiveShadow = true
      }
    })
    cluster.add(grass)
  }

  scene.add(cluster)
}

const natureGrassLoader = new GLTFLoader()
let natureGrassLoadsPending = natureGrassTestDefinitions.length
natureGrassTestDefinitions.forEach((definition) => {
  natureGrassLoader.load(
    `/models/nature/${definition.file}`,
    (gltf) => {
      const sourceSize = new THREE.Box3().setFromObject(gltf.scene).getSize(new THREE.Vector3())
      const sourceHeight = sourceSize.y > 0.001 ? sourceSize.y : Math.max(sourceSize.x, sourceSize.z)
      const scale = sourceHeight > 0 ? definition.targetHeight / sourceHeight : 1
      const definitionIndex = natureGrassTestDefinitions.indexOf(definition)
      createNatureGrassTestCluster(definition, gltf.scene, scale, definitionIndex)
      natureGrassTemplates.set(definition.file, { template: gltf.scene, scale })
      createNatureGrassCoverage()
      natureGrassLoadsPending -= 1
      generateHouses()
      console.info(`Nature grass test loaded: ${definition.file}, scale: ${scale}, target height: ${definition.targetHeight}`)
    },
    undefined,
    (error) => {
      console.error(`Could not load nature grass test model /models/nature/${definition.file}:`, error)
      natureGrassLoadsPending -= 1
      generateHouses()
    },
  )
})

type NatureTreeTestDefinition = {
  file: string
  label: string
  targetHeight: number
}

// 每种树仅加载一次。三种基准高度介于玩家高度的约 2～3 倍。
const natureTreeDefinitions: NatureTreeTestDefinition[] = [
  { file: 'tree_thin_dark.glb', label: 'thin pine', targetHeight: 3.2 },
  { file: 'tree_pineRoundD.glb', label: 'round pine', targetHeight: 3.8 },
  { file: 'tree_pineTallA_detailed.glb', label: 'tall pine', targetHeight: 4.4 },
]

type NatureTreeSource = { template: THREE.Object3D; scale: number }
type TreePlacement = { x: number; z: number; file: string; scale: number; castShadow: boolean }
type OccupiedArea = { x: number; z: number; radius: number; type: string }

const natureTreeSources = new Map<string, NatureTreeSource>()
const natureTreeGroup = new THREE.Group()
const treeMaterialVariants = new WeakMap<THREE.Material, THREE.Material[]>()
const occupiedAreas: OccupiedArea[] = []
let natureTreesCreated = false
scene.add(natureTreeGroup)

const treeLeafTints = [0x5c9255, 0x6d9d59, 0x789c55, 0x4e814e].map((color) => new THREE.Color(color))
const treeTrunkTint = new THREE.Color(0x745e45)

function registerOccupiedArea(x: number, z: number, radius: number, type: string) {
  occupiedAreas.push({ x, z, radius, type })
}

function clearOccupiedAreas(type: string) {
  for (let index = occupiedAreas.length - 1; index >= 0; index -= 1) {
    if (occupiedAreas[index].type === type) occupiedAreas.splice(index, 1)
  }
}

function isAreaFree(x: number, z: number, radius: number, safetyMargin = 0.22) {
  return occupiedAreas.every((area) => Math.hypot(x - area.x, z - area.z) >= radius + area.radius + safetyMargin)
}

// 静态石墙已经在树资源加载前创建；此处统一登记，让树系统也能避开它们。
obstacleDefinitions.forEach((wall) => {
  registerOccupiedArea(wall.x, wall.z, Math.hypot(wall.width, wall.depth) / 2, 'stone-wall')
})

function isTreeOnRamp(x: number, z: number, padding: number) {
  return terrainDefinitions.ramps.some((ramp) => {
    const along = ramp.axis === 'x' ? x : z
    const across = ramp.axis === 'x' ? z : x
    const centerAlong = ramp.axis === 'x' ? ramp.x : ramp.z
    const centerAcross = ramp.axis === 'x' ? ramp.z : ramp.x
    return Math.abs(along - centerAlong) <= ramp.length / 2 + padding
      && Math.abs(across - centerAcross) <= ramp.width / 2 + padding
  })
}

function isTreeClearOfPaths(x: number, z: number, padding: number) {
  const paths = [
    [new THREE.Vector2(0, 0), new THREE.Vector2(-3.4, 0.2), new THREE.Vector2(-3.7, -2.5), new THREE.Vector2(-6, -3.5)],
    [new THREE.Vector2(0, 0), new THREE.Vector2(0, -2.5), new THREE.Vector2(3.5, -2.5), new THREE.Vector2(4, 1), new THREE.Vector2(3.2, 4.5)],
    [new THREE.Vector2(0, 0), new THREE.Vector2(-2, 1), new THREE.Vector2(-5.5, 1.4), new THREE.Vector2(-7, 3), new THREE.Vector2(-8, 4)],
    [new THREE.Vector2(3, -3), new THREE.Vector2(7, -5), new THREE.Vector2(10.2, -8), new THREE.Vector2(11.5, -9)],
    [new THREE.Vector2(-6, 4), new THREE.Vector2(-9, 5), new THREE.Vector2(-11, 6), new THREE.Vector2(-14, 5.2)],
  ]
  const point = new THREE.Vector2(x, z)
  return paths.every((path) => path.slice(0, -1).every((start, index) => {
    const end = path[index + 1]
    const distance = new THREE.Line3(
      new THREE.Vector3(start.x, 0, start.y),
      new THREE.Vector3(end.x, 0, end.y),
    ).closestPointToPoint(new THREE.Vector3(point.x, 0, point.y), true, new THREE.Vector3()).distanceTo(new THREE.Vector3(point.x, 0, point.y))
    return distance >= padding
  }))
}

function hasTreeFootprintOnIsland(x: number, z: number, radius: number) {
  const samples = [
    [0, 0], [radius, 0], [-radius, 0], [0, radius], [0, -radius],
    [radius * 0.7, radius * 0.7], [-radius * 0.7, radius * 0.7],
    [radius * 0.7, -radius * 0.7], [-radius * 0.7, -radius * 0.7],
  ]
  return samples.every(([offsetX, offsetZ]) => isPointInsideIsland(x + offsetX, z + offsetZ))
}

function isValidTreePosition(x: number, z: number, footprintRadius = 1.25) {
  if (isHouseReserved(x, z, footprintRadius)) return false
  if (!hasTreeFootprintOnIsland(x, z, footprintRadius)) return false
  if (Math.hypot(x - initialPlayerPosition.x, z - initialPlayerPosition.z) < 5) return false
  if (isTreeOnRamp(x, z, footprintRadius)) return false
  if (!isTreeClearOfPaths(x, z, footprintRadius + 0.35)) return false

  // 高台顶部可以放树，但树干与根部必须完整落在平台内部；侧面和边缘不放置。
  for (const platform of terrainDefinitions.platforms) {
    const distanceX = Math.abs(x - platform.x)
    const distanceZ = Math.abs(z - platform.z)
    const nearPlatform = distanceX <= platform.width / 2 + footprintRadius && distanceZ <= platform.depth / 2 + footprintRadius
    const safelyOnPlatform = distanceX <= platform.width / 2 - footprintRadius && distanceZ <= platform.depth / 2 - footprintRadius
    if (nearPlatform && !safelyOnPlatform) return false
  }

  const point = new THREE.Vector3(x, 0.6, z)
  if ([...obstacleBoxes, ...layoutObstacleBoxes].some((box) => box.containsPoint(point))) return false
  // 地图重开时会切换预设墙体布局；也提前避开所有候选布局，避免下一局墙体压到已生成的树。
  if (wallLayouts.flat().some((wall) =>
    Math.hypot(x - wall.x, z - wall.z) < footprintRadius + Math.hypot(wall.width, wall.depth) / 2 + 0.22,
  )) return false
  if (coinSpawnPoints.some((point) => Math.hypot(x - point.x, z - point.z) < 2.25)) return false

  // 五个瀑布水池均在高台北侧，给水边留出更大的视觉安全距离。
  const waterAreas = [[-8.65, -3.8], [8.65, 7.95], [-8.45, 10.2], [14.55, -6.7], [-14.55, 11.2]]
  return waterAreas.every(([waterX, waterZ]) => Math.hypot(x - waterX, z - waterZ) >= 2.15)
}

function applyTreeMaterialVariant(root: THREE.Object3D, colorIndex: number) {
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return
    const sourceMaterials = Array.isArray(object.material) ? object.material : [object.material]
    const variants = sourceMaterials.map((sourceMaterial) => {
      let variantsForMaterial = treeMaterialVariants.get(sourceMaterial)
      if (!variantsForMaterial) {
        const isLeafMaterial = /leaf|foliage|crown|pine/i.test(`${sourceMaterial.name} ${object.name}`)
          || ('color' in sourceMaterial && (sourceMaterial as THREE.MeshStandardMaterial).color.g >= (sourceMaterial as THREE.MeshStandardMaterial).color.r)
        variantsForMaterial = treeLeafTints.map((tint) => {
          const material = sourceMaterial.clone()
          if ('color' in material) {
            const color = (material as THREE.MeshStandardMaterial).color
            color.lerp(isLeafMaterial ? tint : treeTrunkTint, isLeafMaterial ? 0.32 : 0.12)
          }
          if (material instanceof THREE.MeshStandardMaterial) {
            material.roughness = Math.max(material.roughness, 0.86)
            material.metalness = 0
          }
          return material
        })
        treeMaterialVariants.set(sourceMaterial, variantsForMaterial)
      }
      return variantsForMaterial[colorIndex % variantsForMaterial.length]
    })
    object.material = Array.isArray(object.material) ? variants : variants[0]
  })
}

function placeTreeOnTerrain(placement: TreePlacement, colorIndex: number) {
  const source = natureTreeSources.get(placement.file)
  if (!source) return false

  // 预设区域内最多尝试 16 次小幅偏移；不能安全落脚时宁可少一棵，也不产生穿模。
  for (let attempt = 0; attempt < 16; attempt += 1) {
    const angle = Math.random() * Math.PI * 2
    const distance = Math.sqrt(Math.random()) * 0.9
    const x = placement.x + Math.cos(angle) * distance
    const z = placement.z + Math.sin(angle) * distance
    const tree = source.template.clone(true)
    const naturalScale = placement.scale * (0.92 + Math.random() * 0.16)
    tree.scale.setScalar(source.scale * naturalScale)
    tree.rotation.y = Math.random() * Math.PI * 2
    applyTreeMaterialVariant(tree, colorIndex)

    const box = new THREE.Box3().setFromObject(tree)
    const size = box.getSize(new THREE.Vector3())
    const treeRadius = Math.hypot(size.x, size.z) / 2
    if (!isValidTreePosition(x, z, treeRadius) || !isAreaFree(x, z, treeRadius)) continue

    // 每棵树都先取得当前位置地形高度，再以缩放、旋转后的 Box3 最低点修正 Y。
    const center = box.getCenter(new THREE.Vector3())
    const terrainHeight = getGroundHeightAt(x, z)
    tree.position.set(x - center.x, terrainHeight - box.min.y, z - center.z)
    tree.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.castShadow = placement.castShadow
        object.receiveShadow = true
      }
    })
    natureTreeGroup.add(tree)
    registerOccupiedArea(x, z, treeRadius, 'nature-tree')
    return true
  }

  console.info(`Skipped tree at (${placement.x}, ${placement.z}): no free supported position found.`)
  return false
}

function createTreeCluster(placements: TreePlacement[], colorOffset: number) {
  placements.forEach((placement, index) => placeTreeOnTerrain(placement, colorOffset + index))
}

function generateTreesForLayout() {
  if (!housesReady || natureTreesCreated || natureTreeSources.size !== natureTreeDefinitions.length) return
  natureTreesCreated = true

  // 人工设计的边缘树群：外围更高更密，核心和道路旁保持开阔。
  const treeClusters: TreePlacement[][] = [
    [
      { x: -18, z: -14, file: 'tree_thin_dark.glb', scale: 0.96, castShadow: false },
      { x: -16, z: -15, file: 'tree_pineRoundD.glb', scale: 0.92, castShadow: true },
      { x: -19, z: -11, file: 'tree_pineTallA_detailed.glb', scale: 0.96, castShadow: true },
    ],
    [
      { x: 15, z: -16, file: 'tree_thin_dark.glb', scale: 0.92, castShadow: false },
      { x: 18, z: -14, file: 'tree_pineTallA_detailed.glb', scale: 1.02, castShadow: true },
      { x: 19, z: -11, file: 'tree_pineRoundD.glb', scale: 0.9, castShadow: true },
    ],
    [
      { x: -18, z: 7, file: 'tree_thin_dark.glb', scale: 0.9, castShadow: false },
      { x: -18, z: 10, file: 'tree_pineRoundD.glb', scale: 0.9, castShadow: true },
      { x: -19, z: 4, file: 'tree_pineTallA_detailed.glb', scale: 0.9, castShadow: false },
    ],
    [
      { x: -8, z: 18, file: 'tree_pineTallA_detailed.glb', scale: 0.94, castShadow: true },
      { x: -4, z: 18, file: 'tree_pineRoundD.glb', scale: 0.88, castShadow: false },
      { x: -11, z: 17, file: 'tree_thin_dark.glb', scale: 0.94, castShadow: true },
    ],
    [
      { x: 7, z: 17, file: 'tree_pineRoundD.glb', scale: 0.9, castShadow: true },
      { x: 10, z: 18, file: 'tree_pineTallA_detailed.glb', scale: 0.92, castShadow: false },
      { x: 13, z: 17, file: 'tree_thin_dark.glb', scale: 0.92, castShadow: true },
    ],
    [
      { x: 20, z: 3, file: 'tree_thin_dark.glb', scale: 0.9, castShadow: false },
      { x: 19, z: 7, file: 'tree_pineRoundD.glb', scale: 0.88, castShadow: true },
      { x: 17, z: 10, file: 'tree_pineTallA_detailed.glb', scale: 0.9, castShadow: false },
    ],
  ]

  treeClusters.forEach((cluster, index) => createTreeCluster(cluster, index))
  console.info(`Nature tree system created: ${natureTreeGroup.children.length} trees`)
}

natureTreeDefinitions.forEach((definition) => {
  gltfLoader.load(
    `/models/nature/${definition.file}`,
    (gltf) => {
      const sourceSize = new THREE.Box3().setFromObject(gltf.scene).getSize(new THREE.Vector3())
      const sourceHeight = sourceSize.y > 0.001 ? sourceSize.y : Math.max(sourceSize.x, sourceSize.z)
      const scale = sourceHeight > 0 ? definition.targetHeight / sourceHeight : 1
      natureTreeSources.set(definition.file, { template: gltf.scene, scale })
      console.info(`Nature tree asset loaded: ${definition.file}, base scale: ${scale}`)
      generateTreesForLayout()
    },
    undefined,
    (error) => {
      console.error(`Could not load nature tree model /models/nature/${definition.file}:`, error)
    },
  )
})

// 状态面板统一容纳文字和重开按钮，始终位于 Three.js canvas 上方。
const statusPanel = document.createElement('div')
statusPanel.className = 'status-panel'

const statusText = document.createElement('p')
statusText.className = 'status-text'

const restartButton = document.createElement('button')
restartButton.className = 'restart-button'
restartButton.type = 'button'
restartButton.textContent = '重新开始'

statusPanel.append(statusText, restartButton)
document.body.appendChild(statusPanel)

let collectedCount = 0
let allCoinsCollected = false

type HouseTrigger = {
  houseRole: string
  zone: THREE.Box3
}

const houseEnterTriggers: HouseTrigger[] = []
let activeHouseTrigger: HouseTrigger | null = null
let housePromptDismissed = false

function createHouseTrigger(definition: (typeof houseLayout)[number], groundHeight: number) {
  // 门位于房屋本地 +Z 方向；将它转换到世界坐标后，在门前留出约两名玩家宽的区域。
  const entranceDirection = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), definition.rotation)
  const triggerCenter = new THREE.Vector3(definition.x, groundHeight + 0.9, definition.z)
    .addScaledVector(entranceDirection, 2.25)
  const triggerSize = new THREE.Vector3(1.65, 1.8, 1.9)
  const zone = new THREE.Box3().setFromCenterAndSize(triggerCenter, triggerSize)

  return { houseRole: definition.role, zone }
}

// Enter 提示只创建一次，之后由房门触发区控制显示状态。
const housePrompt = document.createElement('section')
housePrompt.className = 'house-prompt'
housePrompt.hidden = true
housePrompt.setAttribute('aria-live', 'polite')

const housePromptTitle = document.createElement('p')
housePromptTitle.className = 'house-prompt-title'
housePromptTitle.textContent = 'Enter?'

const housePromptActions = document.createElement('div')
housePromptActions.className = 'house-prompt-actions'

const enterHouseButton = document.createElement('button')
enterHouseButton.type = 'button'
enterHouseButton.textContent = 'Yes'

const declineHouseButton = document.createElement('button')
declineHouseButton.type = 'button'
declineHouseButton.textContent = 'No'

housePromptActions.append(enterHouseButton, declineHouseButton)
housePrompt.append(housePromptTitle, housePromptActions)
document.body.appendChild(housePrompt)

function showEnterHousePrompt() {
  if (!housePromptDismissed) housePrompt.hidden = false
}

function hideEnterHousePrompt() {
  housePrompt.hidden = true
}

enterHouseButton.addEventListener('click', () => {
  console.log('Enter house confirmed')
  housePromptDismissed = true
  hideEnterHousePrompt()
})

declineHouseButton.addEventListener('click', () => {
  housePromptDismissed = true
  hideEnterHousePrompt()
})

function updateHouseTrigger() {
  const nextHouseTrigger = houseEnterTriggers.find((trigger) => trigger.zone.containsPoint(player.position)) ?? null

  if (!nextHouseTrigger) {
    activeHouseTrigger = null
    housePromptDismissed = false
    hideEnterHousePrompt()
    return
  }

  if (activeHouseTrigger?.houseRole !== nextHouseTrigger.houseRole) {
    activeHouseTrigger = nextHouseTrigger
    housePromptDismissed = false
    showEnterHousePrompt()
  }
}

function updateStatusText() {
  statusText.textContent = allCoinsCollected
    ? `All collected!\nCollected: ${collectedCount} / ${coinsPerRound}`
    : `Collected: ${collectedCount} / ${coinsPerRound}`
}

function restartGame() {
  clearCollectibles()
  resetMapLayout()
  spawnCoins()

  player.position.copy(initialPlayerPosition)
  character?.rotation.set(0, 0, 0)
  pressedKeys.clear()
  movementDirection.set(0, 0, 0)
  activeHouseTrigger = null
  housePromptDismissed = false
  hideEnterHousePrompt()
  collectedCount = 0
  allCoinsCollected = false

  // 下次移动时会重新从走路动画的开头播放。
  animationMixer?.stopAllAction()
  walkAction?.stop()
  isWalkAnimationPlaying = false
  clock.getDelta()

  updateCharacterPosition()
  updateStatusText()
}

restartButton.addEventListener('click', restartGame)

updateStatusText()

// 半球光模拟天空与草地的反射，太阳光从西南侧斜上方照下，制造柔和方向阴影。
scene.add(new THREE.HemisphereLight(0xcceaff, 0x71845f, 1.35))
scene.add(new THREE.AmbientLight(0xfff8eb, 0.16))

const directionalLight = new THREE.DirectionalLight(0xffefd2, 2.25)
directionalLight.position.set(-14, 18, 12)
directionalLight.castShadow = true
directionalLight.shadow.mapSize.set(2048, 2048)
directionalLight.shadow.camera.left = -17
directionalLight.shadow.camera.right = 17
directionalLight.shadow.camera.top = 17
directionalLight.shadow.camera.bottom = -17
directionalLight.shadow.camera.near = 0.5
directionalLight.shadow.camera.far = 55
directionalLight.shadow.bias = -0.00015
directionalLight.shadow.normalBias = 0.025
scene.add(directionalLight.target)
scene.add(directionalLight)

// 仅在地图边缘放置几棵低面数树和石头，避免挡住玩法区域。
const trunkMaterial = new THREE.MeshStandardMaterial({ color: 0x795548, roughness: 1 })
const foliageMaterial = new THREE.MeshStandardMaterial({ color: 0x2f7d4d, roughness: 0.9 })
const rockMaterial = new THREE.MeshStandardMaterial({ color: 0x8c9695, roughness: 1 })

function addTree(x: number, z: number) {
  if (isHouseReserved(x, z, 1.05)) return
  const tree = new THREE.Group()
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.23, 1.3, 8), trunkMaterial)
  trunk.position.y = 0.65
  const foliage = new THREE.Mesh(new THREE.ConeGeometry(0.9, 2.4, 8), foliageMaterial)
  foliage.position.y = 2
  tree.add(trunk, foliage)
  tree.position.set(x, 0, z)
  tree.traverse((object) => {
    if (object instanceof THREE.Mesh) object.castShadow = true
  })
  scene.add(tree)
  registerOccupiedArea(x, z, 1.05, 'existing-tree')
}

function addRock(x: number, z: number, scale: number) {
  if (isHouseReserved(x, z, 0.55 * scale)) return
  const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.55, 0), rockMaterial)
  rock.position.set(x, 0.35 * scale, z)
  rock.scale.setScalar(scale)
  rock.castShadow = true
  scene.add(rock)
  registerOccupiedArea(x, z, 0.55 * scale, 'large-rock')
}

addTree(-12.5, -12)
addTree(12.5, -12)
addTree(-12.5, 12)
addTree(12.5, 12)
addRock(-13, -3, 0.8)
addRock(13, 4, 1)
addRock(-4, 13, 0.7)
addRock(5, -13, 0.9)

// 以下装饰仅负责环境视觉，不加入 obstacleBoxes，也不参与地形或金币逻辑。
const bushMaterials = [
  new THREE.MeshStandardMaterial({ color: 0x356b3d, roughness: 1 }),
  new THREE.MeshStandardMaterial({ color: 0x477e45, roughness: 1 }),
  new THREE.MeshStandardMaterial({ color: 0x285934, roughness: 1 }),
]
const flowerMaterials = [
  new THREE.MeshBasicMaterial({ color: 0xffffff }),
  new THREE.MeshBasicMaterial({ color: 0xffdc4d }),
  new THREE.MeshBasicMaterial({ color: 0xff8faf }),
]
const grassMaterial = new THREE.MeshStandardMaterial({ color: 0x4f8d50, roughness: 1 })
const smallRockMaterials = [
  new THREE.MeshStandardMaterial({ color: 0x9a9588, roughness: 1 }),
  new THREE.MeshStandardMaterial({ color: 0x74766e, roughness: 1 }),
]
const bushGeometry = new THREE.DodecahedronGeometry(0.55, 0)
const flowerStemGeometry = new THREE.CylinderGeometry(0.018, 0.018, 0.32, 5)
const flowerHeadGeometry = new THREE.SphereGeometry(0.1, 6, 5)
const grassGeometry = new THREE.ConeGeometry(0.16, 0.65, 3)
const smallRockGeometry = new THREE.IcosahedronGeometry(0.34, 0)

// 这些材质和几何体只用于岩壁外观，不会加入 obstacleBoxes。
const formationRockMaterials = [
  new THREE.MeshStandardMaterial({ color: 0x766b5b, roughness: 1 }),
  new THREE.MeshStandardMaterial({ color: 0x807462, roughness: 1 }),
]
const formationGeometries = [
  new THREE.DodecahedronGeometry(0.5, 0),
  new THREE.BoxGeometry(1, 1, 1),
]
const mossMaterial = new THREE.MeshStandardMaterial({ color: 0x55764c, roughness: 1 })

function addFormationRock(
  group: THREE.Group,
  x: number,
  y: number,
  z: number,
  width: number,
  height: number,
  depth: number,
  index: number,
) {
  const rock = new THREE.Mesh(
    formationGeometries[index % formationGeometries.length],
    formationRockMaterials[index % formationRockMaterials.length],
  )
  rock.position.set(x, y, z)
  rock.scale.set(width, height, depth)
  rock.rotation.set(0.04 * ((index % 3) - 1), index * 0.35, 0.035 * ((index % 2) * 2 - 1))
  rock.castShadow = true
  rock.receiveShadow = true
  group.add(rock)

  // 每段岩壁只保留一小块苔藓，避免产生额外视觉噪音。
  if (index % 5 === 0) {
    const moss = new THREE.Mesh(new THREE.DodecahedronGeometry(0.2, 0), mossMaterial)
    moss.position.set(x, y + height * 0.48, z)
    moss.scale.set(1.4, 0.25, 0.9)
    moss.rotation.y = index * 0.5
    group.add(moss)
  }
}

function createRockFormation(definition: typeof obstacleDefinitions[number], formationIndex: number) {
  const formation = new THREE.Group()
  const alongX = definition.width >= definition.depth
  const length = alongX ? definition.width : definition.depth
  const thickness = alongX ? definition.depth : definition.width
  const coreHeight = definition.height * 0.7

  // 连续主体严格与隐藏碰撞盒同尺寸，消除“看得见却能穿过”的区域。
  const core = new THREE.Mesh(
    new THREE.BoxGeometry(definition.width, coreHeight, definition.depth),
    formationRockMaterials[formationIndex % formationRockMaterials.length],
  )
  core.position.set(definition.x, coreHeight / 2, definition.z)
  core.castShadow = true
  core.receiveShadow = true
  formation.add(core)

  // 只在连续主体顶部加入 2～3 块相互贴合的低多边形岩体，制造自然起伏。
  const rockCount = Math.min(3, Math.max(2, Math.ceil(length / 3)))
  const sectionLength = length / rockCount

  for (let index = 0; index < rockCount; index += 1) {
    const along = -length / 2 + (index + 0.5) * (length / rockCount)
    const sideOffset = ((index % 2) * 2 - 1) * thickness * 0.04
    const heightScale = definition.height * (0.3 + (index % 2) * 0.05)
    const x = definition.x + (alongX ? along : sideOffset)
    const z = definition.z + (alongX ? sideOffset : along)

    addFormationRock(
      formation,
      x,
      coreHeight + heightScale * 0.42,
      z,
      alongX ? sectionLength * 0.98 : thickness * 0.88,
      heightScale,
      alongX ? thickness * 0.88 : sectionLength * 0.98,
      formationIndex + index,
    )
  }

  scene.add(formation)
  registerOccupiedArea(definition.x, definition.z, Math.hypot(definition.width, definition.depth) / 2 + 0.2, 'rock-formation')
}

type CliffSide = 'north' | 'south' | 'east' | 'west'

function createCliffSection(platform: PlatformDefinition, side: CliffSide, sectionIndex: number) {
  const cliff = new THREE.Group()
  const runsAlongX = side === 'north' || side === 'south'
  const length = runsAlongX ? platform.width : platform.depth
  const coreHeight = platform.height * 0.7
  const sideThickness = 0.34
  const outward = side === 'east' || side === 'north' ? 0.12 : -0.12
  const core = new THREE.Mesh(
    runsAlongX
      ? new THREE.BoxGeometry(length, coreHeight, sideThickness)
      : new THREE.BoxGeometry(sideThickness, coreHeight, length),
    formationRockMaterials[sectionIndex % formationRockMaterials.length],
  )
  core.position.set(
    platform.x + (runsAlongX ? 0 : (side === 'east' ? platform.width / 2 + outward : -platform.width / 2 + outward)),
    coreHeight / 2,
    platform.z + (runsAlongX ? (side === 'north' ? platform.depth / 2 + outward : -platform.depth / 2 + outward) : 0),
  )
  core.castShadow = true
  core.receiveShadow = true
  cliff.add(core)

  // 高台边缘同样以连续岩壁为主，仅用 2～3 个小起伏打破平直轮廓。
  const rockCount = Math.min(3, Math.max(2, Math.ceil(length / 2.5)))
  const sectionLength = length / rockCount

  for (let index = 0; index < rockCount; index += 1) {
    const along = -length / 2 + (index + 0.5) * (length / rockCount)
    const x = platform.x + (runsAlongX ? along : (side === 'east' ? platform.width / 2 + outward : -platform.width / 2 + outward))
    const z = platform.z + (runsAlongX ? (side === 'north' ? platform.depth / 2 + outward : -platform.depth / 2 + outward) : along)
    const heightScale = platform.height * (0.28 + (index % 2) * 0.05)

    addFormationRock(
      cliff,
      x,
      coreHeight + heightScale * 0.4,
      z,
      runsAlongX ? sectionLength * 0.96 : sideThickness,
      heightScale,
      runsAlongX ? sideThickness : sectionLength * 0.96,
      sectionIndex + index,
    )
  }

  scene.add(cliff)
  registerOccupiedArea(
    core.position.x,
    core.position.z,
    Math.hypot(runsAlongX ? length : sideThickness, runsAlongX ? sideThickness : length) / 2 + 0.16,
    'cliff-section',
  )
}

// 灌木有明显的横向体积；不能只检查它的中心点是否还在岛上。
// 对靠近悬崖的摆放点，沿着通向岛内的方向小幅回退，确保整丛植物
// 都有草地承托，而不是一半悬在空中。
function getSupportedBushPosition(x: number, z: number) {
  const footprintRadius = 1.05
  const hasSupport = (testX: number, testZ: number) => {
    const samples = [
      [0, 0], [footprintRadius, 0], [-footprintRadius, 0],
      [0, footprintRadius], [0, -footprintRadius],
      [footprintRadius * 0.7, footprintRadius * 0.7],
      [-footprintRadius * 0.7, footprintRadius * 0.7],
      [footprintRadius * 0.7, -footprintRadius * 0.7],
      [-footprintRadius * 0.7, -footprintRadius * 0.7],
    ]
    return samples.every(([offsetX, offsetZ]) => isPointInsideIsland(testX + offsetX, testZ + offsetZ))
  }

  if (hasSupport(x, z)) return new THREE.Vector2(x, z)

  const towardIsland = new THREE.Vector2(-x, -z)
  if (towardIsland.lengthSq() === 0) return new THREE.Vector2(x, z)
  towardIsland.normalize()

  for (let distance = 0.45; distance <= 4; distance += 0.45) {
    const candidateX = x + towardIsland.x * distance
    const candidateZ = z + towardIsland.y * distance
    if (hasSupport(candidateX, candidateZ)) return new THREE.Vector2(candidateX, candidateZ)
  }

  // 所有预定义摆放点都应能在上面找到安全位置；这条回退保证极端情况也不把灌木放出岛外。
  return new THREE.Vector2(x + towardIsland.x * 4, z + towardIsland.y * 4)
}

function createBush(x: number, z: number, colorIndex: number) {
  const supportedPosition = getSupportedBushPosition(x, z)
  if (isHouseReserved(supportedPosition.x, supportedPosition.y, 1.05)) return
  const bush = new THREE.Group()
  const material = bushMaterials[colorIndex % bushMaterials.length]
  for (const [offsetX, offsetZ, size] of [[-0.28, 0.05, 0.85], [0.24, -0.12, 1.05]] as const) {
    const clump = new THREE.Mesh(bushGeometry, material)
    clump.position.set(offsetX, 0.42 * size, offsetZ)
    clump.scale.setScalar(size)
    clump.castShadow = true
    bush.add(clump)
  }
  bush.position.set(
    supportedPosition.x,
    getGroundHeightAt(supportedPosition.x, supportedPosition.y),
    supportedPosition.y,
  )
  bush.rotation.y = Math.random() * Math.PI * 2
  const bushScale = 0.8 + Math.random() * 0.35
  bush.scale.setScalar(bushScale)
  scene.add(bush)
  registerOccupiedArea(supportedPosition.x, supportedPosition.y, 0.72 * bushScale, 'large-bush')
}

function createFlower(x: number, z: number, colorIndex: number) {
  if (isHouseReserved(x, z, 0.15)) return
  const flower = new THREE.Group()
  const stem = new THREE.Mesh(flowerStemGeometry, grassMaterial)
  stem.position.y = 0.16
  const head = new THREE.Mesh(flowerHeadGeometry, flowerMaterials[colorIndex % flowerMaterials.length])
  head.position.y = 0.35
  flower.add(stem, head)
  flower.position.set(x, getGroundHeightAt(x, z), z)
  flower.rotation.y = Math.random() * Math.PI * 2
  flower.scale.setScalar(0.75 + Math.random() * 0.35)
  scene.add(flower)
}

function createGrassCluster(x: number, z: number) {
  if (isHouseReserved(x, z, 0.25)) return
  const grass = new THREE.Mesh(grassGeometry, grassMaterial)
  grass.position.set(x, getGroundHeightAt(x, z) + 0.32, z)
  grass.rotation.y = Math.random() * Math.PI * 2
  grass.scale.set(0.7 + Math.random() * 0.45, 0.7 + Math.random() * 0.45, 0.7 + Math.random() * 0.45)
  scene.add(grass)
}

function createSmallRock(x: number, z: number, materialIndex: number) {
  if (isHouseReserved(x, z, 0.4)) return
  const rock = new THREE.Mesh(smallRockGeometry, smallRockMaterials[materialIndex % smallRockMaterials.length])
  const scale = 0.55 + Math.random() * 0.6
  rock.position.set(x, getGroundHeightAt(x, z) + 0.18 * scale, z)
  rock.rotation.set(Math.random() * 0.5, Math.random() * Math.PI, Math.random() * 0.5)
  rock.scale.setScalar(scale)
  rock.castShadow = true
  scene.add(rock)
  registerOccupiedArea(x, z, 0.34 * scale, 'small-rock')
}

// 每道墙以数块错落岩石表现；AABB 碰撞仍只使用上方已创建的隐藏方块。
obstacleDefinitions.forEach((definition, index) => createRockFormation(definition, index * 2))

// 每个高台都避开对应坡道所在的南侧或西侧，只修饰其余侧面。
createCliffSection(terrainDefinitions.platforms[0], 'north', 10)
createCliffSection(terrainDefinitions.platforms[0], 'east', 13)
createCliffSection(terrainDefinitions.platforms[0], 'west', 16)
createCliffSection(terrainDefinitions.platforms[1], 'north', 19)
createCliffSection(terrainDefinitions.platforms[1], 'south', 22)
createCliffSection(terrainDefinitions.platforms[1], 'east', 25)
createCliffSection(terrainDefinitions.platforms[2], 'north', 28)
createCliffSection(terrainDefinitions.platforms[2], 'east', 31)
createCliffSection(terrainDefinitions.platforms[2], 'west', 34)
createCliffSection(terrainDefinitions.platforms[3], 'north', 37)
// 东南平台东侧现在连接院台，连接处不再放竖立岩壁。
createCliffSection(houseTerrace, 'east', 40)
createCliffSection(terrainDefinitions.platforms[3], 'south', 43)
createCliffSection(terrainDefinitions.platforms[4], 'north', 46)
createCliffSection(terrainDefinitions.platforms[4], 'east', 49)
createCliffSection(terrainDefinitions.platforms[4], 'west', 52)

function createEnvironmentDecorations() {
  const bushPositions = [
    [-13, -9], [-13, -5], [-12, 0], [-12, 5], [-12, 10], [-5, 12],
    [6, 12], [12, -9], [12, -5], [12, 0], [12, 5], [12, 9],
    [-19, -8], [-19, 6], [-15, 16], [16, -14], [19, -2], [17, 14],
  ]
  const flowerPositions = [
    [-11, -3], [-10, -1], [-11, 2], [-10, 4], [-12, 7], [-10, 11],
    [-5, 11], [-2, 11], [1, 11], [4, 11], [7, 11], [10, 10],
    [-17, -10], [-18, 10], [15, -12], [18, 8],
    [11, 7], [11, 3], [11, -1], [10, -4], [8, -8], [5, -10],
    [1, -11], [-3, -11], [-6, -10], [-10, -8], [-12, -6], [-7, 12],
  ]
  const grassPositions = [
    [-14, -7], [-14, -2], [-14, 3], [-14, 8], [-11, -11], [-8, -12],
    [-4, -12], [0, -12], [4, -12], [8, -11], [11, -7], [13, -3],
    [13, 2], [13, 7], [10, 12], [4, 13], [0, 13], [-4, 13],
    [-20, -4], [-20, 4], [-12, 18], [12, 18], [20, -8], [20, 5],
    [-10, 12], [-11, 8], [-6, 3], [-5.8, 0.7], [-1, 9.5], [2.5, 10.5],
    [6, 9], [10, 8.5], [9, 1], [-11, -4],
  ]
  const smallRockPositions = [
    [-13, -11], [-12, -1], [-11, 6], [-9, 11], [-2, 12],
    [3, 12], [9, 12], [13, 8], [13, -6], [7, -12],
  ]

  bushPositions.forEach(([x, z], index) => createBush(x, z, index))
  flowerPositions.forEach(([x, z], index) => createFlower(x, z, index))
  grassPositions.forEach(([x, z]) => createGrassCluster(x, z))
  smallRockPositions.forEach(([x, z], index) => createSmallRock(x, z, index))
}

createEnvironmentDecorations()

// 扩展地图的远端边缘采用成组点缀，保持通路中央干净；这些对象不参与碰撞。
function createExpandedEdgeDecorations() {
  const edgeTrees = [
    [-19, -13], [-20, 9], [-13, 17], [15, -16], [20, 8], [13, 17],
  ]
  const edgeBushes = [
    [-20, -10], [-18, -4], [-20, 3], [-18, 13], [-8, 19],
    [4, 18], [12, 18], [19, 12], [20, -4], [18, -13],
  ]
  const edgeRocks = [
    [-18, -15], [-21, -2], [-17, 16], [-4, 20],
    [9, 19], [19, 4], [20, -11], [11, -18],
  ]
  const edgeFlowers = [
    [-19, -7], [-20, 6], [-15, 18], [-2, 19], [8, 18], [18, 11], [19, -8],
  ]
  const edgeGrass = [
    [-20, -12], [-20, 0], [-19, 11], [-10, 19], [0, 19], [10, 18], [20, 9], [20, -1], [17, -16],
  ]

  edgeTrees.forEach(([x, z]) => addTree(x, z))
  edgeBushes.forEach(([x, z], index) => createBush(x, z, index))
  edgeRocks.forEach(([x, z], index) => createSmallRock(x, z, index))
  edgeFlowers.forEach(([x, z], index) => createFlower(x, z, index))
  edgeGrass.forEach(([x, z]) => createGrassCluster(x, z))
}

createExpandedEdgeDecorations()

type LayoutWall = { x: number; z: number; width: number; depth: number; height: number }

// 两套人工设计的外围墙体布局：不占用出生区、不压住坡道，也不会切断主路线。
const wallLayouts: LayoutWall[][] = [
  [
    { x: 13, z: -2, width: 3.2, depth: 0.55, height: 1.1 },
    { x: -15.5, z: 1, width: 0.55, depth: 3.4, height: 1.2 },
    { x: 4, z: 14, width: 4, depth: 0.55, height: 1.05 },
  ],
  [
    { x: 7, z: -14, width: 0.55, depth: 3.4, height: 1.15 },
    { x: -17, z: 12, width: 3.2, depth: 0.55, height: 1.1 },
    { x: 16, z: 9, width: 0.55, depth: 3.2, height: 1.2 },
  ],
]
const layoutObstacleGroup = new THREE.Group()
const layoutObstacleBoxes: THREE.Box3[] = []
scene.add(layoutObstacleGroup)

function resetMapLayout() {
  layoutObstacleGroup.clear()
  layoutObstacleBoxes.length = 0
  clearOccupiedAreas('layout-wall')
  const layoutIndex = Math.floor(Math.random() * wallLayouts.length)

  for (const definition of wallLayouts[layoutIndex]) {
    const wall = new THREE.Mesh(
      new THREE.BoxGeometry(definition.width, definition.height, definition.depth),
      new THREE.MeshStandardMaterial({ color: 0x766b5b, roughness: 1 }),
    )
    wall.position.set(definition.x, definition.height / 2, definition.z)
    wall.castShadow = true
    wall.receiveShadow = true
    layoutObstacleGroup.add(wall)
    layoutObstacleBoxes.push(new THREE.Box3().setFromObject(wall))
    registerOccupiedArea(definition.x, definition.z, Math.hypot(definition.width, definition.depth) / 2, 'layout-wall')
  }

  console.info(`Map layout selected: wallLayout${layoutIndex === 0 ? 'A' : 'B'}`)
}

resetMapLayout()

type WaterfallEdge = 'north' | 'south' | 'east' | 'west'

type WaterfallDefinition = {
  platformIndex: number
  edge: WaterfallEdge
  offset: number
  width: number
  poolDepth: number
  bottomY: number
  name: string
}

type WaterfallFlowStrip = {
  mesh: THREE.Mesh
  material: THREE.MeshBasicMaterial
  geometry: THREE.PlaneGeometry
  basePositions: Float32Array
  topY: number
  fallHeight: number
  phase: number
}

type WaterfallSurface = {
  material: THREE.MeshBasicMaterial
  phase: number
  baseOpacity: number
}

type WaterfallSplash = {
  mesh: THREE.Mesh
  material: THREE.MeshBasicMaterial
  phase: number
}

const waterfallFlowStrips: WaterfallFlowStrip[] = []
const waterfallSurfaces: WaterfallSurface[] = []
const waterfallSplashes: WaterfallSplash[] = []

function getWaterfallEdgePosition(platform: PlatformDefinition, edge: WaterfallEdge, offset: number) {
  if (edge === 'east') return new THREE.Vector3(platform.x + platform.width / 2 + 0.2, platform.height, platform.z + offset)
  if (edge === 'west') return new THREE.Vector3(platform.x - platform.width / 2 - 0.2, platform.height, platform.z + offset)
  if (edge === 'north') return new THREE.Vector3(platform.x + offset, platform.height, platform.z + platform.depth / 2 + 0.2)
  return new THREE.Vector3(platform.x + offset, platform.height, platform.z - platform.depth / 2 - 0.2)
}

function getWaterfallOutwardDirection(edge: WaterfallEdge) {
  if (edge === 'east') return new THREE.Vector3(1, 0, 0)
  if (edge === 'west') return new THREE.Vector3(-1, 0, 0)
  if (edge === 'north') return new THREE.Vector3(0, 0, 1)
  return new THREE.Vector3(0, 0, -1)
}

function createWaterPool(
  edgePosition: THREE.Vector3,
  outward: THREE.Vector3,
  edge: WaterfallEdge,
  width: number,
  depth: number,
) {
  const poolCenter = edgePosition.clone().addScaledVector(outward, -depth / 2)
  poolCenter.y += 0.035
  const poolGeometry = edge === 'east' || edge === 'west'
    ? new THREE.PlaneGeometry(depth, width)
    : new THREE.PlaneGeometry(width, depth)
  const poolMaterial = new THREE.MeshBasicMaterial({
    color: 0x63d6ea,
    transparent: true,
    opacity: 0.72,
    side: THREE.DoubleSide,
    depthWrite: false,
  })
  const pool = new THREE.Mesh(poolGeometry, poolMaterial)
  pool.rotation.x = -Math.PI / 2
  pool.position.copy(poolCenter)
  scene.add(pool)
  waterfallSurfaces.push({ material: poolMaterial, phase: Math.random() * Math.PI * 2, baseOpacity: 0.72 })

  // 一条更浅的水面高光连接小水池与悬崖边缘。
  const highlight = new THREE.Mesh(
    new THREE.PlaneGeometry(depth * 0.72, width * 0.18),
    new THREE.MeshBasicMaterial({
      color: 0xd7ffff,
      transparent: true,
      opacity: 0.5,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  )
  highlight.rotation.x = -Math.PI / 2
  highlight.position.copy(poolCenter).add(new THREE.Vector3(0, 0.006, 0))
  if (edge === 'north' || edge === 'south') highlight.rotation.z = Math.PI / 2
  scene.add(highlight)
  waterfallSurfaces.push({ material: highlight.material as THREE.MeshBasicMaterial, phase: Math.random() * Math.PI * 2, baseOpacity: 0.5 })
}

function createWaterfall(definition: WaterfallDefinition) {
  const platform = terrainDefinitions.platforms[definition.platformIndex]
  const edgePosition = getWaterfallEdgePosition(platform, definition.edge, definition.offset)
  const outward = getWaterfallOutwardDirection(definition.edge)
  const topY = platform.height + 0.04
  const fallHeight = topY - definition.bottomY
  const centerY = topY - fallHeight / 2
  const isSideEdge = definition.edge === 'east' || definition.edge === 'west'

  createWaterPool(edgePosition, outward, definition.edge, definition.width, definition.poolDepth)

  // 两层较淡的水幕提供体积感；白色细条在 updateWaterfalls 中循环向下移动。
  const sheetColors = [0x54c7e3, 0x91e7f2]
  const sheetOpacities = [0.42, 0.26]
  for (let index = 0; index < sheetColors.length; index += 1) {
    const sheet = new THREE.Mesh(
      new THREE.PlaneGeometry(definition.width * (1 - index * 0.12), fallHeight),
      new THREE.MeshBasicMaterial({
        color: sheetColors[index],
        transparent: true,
        opacity: sheetOpacities[index],
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    )
    if (isSideEdge) sheet.rotation.y = Math.PI / 2
    sheet.position.copy(edgePosition).addScaledVector(outward, 0.05 + index * 0.045)
    sheet.position.y = centerY
    scene.add(sheet)
    waterfallSurfaces.push({ material: sheet.material as THREE.MeshBasicMaterial, phase: index * 1.7, baseOpacity: sheetOpacities[index] })
  }

  for (let index = 0; index < 4; index += 1) {
    const stripGeometry = new THREE.PlaneGeometry(definition.width * 0.13, fallHeight * 0.52, 1, 8)
    const strip = new THREE.Mesh(
      stripGeometry,
      new THREE.MeshBasicMaterial({
        color: 0xe5ffff,
        transparent: true,
        opacity: 0.58,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    )
    if (isSideEdge) strip.rotation.y = Math.PI / 2
    strip.position.copy(edgePosition).addScaledVector(outward, 0.12)
    strip.position.y = topY - fallHeight * (0.14 + index * 0.2)
    const lateralOffset = (index - 1.5) * definition.width * 0.22
    if (isSideEdge) strip.position.z += lateralOffset
    else strip.position.x += lateralOffset
    scene.add(strip)
    waterfallFlowStrips.push({
      mesh: strip,
      material: strip.material as THREE.MeshBasicMaterial,
      geometry: stripGeometry,
      basePositions: new Float32Array(stripGeometry.attributes.position.array),
      topY,
      fallHeight,
      phase: index / 4,
    })
  }

  // 瀑布末端用少量水花圆片柔化截断感；最外侧瀑布会直接落向浮岛下方。
  const splashPosition = edgePosition.clone().addScaledVector(outward, 0.16)
  splashPosition.y = definition.bottomY + 0.035
  for (let index = 0; index < 2; index += 1) {
    const splash = new THREE.Mesh(
      new THREE.CircleGeometry(definition.width * (0.32 + index * 0.13), 10),
      new THREE.MeshBasicMaterial({
        color: index === 0 ? 0xe8ffff : 0x81dced,
        transparent: true,
        opacity: 0.55 - index * 0.16,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    )
    splash.rotation.x = -Math.PI / 2
    splash.position.copy(splashPosition).addScaledVector(outward, index * 0.04)
    scene.add(splash)
    waterfallSplashes.push({ mesh: splash, material: splash.material as THREE.MeshBasicMaterial, phase: index * 1.8 })
  }

  console.info(`Waterfall created: ${definition.name}`)
}

function createWaterfallsForTerrain() {
  // 默认镜头位于玩家北侧，因此三个瀑布均放在各高台的北侧；同时避开西南和西北高台的南侧坡道，以及东侧高台的西侧坡道。
  const waterfallDefinitions: WaterfallDefinition[] = [
    { platformIndex: 0, edge: 'north', offset: 0.35, width: 1.15, poolDepth: 0.72, bottomY: 0.08, name: 'south-west platform north fall' },
    { platformIndex: 1, edge: 'north', offset: 0.65, width: 1.2, poolDepth: 0.78, bottomY: 0.08, name: 'east platform north fall' },
    { platformIndex: 2, edge: 'north', offset: -0.45, width: 1.0, poolDepth: 0.66, bottomY: 0.08, name: 'north-west platform side fall' },
    { platformIndex: 3, edge: 'north', offset: 0.55, width: 1.1, poolDepth: 0.7, bottomY: 0.08, name: 'outer south-east platform north fall' },
    { platformIndex: 4, edge: 'north', offset: -0.55, width: 1.1, poolDepth: 0.7, bottomY: 0.08, name: 'outer north-west platform north fall' },
  ]
  waterfallDefinitions.forEach(createWaterfall)
}

function updateWaterfalls(deltaTime: number, elapsedTime: number) {
  waterfallSurfaces.forEach((surface) => {
    surface.material.opacity = surface.baseOpacity + Math.sin(elapsedTime * 1.8 + surface.phase) * 0.06
  })

  waterfallFlowStrips.forEach((strip) => {
    strip.phase = (strip.phase + deltaTime * 0.62) % 1
    strip.mesh.position.y = strip.topY - strip.phase * strip.fallHeight
    strip.material.opacity = 0.3 + Math.sin((strip.phase + 0.15) * Math.PI) * 0.32
    // 高光水流在局部横向轻微摆动，避免看起来像笔直的透明玻璃片。
    const positions = strip.geometry.attributes.position
    for (let index = 0; index < positions.count; index += 1) {
      const baseX = strip.basePositions[index * 3]
      const baseY = strip.basePositions[index * 3 + 1]
      positions.setX(index, baseX + Math.sin(elapsedTime * 6 + baseY * 9 + strip.phase * 8) * 0.035)
    }
    positions.needsUpdate = true
  })

  waterfallSplashes.forEach((splash) => {
    const pulse = 1 + Math.sin(elapsedTime * 4 + splash.phase) * 0.16
    splash.mesh.scale.setScalar(pulse)
    splash.material.opacity = 0.32 + Math.sin(elapsedTime * 4 + splash.phase) * 0.12
  })
}

createWaterfallsForTerrain()

type GrassZone = {
  x: number
  z: number
  count: number
  spread: number
}

function createGrassSystem() {
  const grassZones: GrassZone[] = [
    // 地图与浮岛边缘：较密的自然草丛。
    { x: -13, z: -8, count: 5, spread: 1.2 }, { x: -13, z: -2, count: 5, spread: 1.1 },
    { x: -12, z: 4, count: 5, spread: 1.2 }, { x: -10, z: 11, count: 5, spread: 1.2 },
    { x: -3, z: 12.5, count: 4, spread: 1.1 }, { x: 5, z: 12.5, count: 4, spread: 1.1 },
    { x: 12, z: 8, count: 5, spread: 1.2 }, { x: 12, z: -5, count: 5, spread: 1.2 },
    { x: -19, z: -8, count: 5, spread: 1.2 }, { x: -18, z: 9, count: 5, spread: 1.2 },
    { x: -11, z: 18, count: 5, spread: 1.2 }, { x: 12, z: 18, count: 5, spread: 1.2 },
    { x: 19, z: -9, count: 5, spread: 1.2 }, { x: 20, z: 6, count: 5, spread: 1.2 },
    // 高台、悬崖与瀑布附近：颜色更深、分布更集中。
    { x: -10.5, z: -5, count: 4, spread: 0.65 }, { x: -7, z: -7, count: 4, spread: 0.65 },
    { x: 7.2, z: 7.7, count: 4, spread: 0.65 }, { x: 10, z: 7.7, count: 4, spread: 0.65 },
    { x: -9.8, z: 10, count: 4, spread: 0.65 }, { x: -6.5, z: 10, count: 4, spread: 0.65 },
    { x: 13, z: -7, count: 4, spread: 0.65 }, { x: 16, z: -10, count: 4, spread: 0.65 },
    { x: -16, z: 10, count: 4, spread: 0.65 }, { x: -12, z: 11, count: 4, spread: 0.65 },
    { x: -9.6, z: -4.1, count: 3, spread: 0.45 }, { x: 8.6, z: 7.6, count: 3, spread: 0.45 },
    { x: -8.4, z: 9.8, count: 3, spread: 0.45 },
    // 道路侧边：仅少量点缀，避免主通路看起来杂乱。
    { x: -2, z: 0.8, count: 3, spread: 0.4 }, { x: -4.5, z: -2.3, count: 3, spread: 0.4 },
    { x: 1, z: -3.3, count: 3, spread: 0.4 }, { x: 4.5, z: 1.5, count: 3, spread: 0.4 },
    { x: -5.7, z: 2.3, count: 3, spread: 0.4 }, { x: -7, z: 4, count: 3, spread: 0.4 },
  ]

  const clusterCount = grassZones.reduce((total, zone) => total + zone.count, 0)
  const bladesPerCluster = 3
  const bladeCount = clusterCount * bladesPerCluster
  const bladeGeometry = new THREE.PlaneGeometry(0.15, 0.62, 1, 2)
  bladeGeometry.translate(0, 0.31, 0)
  const grassMaterials = [
    new THREE.MeshBasicMaterial({ color: 0x397a42, side: THREE.DoubleSide }),
    new THREE.MeshBasicMaterial({ color: 0x4e954c, side: THREE.DoubleSide }),
    new THREE.MeshBasicMaterial({ color: 0x709e4e, side: THREE.DoubleSide }),
  ]
  const grassMeshes = Array.from(
    { length: bladesPerCluster },
    (_, index) => new THREE.InstancedMesh(bladeGeometry, grassMaterials[index], clusterCount),
  )
  const transform = new THREE.Object3D()
  let clusterIndex = 0

  for (const zone of grassZones) {
    for (let index = 0; index < zone.count; index += 1) {
      const angle = Math.random() * Math.PI * 2
      const distance = Math.sqrt(Math.random()) * zone.spread
      const x = zone.x + Math.cos(angle) * distance
      const z = zone.z + Math.sin(angle) * distance
      const groundHeight = getGroundHeightAt(x, z)

      for (let bladeIndex = 0; bladeIndex < bladesPerCluster; bladeIndex += 1) {
        const bladeAngle = bladeIndex * (Math.PI / bladesPerCluster) + Math.random() * 0.45
        transform.position.set(
          x + (Math.random() - 0.5) * 0.16,
          groundHeight,
          z + (Math.random() - 0.5) * 0.16,
        )
        transform.rotation.set(
          (Math.random() - 0.5) * 0.12,
          bladeAngle,
          (Math.random() - 0.5) * 0.12,
        )
        const height = 0.68 + Math.random() * 0.68
        const width = 0.72 + Math.random() * 0.5
        transform.scale.set(width, height, 1)
        if (isHouseReserved(x, z, 0.3)) transform.scale.setScalar(0)
        transform.updateMatrix()
        grassMeshes[bladeIndex].setMatrixAt(clusterIndex, transform.matrix)
      }
      clusterIndex += 1
    }
  }

  grassMeshes.forEach((mesh) => {
    mesh.instanceMatrix.needsUpdate = true
    mesh.receiveShadow = true
    scene.add(mesh)
  })

  console.info(`Grass system created: ${clusterCount} clusters, ${bladeCount} instanced blades`)
}

function createWetAreaDetails() {
  const wetMossMaterial = new THREE.MeshStandardMaterial({ color: 0x3f7a52, roughness: 1 })
  const wetMossPositions = [
    [-9.55, -4.45], [-8.1, -4.25],
    [8.1, 7.4], [9.7, 7.25],
    [-9.3, 9.85], [-7.25, 10.05],
  ]

  wetMossPositions.forEach(([x, z], index) => {
    const moss = new THREE.Mesh(new THREE.CircleGeometry(0.22 + (index % 2) * 0.08, 7), wetMossMaterial)
    moss.rotation.x = -Math.PI / 2
    moss.position.set(x, getGroundHeightAt(x, z) + 0.022, z)
    moss.scale.set(1.4, 0.75, 1)
    moss.rotation.z = index * 0.55
    scene.add(moss)
  })
}

createGrassSystem()
createWetAreaDetails()

// pressedKeys 记录当前正在按住的按键，动画循环据此持续移动玩家。
const pressedKeys = new Set<string>()
const movementKeys = new Set(['KeyW', 'ArrowUp', 'KeyS', 'ArrowDown', 'KeyA', 'ArrowLeft', 'KeyD', 'ArrowRight'])
const movementDirection = new THREE.Vector3()

window.addEventListener('keydown', (event) => {
  if (movementKeys.has(event.code)) {
    event.preventDefault()
    pressedKeys.add(event.code)
  }
})

window.addEventListener('keyup', (event) => {
  pressedKeys.delete(event.code)
})

// 切换标签页时清空按键状态，避免返回页面后玩家继续移动。
window.addEventListener('blur', () => pressedKeys.clear())

function movePlayer(deltaTime: number) {
  movementDirection.set(0, 0, 0)

  if (pressedKeys.has('KeyW') || pressedKeys.has('ArrowUp')) movementDirection.z -= 1
  if (pressedKeys.has('KeyS') || pressedKeys.has('ArrowDown')) movementDirection.z += 1
  if (pressedKeys.has('KeyA') || pressedKeys.has('ArrowLeft')) movementDirection.x -= 1
  if (pressedKeys.has('KeyD') || pressedKeys.has('ArrowRight')) movementDirection.x += 1

  // 对角线移动时先归一化，保证速度不会变快。
  if (movementDirection.lengthSq() > 0) {
    const playerSpeed = 6
    movementDirection.normalize().multiplyScalar(playerSpeed * deltaTime)

    // 分轴检测：一侧被墙挡住时，仍可沿另一侧方向滑动。
    const nextX = player.position.x + movementDirection.x
    if (canMovePlayerTo(nextX, player.position.z)) player.position.x = nextX

    const nextZ = player.position.z + movementDirection.z
    if (canMovePlayerTo(player.position.x, nextZ)) player.position.z = nextZ
  }

  updatePlayerHeight()
}

function canMovePlayerTo(x: number, z: number) {
  const currentGroundHeight = player.position.y - playerAnchorHeight
  const nextGroundHeight = getGroundHeightAt(x, z)

  // 高台侧面高度突变视为障碍；坡道区域的连续高度变化可以正常通过。
  if (Math.abs(nextGroundHeight - currentGroundHeight) > 0.5) return false
  return !isPlayerPositionBlocked(x, z)
}

function updatePlayerHeight() {
  player.position.y = getGroundHeightAt(player.position.x, player.position.z) + playerAnchorHeight
}

function isPlayerPositionBlocked(x: number, z: number) {
  // 浮岛轮廓也是统一碰撞系统的一部分：走到草地边缘前就会被阻挡。
  if (!isInsidePlayableIsland(x, z)) return true

  const playerBounds = new THREE.Box3().setFromCenterAndSize(
    new THREE.Vector3(x, getGroundHeightAt(x, z) + playerAnchorHeight, z),
    new THREE.Vector3(0.72, 1, 0.72),
  )
  return [...obstacleBoxes, ...layoutObstacleBoxes].some((obstacleBox) => playerBounds.intersectsBox(obstacleBox))
}

function updateCharacterAnimation(deltaTime: number) {
  const isMoving = movementDirection.lengthSq() > 0

  if (character && isMoving) {
    // W 对应 -Z 方向；根据实际移动向量计算角色应面向的角度。
    const targetRotation = Math.atan2(movementDirection.x, movementDirection.z)
    const angleDifference = Math.atan2(
      Math.sin(targetRotation - character.rotation.y),
      Math.cos(targetRotation - character.rotation.y),
    )
    character.rotation.y += angleDifference * Math.min(1, deltaTime * 10)
  }

  if (walkAction) {
    if (isMoving && !isWalkAnimationPlaying) {
      walkAction.reset().fadeIn(0.15).play()
      isWalkAnimationPlaying = true
    } else if (!isMoving && isWalkAnimationPlaying) {
      walkAction.fadeOut(0.15)
      isWalkAnimationPlaying = false
    }
  }

  animationMixer?.update(deltaTime)
}

function animateCollectibles(elapsedTime: number, deltaTime: number) {
  collectibles.forEach((collectible, index) => {
    if (collectingCoins.has(collectible)) return

    const baseHeight = collectibleBaseHeights.get(collectible) ?? 0.5
    // 只向上浮动，保证铜钱最低点不会穿过地面。
    collectible.position.y = baseHeight + (Math.sin(elapsedTime * 2 + index * 1.5) + 1) * 0.06

    // 铜钱始终用圆形正面朝向玩家，同时绕自身正面法线缓慢旋转。
    collectible.lookAt(player.position.x, collectible.position.y, player.position.z)
    coinVisuals.get(collectible)?.rotateY(deltaTime * 1.2)
  })
}

function startCoinCollectAnimation(collectible: THREE.Group) {
  const visual = coinVisuals.get(collectible) ?? null
  const startPosition = new THREE.Vector3()

  if (visual) {
    scene.updateMatrixWorld(true)
    visual.getWorldPosition(startPosition)
    // 飞行阶段改由场景根节点控制，保持金币当前世界位置不跳动。
    scene.attach(visual)
  } else {
    collectible.getWorldPosition(startPosition)
  }

  coinCollectEffects.push({
    collectible,
    visual,
    originalScale: visual?.scale.clone() ?? new THREE.Vector3(1, 1, 1),
    startPosition,
    apexPosition: startPosition.clone().add(new THREE.Vector3(0, 0.9, 0)),
    elapsed: 0,
    duration: 0.8,
  })
}

function createCoinArrivalParticles(origin: THREE.Vector3) {
  for (let index = 0; index < 8; index += 1) {
    const angle = (Math.PI * 2 * index) / 8 + Math.random() * 0.3
    const speed = 1.3 + Math.random() * 0.8
    const material = new THREE.MeshBasicMaterial({
      color: 0xffd447,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
    })
    const particle = new THREE.Mesh(particleGeometry, material)
    particle.position.copy(origin)
    scene.add(particle)
    coinParticles.push({
      mesh: particle,
      material,
      velocity: new THREE.Vector3(Math.cos(angle) * speed, 1 + Math.random() * 0.8, Math.sin(angle) * speed),
      elapsed: 0,
      duration: 0.55,
    })
  }
}

function updateCoinCollectEffects(deltaTime: number) {
  for (let index = coinCollectEffects.length - 1; index >= 0; index -= 1) {
    const effect = coinCollectEffects[index]
    effect.elapsed += deltaTime
    const progress = Math.min(effect.elapsed / effect.duration, 1)

    if (effect.visual) {
      if (progress < 0.2) {
        // 前 20% 快速上抛，使用缓出曲线制造弹起感。
        const jumpProgress = progress / 0.2
        const easedJump = 1 - (1 - jumpProgress) * (1 - jumpProgress)
        effect.visual.position.lerpVectors(effect.startPosition, effect.apexPosition, easedJump)
      } else {
        // 后 80% 使用每帧更新的玩家位置作为终点，沿带侧向弧度的二次贝塞尔曲线飞行。
        const flightProgress = (progress - 0.2) / 0.8
        const target = player.position.clone().add(new THREE.Vector3(0, 1.1, 0))
        const control = effect.apexPosition.clone().lerp(target, 0.5)
        const flightDirection = target.clone().sub(effect.apexPosition)
        const sideOffset = new THREE.Vector3(flightDirection.z, 0, -flightDirection.x)
        if (sideOffset.lengthSq() > 0) sideOffset.normalize().multiplyScalar(0.35)
        control.add(sideOffset)
        control.y += 0.6

        const inverseProgress = 1 - flightProgress
        effect.visual.position
          .copy(effect.apexPosition)
          .multiplyScalar(inverseProgress * inverseProgress)
          .addScaledVector(control, 2 * inverseProgress * flightProgress)
          .addScaledVector(target, flightProgress * flightProgress)
      }

      effect.visual.scale.copy(effect.originalScale)
      effect.visual.rotateY(deltaTime * 14)
    }

    if (progress === 1) {
      const arrivalPosition = effect.visual?.position.clone() ?? player.position.clone().add(new THREE.Vector3(0, 1.1, 0))
      createCoinArrivalParticles(arrivalPosition)
      if (effect.visual) scene.remove(effect.visual)
      scene.remove(effect.collectible)
      const collectibleIndex = collectibles.indexOf(effect.collectible)
      if (collectibleIndex !== -1) collectibles.splice(collectibleIndex, 1)
      collectibleBaseHeights.delete(effect.collectible)
      coinVisuals.delete(effect.collectible)
      collectingCoins.delete(effect.collectible)
      coinCollectEffects.splice(index, 1)
    }
  }
}

function updateCoinParticles(deltaTime: number) {
  for (let index = coinParticles.length - 1; index >= 0; index -= 1) {
    const particle = coinParticles[index]
    particle.elapsed += deltaTime
    const progress = Math.min(particle.elapsed / particle.duration, 1)
    particle.mesh.position.addScaledVector(particle.velocity, deltaTime)
    particle.velocity.y += 0.8 * deltaTime
    particle.mesh.scale.setScalar(Math.max(1 - progress, 0.001))
    particle.material.opacity = 1 - progress

    if (progress === 1) {
      scene.remove(particle.mesh)
      particle.material.dispose()
      coinParticles.splice(index, 1)
    }
  }
}

function clearCoinCollectEffects() {
  coinCollectEffects.forEach((effect) => {
    if (effect.visual) scene.remove(effect.visual)
  })
  coinCollectEffects.length = 0
  collectingCoins.clear()
  coinParticles.forEach((particle) => {
    scene.remove(particle.mesh)
    particle.material.dispose()
  })
  coinParticles.length = 0
}

function updateCamera(deltaTime: number) {
  desiredCameraPosition.copy(player.position).add(cameraOffset)
  // 观察点略微前移并抬高：保留角色主体，同时为前方道路和高台留出更多画面。
  desiredCameraLookTarget.copy(player.position).add(cameraLookOffset)

  if (!cameraHasInitialPosition) {
    camera.position.copy(desiredCameraPosition)
    cameraLookTarget.copy(desiredCameraLookTarget)
    cameraHasInitialPosition = true
  }

  const followAmount = 1 - Math.exp(-7 * deltaTime)
  camera.position.lerp(desiredCameraPosition, followAmount)
  cameraLookTarget.lerp(desiredCameraLookTarget, followAmount)
  camera.lookAt(cameraLookTarget)
}

function collectNearbyItems() {
  const collectionDistance = 0.9
  let collectedAnItem = false

  // 倒序遍历，这样移除数组中的已收集物时不会跳过下一个物品。
  for (let index = collectibles.length - 1; index >= 0; index -= 1) {
    const collectible = collectibles[index]

    if (!collectingCoins.has(collectible) && player.position.distanceTo(collectible.position) < collectionDistance) {
      collectingCoins.add(collectible)
      startCoinCollectAnimation(collectible)
      collectedCount += 1
      collectedAnItem = true
    }
  }

  if (collectedCount === coinsPerRound) {
    allCoinsCollected = true
  }

  if (collectedAnItem) updateStatusText()
}

// 窗口尺寸改变时，同步更新摄像机和渲染器。
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(window.innerWidth, window.innerHeight)
})

const clock = new THREE.Clock()
const gameElapsedClock = new THREE.Clock()

// 等待异步草地附属灌木完成登记后选房址，随后树木也会避开这些房子。
let housesReady = false
function generateHouses() {
  if (housesReady || natureGrassLoadsPending > 0) return
  const placements: Array<{ role: string; x: number; z: number; height: number }> = []
  houseLayout.forEach((definition) => {
    const { x, z, variant } = definition
    const house = createHouse(variant)
    house.rotation.y = definition.rotation
    const bounds = new THREE.Box3().setFromObject(house)
    const groundHeight = getGroundHeightAt(x, z)
    // 检查实际世界包围盒覆盖的四角、四边及内部网格，不只检查中心。
    const supported = [0, 0.25, 0.5, 0.75, 1].every((u) => [0, 0.25, 0.5, 0.75, 1].every((v) => {
      const px = x + THREE.MathUtils.lerp(bounds.min.x, bounds.max.x, u)
      const pz = z + THREE.MathUtils.lerp(bounds.min.z, bounds.max.z, v)
      return isPointInsideIsland(px, pz) && Math.abs(getGroundHeightAt(px, pz) - groundHeight) < 0.01
    }))
    if (!supported) throw new Error(`房址缺少水平承托：${definition.role}`)
    house.position.set(x, groundHeight - bounds.min.y, z)
    scene.add(house)
    registerOccupiedArea(x, z, 2.6, 'house')
    const entrance = new THREE.Vector3(0, 0, 2.5).applyAxisAngle(new THREE.Vector3(0, 1, 0), definition.rotation)
    registerOccupiedArea(x + entrance.x, z + entrance.z, 1.0, 'house-entrance')
    houseEnterTriggers.push(createHouseTrigger(definition, groundHeight))
    // 沿用现有 AABB 检查，阻挡建筑主体；花圃周围仍可绕行。
    const body = new THREE.Box3(new THREE.Vector3(-1.28, 0, -1.13), new THREE.Vector3(1.28, variant === 2 ? 3.45 : 2.05, 1.13))
    house.updateMatrixWorld(true)
    obstacleBoxes.push(body.applyMatrix4(house.matrixWorld))
    placements.push({ role: definition.role, x, z, height: groundHeight })
  })
  // 中心房门与原道路相连；远处房屋保留一条穿过草地的短支路。
  createPath([new THREE.Vector2(-3.7, -2.5), new THREE.Vector2(-3.7, -3.2), new THREE.Vector2(-3, -4)], 0.65, 0)
  createPath([new THREE.Vector2(-5, 12), new THREE.Vector2(-5.3, 14), new THREE.Vector2(-6, 15.5)], 0.7, 1)
  housesReady = true
  console.info('House placements:', placements)
  console.info('House enter triggers created for:', houseEnterTriggers.map((trigger) => trigger.houseRole))
  generateTreesForLayout()
}

const fantasySky = createFantasySky(scene)

// 切换标签页时舍弃暂停期间的帧间隔，避免恢复时角色动画突然跳变。
document.addEventListener('visibilitychange', () => {
  pressedKeys.clear()
  clock.getDelta()
})

function animate() {
  requestAnimationFrame(animate)

  const deltaTime = clock.getDelta()
  movePlayer(deltaTime)
  collectNearbyItems()
  updateCharacterPosition()
  updateCharacterAnimation(deltaTime)
  animalMixers.forEach((mixer) => mixer.update(deltaTime))
  updateHouseTrigger()
  animateCollectibles(gameElapsedClock.getElapsedTime(), deltaTime)
  updateCoinCollectEffects(deltaTime)
  updateCoinParticles(deltaTime)
  updateWaterfalls(deltaTime, gameElapsedClock.getElapsedTime())
  updateCamera(deltaTime)
  fantasySky.update(deltaTime, camera)
  renderer.render(scene, camera)
}

animate()
