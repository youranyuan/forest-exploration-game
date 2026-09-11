import * as THREE from 'three'

// 同一套共享材质和基础几何体，用细节区分三栋参考图风格的小屋。
const material = {
  plaster: new THREE.MeshStandardMaterial({ color: 0xe6cfa1, roughness: 1 }),
  timber: new THREE.MeshStandardMaterial({ color: 0x986137, roughness: 0.95 }),
  door: new THREE.MeshStandardMaterial({ color: 0x80502e, roughness: 1 }),
  stone: new THREE.MeshStandardMaterial({ color: 0x969080, roughness: 1 }),
  roof: new THREE.MeshStandardMaterial({ color: 0x387e87, roughness: 0.9 }),
  tile: new THREE.MeshStandardMaterial({ color: 0x498e96, roughness: 0.9 }),
  glass: new THREE.MeshStandardMaterial({ color: 0xffd990, emissive: 0xd98b30, emissiveIntensity: 0.3, roughness: 0.6 }),
  leaves: new THREE.MeshStandardMaterial({ color: 0x709851, roughness: 1 }),
  soil: new THREE.MeshStandardMaterial({ color: 0x725744, roughness: 1 }),
  flower: new THREE.MeshStandardMaterial({ color: 0xeac4ce, roughness: 1 }),
}
const cube = new THREE.BoxGeometry(1, 1, 1)
const foliage = new THREE.IcosahedronGeometry(1, 0)

