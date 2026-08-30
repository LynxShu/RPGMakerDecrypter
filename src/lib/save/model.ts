/**
 * 存档编辑模型（纯 TS，零 Node/Electron 依赖）：
 * 路径读写 + 常用字段的表单型编辑助手。
 *
 * 结构依据真实 MZ 存档（本地私有样本的 file0.rmmzsave）：
 * - `party._gold`: number
 * - `party._items` / `_weapons` / `_armors`: `{ [itemId]: count }`
 * - `party._actors`: number[]（加入队伍的 actor id 列表）
 * - `switches._data`: Array<boolean|null>（下标即开关 id，0 号位未用）
 * - `variables._data`: Array<number|null>（下标即变量 id，0 号位未用）
 * - `map._mapId` / `player._x` / `player._y` / `player._direction`
 * - `actors._data`: Array<actor|null>，actor 有 `_actorId/_name/_level/_hp/_mp/_tp`
 *
 * 设计原则：
 * - **防御性**：字段缺失/形状不符时返回 null/空数组，绝不抛错、绝不建错结构。
 * - **原地改**：直接 mutate contents，未知字段天然保留；配合 JsonEx 语义无损 round-trip。
 * - 变量/开关按 id 写 `_data[id]`（不 splice，与游戏数组语义一致）；
 *   通用 `deletePath` 对数组用 splice（供 JSON 树编辑使用）。
 */

export type ItemKind = 'items' | 'weapons' | 'armors'

// ---------------------------------------------------------------------------
// 路径读写
// ---------------------------------------------------------------------------

/** 路径段：对象键（string）或数组下标（number） */
export type PathSeg = string | number

/** 按点分路径取值（支持数组下标）。取不到返回 undefined。 */
export function getPath(obj: unknown, path: string): unknown {
  return getPathSegs(obj, path === '' ? [] : path.split('.'))
}

/**
 * 按路径段数组取值（支持数组下标）。取不到返回 undefined。
 * 与 `getPath` 等价，但段之间不经过 `.` 拼接——键名本身含 `.` 时不会解析错。
 */
