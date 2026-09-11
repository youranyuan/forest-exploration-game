import * as THREE from 'three'

// 纯视觉天空：渐变天穹、低多边形云海、太阳。无碰撞、无后处理。
export function createFantasySky(scene: THREE.Scene) {
  const domeGeometry = new THREE.SphereGeometry(250, 32, 20)
  const position = domeGeometry.getAttribute('position')
  const colors = new Float32Array(position.count * 3)
  const horizon = new THREE.Color(0xc9edf7)
  const zenith = new THREE.Color(0x479ed5)
  const below = new THREE.Color(0xdceef7)
  const color = new THREE.Color()
  for (let i = 0; i < position.count; i++) {
    const elevation = position.getY(i) / 250
    color.copy(horizon).lerp(elevation >= 0 ? zenith : below, Math.pow(Math.abs(elevation), 0.65))
    color.toArray(colors, i * 3)
  }
  domeGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  const dome = new THREE.Mesh(domeGeometry, new THREE.MeshBasicMaterial({
    vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false, toneMapped: false,
  }))
  dome.renderOrder = -100
  scene.add(dome)
  scene.fog = new THREE.Fog(0xc9e6f1, 35, 78)

  // 共用一个低面数几何体，以顶点颜色表现白云的亮顶和淡蓝底。
  const cloudGeometry = new THREE.IcosahedronGeometry(1, 1)
  const normals = cloudGeometry.getAttribute('normal')
  const cloudColors = new Float32Array(normals.count * 3)
  for (let i = 0; i < normals.count; i++) {
    color.set(0xc4e1f1).lerp(new THREE.Color(0xfffdf4), THREE.MathUtils.clamp(normals.getY(i) * 0.5 + 0.55, 0, 1))
    color.toArray(cloudColors, i * 3)
  }
  cloudGeometry.setAttribute('color', new THREE.BufferAttribute(cloudColors, 3))
  const cloudMaterial = new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, toneMapped: false })
  const clouds = new THREE.InstancedMesh(cloudGeometry, cloudMaterial, 144)
  const transform = new THREE.Object3D()
  const base = new THREE.Vector3()
  let index = 0
  // 三圈云：近处位于岛体下方，远处渐渐升至地平线附近。
  for (let cluster = 0; cluster < 36; cluster++) {
    const ring = Math.floor(cluster / 12)
    const angle = cluster * 2.39996
    const radius = 39 + ring * 27 + Math.sin(cluster * 4.1) * 4
    base.set(Math.cos(angle) * radius, ring === 0 ? -14 : ring === 1 ? -8 : 7, Math.sin(angle) * radius)
    for (let lobe = 0; lobe < 4; lobe++) {
      const size = 3.6 + ring * 1.6 + Math.sin(cluster + lobe) * 0.7
      transform.position.copy(base).add(new THREE.Vector3((lobe - 1.5) * size * 1.1, lobe === 1 ? size * 0.3 : -0.6, Math.sin(lobe * 2) * 1.4))
      transform.scale.set(size * 1.6, size * (lobe === 1 ? 0.75 : 0.4), size)
      transform.rotation.set(0, cluster * 0.7, 0)
      transform.updateMatrix()
      clouds.setMatrixAt(index++, transform.matrix)
    }
  }
  clouds.instanceMatrix.needsUpdate = true
  clouds.frustumCulled = false
  scene.add(clouds)

  // 太阳柔光用小型程序纹理，避免为光晕引入 Bloom。
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 128
  const context = canvas.getContext('2d')!
  const glow = context.createRadialGradient(64, 64, 12, 64, 64, 64)
  glow.addColorStop(0, 'rgba(255,248,202,1)')
  glow.addColorStop(0.3, 'rgba(255,245,184,1)')
  glow.addColorStop(0.34, 'rgba(255,239,159,0.4)')
  glow.addColorStop(1, 'rgba(255,239,159,0)')
  context.fillStyle = glow
  context.fillRect(0, 0, 128, 128)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  const sun = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, fog: false, toneMapped: false }))
  sun.scale.set(38, 38, 1)
  // 与当前太阳光 (-14,18,12) 保持同向。
  const sunOffset = new THREE.Vector3(-14, 18, 12).normalize().multiplyScalar(180)
  scene.add(sun)
  let elapsed = 0
  return {
    update(deltaTime: number, camera: THREE.Camera) {
      elapsed += Math.min(deltaTime, 0.05)
      dome.position.copy(camera.position)
      sun.position.copy(camera.position).add(sunOffset)
      clouds.rotation.y = Math.sin(elapsed * 0.015) * 0.018
    },
  }
}