export function createHouse(variant: number) {
  const group = new THREE.Group()
  group.name = ['花园小屋（一层）', '遮棚小屋（一层）', '阳台小楼（两层）'][variant]
  const height = variant === 2 ? 3.45 : 2.05
  function box(x: number, y: number, z: number, w: number, h: number, d: number, surface: THREE.Material) {
    const mesh = new THREE.Mesh(cube, surface)
    mesh.position.set(x, y, z)
    mesh.scale.set(w, h, d)
    mesh.castShadow = mesh.receiveShadow = true
    group.add(mesh)
    return mesh
  }
  function beam(a: THREE.Vector3, b: THREE.Vector3, thickness = 0.13) {
    const mesh = box(0, 0, 0, thickness, a.distanceTo(b), thickness, material.timber)
    mesh.position.copy(a).add(b).multiplyScalar(0.5)
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize())
  }
  box(0, 0.2, 0, 2.55, 0.4, 2.25, material.stone)
  box(0, (height + 0.4) / 2, 0, 2.4, height - 0.4, 2.1, material.plaster)
  // 石基座接缝和木构架。
  for (const x of [-1.15, 1.15]) for (const z of [-1.04, 1.04]) box(x, height / 2, z, 0.15, height, 0.15, material.timber)
  for (const y of [0.43, height - 0.08, ...(variant === 2 ? [1.95] : [])]) box(0, y, 1.075, 2.4, 0.14, 0.12, material.timber)
  for (let i = 0; i < 6; i++) box(-1.06 + i * 0.42, 0.21, 1.135, 0.38, 0.33, 0.05, material.stone)

  // 实心山墙连接双坡屋顶；瓦片分层有厚度，避免像平面纸片。
  const gable = new THREE.Shape()
  gable.moveTo(-1.2, 0); gable.lineTo(1.2, 0); gable.lineTo(0, 1.05); gable.closePath()
  const gableMesh = new THREE.Mesh(new THREE.ExtrudeGeometry(gable, { depth: 2.1, bevelEnabled: false }), material.plaster)
  gableMesh.position.set(0, height, -1.05)
  gableMesh.castShadow = gableMesh.receiveShadow = true
  group.add(gableMesh)
  const angle = Math.atan2(1.05, 1.45)
  for (const side of [-1, 1]) {
    const roof = box(side * 0.725, height + 0.525, 0, Math.hypot(1.45, 1.05), 0.12, 2.7, material.roof)
    roof.rotation.z = -side * angle
    for (let row = 0; row < 4; row++) {
      const along = (row + 0.5) / 4
      for (let col = 0; col < 5; col++) {
        const tile = box(side * 1.45 * along, height + 1.05 * (1 - along) + 0.09, (col - 2) * 0.535,
          Math.hypot(1.45, 1.05) / 4 + 0.04, 0.055, 0.52, (row + col) % 3 ? material.roof : material.tile)
        tile.rotation.z = -side * angle
      }
    }
    for (const z of [-1.37, 1.37]) beam(new THREE.Vector3(0, height + 1.14, z), new THREE.Vector3(side * 1.53, height - 0.02, z))
  }
  box(0, height + 1.13, 0, 0.18, 0.17, 2.88, material.timber)
  beam(new THREE.Vector3(0, height, 1.08), new THREE.Vector3(0, height + 0.93, 1.08))
  // 入口、分块木门、门把手和台阶。
  box(0, 0.96, 1.12, 0.72, 1.15, 0.13, material.door)
  for (const x of [-0.4, 0.4]) box(x, 1.0, 1.15, 0.09, 1.28, 0.18, material.timber)
  box(0, 1.65, 1.15, 0.89, 0.13, 0.2, material.timber)
  for (const x of [-0.22, 0, 0.22]) box(x, 0.96, 1.195, 0.02, 1.1, 0.015, material.timber)
  box(0.23, 0.95, 1.22, 0.065, 0.065, 0.05, material.stone)
  box(0, 0.1, 1.58, 1.0, 0.2, 0.6, material.stone)
  box(0, 0.25, 1.35, 0.95, 0.15, 0.3, material.timber)
  function windowAt(x: number, y: number, z: number, side = false) {
    const frame = new THREE.Group()
    for (const [w, h, d, surface] of [[0.65, 0.72, 0.13, material.timber], [0.47, 0.54, 0.15, material.glass]] as const) {
      const mesh = new THREE.Mesh(cube, surface); mesh.scale.set(w, h, d); frame.add(mesh)
    }
    for (const [w, h] of [[0.045, 0.56], [0.5, 0.045]]) {
      const cross = new THREE.Mesh(cube, material.timber); cross.scale.set(w, h, 0.05); cross.position.z = 0.09; frame.add(cross)
    }
    frame.position.set(x, y, z); frame.rotation.y = side ? Math.PI / 2 : 0; group.add(frame)
  }
  windowAt(-0.78, 1.16, 1.14)
  windowAt(1.23, 1.2, -0.05, true)
  if (variant === 2) {
    windowAt(-0.55, 2.65, 1.14); windowAt(0.55, 2.65, 1.14)
    windowAt(1.23, 2.65, 0, true)
    box(0, 2.1, 1.39, 2.1, 0.12, 0.66, material.timber)
    for (const x of [-0.95, -0.48, 0, 0.48, 0.95]) box(x, 2.4, 1.69, 0.06, 0.52, 0.06, material.timber)
    box(0, 2.67, 1.69, 2.1, 0.07, 0.09, material.timber)
  }
  // 不同位置的石烟囱；不使用额外点光源。
  const chimneyX = variant === 1 ? -0.75 : 0.72
  box(chimneyX, height + 0.85, -0.62, 0.35, 1.4, 0.4, material.stone)
  box(chimneyX, height + 1.59, -0.62, 0.45, 0.12, 0.5, material.door)
  box(0.53, 1.47, 1.23, 0.13, 0.24, 0.13, material.glass)
  if (variant === 1) {
    const awning = box(-1.65, 1.42, 0, 0.88, 0.1, 1.72, material.plaster)
    awning.rotation.z = 0.22
    for (const z of [-0.75, 0.75]) box(-2.02, 0.65, z, 0.1, 1.3, 0.1, material.timber)
  } else {
    // 开放式小花圃，门前留出通路。
    box(-1.66, 0.1, 0.05, 0.62, 0.2, 1.55, material.timber)
    box(-1.66, 0.22, 0.05, 0.5, 0.07, 1.4, material.soil)
    for (let i = 0; i < 5; i++) {
      const leaves = new THREE.Mesh(foliage, material.leaves)
      leaves.position.set(-1.66, 0.38, -0.52 + i * 0.28); leaves.scale.set(0.2, 0.22, 0.2); group.add(leaves)
      const flower = new THREE.Mesh(foliage, material.flower)
      flower.position.copy(leaves.position).y += 0.2; flower.scale.setScalar(0.085); group.add(flower)
    }
  }
  group.traverse((object) => { if (object instanceof THREE.Mesh) { object.castShadow = true; object.receiveShadow = true } })
  return group
}

// 预设空旷地带中的候选点；不在整个浮岛上随意撒房子。
export const houseSpawnPoints = [
  [-6, -16], [0, -17], [-11, -17], [-5, -12], [0, -12],
  [10, -16], [10, -19], [-5, -19], [0, -8], [-3, -8],
  [-15, -17], [-16, -10], [15, 3], [16, 0], [11, 13],
  [7, 14], [0, 15], [-4, 16], [-8, 15], [-16, -3],
  [3, -18], [-10, -13], [4, 11], [12, 0],
].map(([x, z]) => new THREE.Vector2(x, z))