export function getPathSegs(obj: unknown, segs: readonly PathSeg[]): unknown {
  if (segs.length === 0) return obj
  let cur: unknown = obj
  for (const seg of segs) {
    if (cur === null || cur === undefined || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[String(seg)]
  }
  return cur
}

/** 按点分路径赋值；中间对象缺失时创建普通对象（不建数组，避免歧义）。 */
export function setPath(obj: unknown, path: string, value: unknown): void {
  if (path === '') return
  setPathSegs(obj, path.split('.'), value)
}

/** 按路径段数组赋值；中间对象缺失时创建普通对象（不建数组，避免歧义）。 */
export function setPathSegs(obj: unknown, segs: readonly PathSeg[], value: unknown): void {
  if (segs.length === 0) return
  let cur: unknown = obj
  for (let i = 0; i < segs.length - 1; i++) {
    if (cur === null || cur === undefined || typeof cur !== 'object') return
    const parent = cur as Record<string, unknown>
    const key = String(segs[i])
    const next = parent[key]
    if (next === null || next === undefined || typeof next !== 'object') {
      const created: Record<string, unknown> = {}
      parent[key] = created
      cur = created
    } else {
      cur = next
    }
  }
  const last = String(segs[segs.length - 1])
  if (cur === null || cur === undefined || typeof cur !== 'object') return
  ;(cur as Record<string, unknown>)[last] = value
}

/** 按点分路径删除：数组父级用 splice（保持紧凑），对象父级 delete 键。 */
export function deletePath(obj: unknown, path: string): void {
  if (path === '') return
  deletePathSegs(obj, path.split('.'))
}

/** 按路径段数组删除：数组父级用 splice（保持紧凑），对象父级 delete 键。 */
export function deletePathSegs(obj: unknown, segs: readonly PathSeg[]): void {
  if (segs.length === 0) return
  let cur: unknown = obj
  for (let i = 0; i < segs.length - 1; i++) {
    if (cur === null || cur === undefined || typeof cur !== 'object') return
    cur = (cur as Record<string, unknown>)[String(segs[i])]
  }
  const last = String(segs[segs.length - 1])
  if (cur === null || cur === undefined || typeof cur !== 'object') return
  const parent = cur as Record<string, unknown>
  if (Array.isArray(parent)) {
    const idx = Number(last)
    if (Number.isInteger(idx) && idx >= 0 && idx < parent.length) parent.splice(idx, 1)
  } else {
    delete parent[last]
  }
}

// ---------------------------------------------------------------------------
// 通用小工具
// ---------------------------------------------------------------------------

function num(v: unknown): number | null {
  return typeof v === 'number' ? v : null
}

function getOrCreateMap(contents: Record<string, unknown>, path: string): Record<string, unknown> {
  const existing = getPath(contents, path)
  if (existing && typeof existing === 'object' && !Array.isArray(existing)) {
    return existing as Record<string, unknown>
  }
  const fresh: Record<string, unknown> = {}
  setPath(contents, path, fresh)
  return fresh
}

// ---------------------------------------------------------------------------
// 金币
// ---------------------------------------------------------------------------

export function getGold(contents: Record<string, unknown>): number | null {
  return num(getPath(contents, 'party._gold'))
}

export function setGold(contents: Record<string, unknown>, value: number): void {
  setPath(contents, 'party._gold', value)
}

// ---------------------------------------------------------------------------
// 队伍成员（party._actors）
// ---------------------------------------------------------------------------

export function getPartyActors(contents: Record<string, unknown>): number[] | null {
  const v = getPath(contents, 'party._actors')
  return Array.isArray(v) && v.every((x) => typeof x === 'number') ? (v.slice() as number[]) : null
}

export function setPartyActors(contents: Record<string, unknown>, ids: number[]): void {
  setPath(contents, 'party._actors', ids)
}

// ---------------------------------------------------------------------------
// 物品 / 武器 / 防具（party._items 等：{ [id]: count }）
// ---------------------------------------------------------------------------

export function getItemRows(contents: Record<string, unknown>, kind: ItemKind): Array<{ id: number; count: number }> {
  const map = getPath(contents, `party._${kind}`)
  if (!map || typeof map !== 'object' || Array.isArray(map)) return []
  return Object.entries(map as Record<string, unknown>)
    .map(([k, v]) => ({ id: Number(k), count: typeof v === 'number' ? v : 0 }))
    .sort((a, b) => a.id - b.id)
}

/** 设置数量；<= 0 视为删除该条目（与游戏 removeItem 语义一致）。 */
export function setItemCount(contents: Record<string, unknown>, kind: ItemKind, id: number, count: number): void {
  if (!Number.isInteger(id) || id <= 0) return
  const map = getOrCreateMap(contents, `party._${kind}`)
  if (count <= 0) delete map[String(id)]
  else map[String(id)] = count
}

export function removeItem(contents: Record<string, unknown>, kind: ItemKind, id: number): void {
  const map = getPath(contents, `party._${kind}`)
  if (map && typeof map === 'object' && !Array.isArray(map)) {
    delete (map as Record<string, unknown>)[String(id)]
  }
}

/** 增加数量（已存在则累加）。 */
export function addItem(contents: Record<string, unknown>, kind: ItemKind, id: number, count: number): void {
  const cur = getItemRows(contents, kind).find((r) => r.id === id)
  setItemCount(contents, kind, id, (cur?.count ?? 0) + count)
}

// ---------------------------------------------------------------------------
// 变量 / 开关（holder._data 为数组时按下标读写；为对象时按键读写）
// ---------------------------------------------------------------------------

type VarContainer = { kind: 'array'; arr: Array<unknown> } | { kind: 'map'; obj: Record<string, unknown> }

function getVarContainer(contents: Record<string, unknown>, field: 'variables' | 'switches'): VarContainer | null {
  const holder = getPath(contents, field)
  if (!holder || typeof holder !== 'object' || Array.isArray(holder)) return null
  const data = (holder as Record<string, unknown>)._data
  if (Array.isArray(data)) return { kind: 'array', arr: data }
  if (data && typeof data === 'object') return { kind: 'map', obj: data as Record<string, unknown> }
  return null
}

export function getVariableRows(contents: Record<string, unknown>): Array<{ id: number; value: number }> {
  const c = getVarContainer(contents, 'variables')
  if (!c) return []
  const rows: Array<{ id: number; value: number }> = []
  if (c.kind === 'array') {
    c.arr.forEach((v, id) => {
      if (typeof v === 'number') rows.push({ id, value: v })
    })
  } else {
    for (const [k, v] of Object.entries(c.obj)) {
      if (typeof v === 'number') rows.push({ id: Number(k), value: v })
    }
  }
  return rows.sort((a, b) => a.id - b.id)
}

export function setVariable(contents: Record<string, unknown>, id: number, value: number): void {
  if (!Number.isInteger(id) || id < 0) return
  const c = getVarContainer(contents, 'variables')
  if (!c) return
  if (c.kind === 'array') c.arr[id] = value
  else c.obj[String(id)] = value
}

export function removeVariable(contents: Record<string, unknown>, id: number): void {
  const c = getVarContainer(contents, 'variables')
  if (!c) return
  if (c.kind === 'array') {
    if (id >= 0 && id < c.arr.length) c.arr[id] = null
  } else {
    delete c.obj[String(id)]
  }
}

export function getSwitchRows(contents: Record<string, unknown>): Array<{ id: number; value: boolean }> {
  const c = getVarContainer(contents, 'switches')
  if (!c) return []
  const rows: Array<{ id: number; value: boolean }> = []
  if (c.kind === 'array') {
    c.arr.forEach((v, id) => {
      if (typeof v === 'boolean') rows.push({ id, value: v })
    })
  } else {
    for (const [k, v] of Object.entries(c.obj)) {
      if (typeof v === 'boolean') rows.push({ id: Number(k), value: v })
    }
  }
  return rows.sort((a, b) => a.id - b.id)
}

export function setSwitch(contents: Record<string, unknown>, id: number, value: boolean): void {
  if (!Number.isInteger(id) || id < 0) return
  const c = getVarContainer(contents, 'switches')
  if (!c) return
  if (c.kind === 'array') c.arr[id] = value
  else c.obj[String(id)] = value
}

export function removeSwitch(contents: Record<string, unknown>, id: number): void {
  const c = getVarContainer(contents, 'switches')
  if (!c) return
  if (c.kind === 'array') {
    if (id >= 0 && id < c.arr.length) c.arr[id] = null
  } else {
    delete c.obj[String(id)]
  }
}

// ---------------------------------------------------------------------------
// 地图 / 玩家位置
// ---------------------------------------------------------------------------

export interface PlayerPos {
  mapId: number | null
  x: number | null
  y: number | null
  direction: number | null
}

export function getPlayerPos(contents: Record<string, unknown>): PlayerPos {
  return {
    mapId: num(getPath(contents, 'map._mapId')),
    x: num(getPath(contents, 'player._x')),
    y: num(getPath(contents, 'player._y')),
    direction: num(getPath(contents, 'player._direction'))
  }
}

export function setPlayerPos(contents: Record<string, unknown>, pos: Partial<PlayerPos>): void {
  if (pos.mapId !== undefined) setPath(contents, 'map._mapId', pos.mapId)
  if (pos.x !== undefined) setPath(contents, 'player._x', pos.x)
  if (pos.y !== undefined) setPath(contents, 'player._y', pos.y)
  if (pos.direction !== undefined) setPath(contents, 'player._direction', pos.direction)
}

// ---------------------------------------------------------------------------
// 角色（actors._data）
// ---------------------------------------------------------------------------

export interface ActorRow {
  actorId: number
  name: string
  level: number | null
  hp: number | null
  mp: number | null
  tp: number | null
}

export type ActorField = 'level' | 'hp' | 'mp' | 'tp'

export function getActorRows(contents: Record<string, unknown>): ActorRow[] {
  const data = getPath(contents, 'actors._data')
  if (!Array.isArray(data)) return []
  const rows: ActorRow[] = []
  for (const a of data) {
    if (!a || typeof a !== 'object') continue
    const rec = a as Record<string, unknown>
    const actorId = num(rec._actorId)
    if (actorId === null) continue
    rows.push({
      actorId,
      name: typeof rec._name === 'string' ? rec._name : '',
      level: num(rec._level),
      hp: num(rec._hp),
      mp: num(rec._mp),
      tp: num(rec._tp)
    })
  }
  return rows
}

export function setActorField(
  contents: Record<string, unknown>,
  actorId: number,
  field: ActorField,
  value: number
): void {
  const data = getPath(contents, 'actors._data')
  if (!Array.isArray(data)) return
  const idx = data.findIndex(
    (a) => a && typeof a === 'object' && (a as Record<string, unknown>)._actorId === actorId
  )
  if (idx < 0) return
  // 存档字段名带 "_" 前缀（_level/_hp/_mp/_tp）
  setPath(contents, `actors._data.${idx}._${field}`, value)
}
