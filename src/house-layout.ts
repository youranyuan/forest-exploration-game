// 固定三个探索角色；建筑几何与尺寸保持不变。
export const houseLayout = [
  { role: '高地房屋', variant: 0, x: 17.7, z: -9.7, rotation: -Math.PI / 2 },
  { role: '中心地标', variant: 2, x: -3, z: -6, rotation: 0 },
  { role: '远处探索房屋', variant: 1, x: -8, z: 15.5, rotation: Math.PI / 2 },
]

// 与东南高台相接的水平院台，原坡道和原平台高度不变。
export const houseTerrace = { x: 18, z: -9.7, width: 4.8, depth: 4.6, height: 1.5 }

export function isHouseReserved(x: number, z: number, radius = 0) {
  return houseLayout.some((house) => {
    const dx = x - house.x
    const dz = z - house.z
    const localX = Math.cos(house.rotation) * dx - Math.sin(house.rotation) * dz
    const localZ = Math.sin(house.rotation) * dx + Math.cos(house.rotation) * dz
    // 外墙、屋檐和侧院；门前额外预留约 1.3 单位作为未来触发区。
    const nearBody = localX >= -2.3 - radius && localX <= 1.85 + radius
      && localZ >= -1.65 - radius && localZ <= 1.9 + radius
    const nearEntrance = Math.abs(localX) <= 0.85 + radius
      && localZ >= 1.5 - radius && localZ <= 3.1 + radius
    return nearBody || nearEntrance
  })
}
