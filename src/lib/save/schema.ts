/**
 * 存档字段 schema（纯 TS，零 Node/Electron 依赖）。
 *
 * 蓝图 §11.4-1：与语言目录同理念的「schema 即插即用」——
 * 第三方插件会给存档新增字段，核心编辑模型不认识它们（仍能无损保留），
 * 但用户想在快捷表单里编辑这些字段时，社区/用户可往 `schema/` 目录丢 JSON 描述，
 * 编辑器即按描述渲染出对应的标量字段（number / text / boolean），避免 schema 漂移导致毁档。
 *
 * 格式示例见仓库根目录 `schema/`。
 */
import { getPath, setPath } from './model'

/** 支持的表单字段类型 */
export type SchemaFieldType = 'number' | 'text' | 'boolean'

/** 单个字段描述：路径 + 展示信息 + 类型约束 */
export interface SaveFieldSchema {
  /** 点分路径，如 `plugin.xpBonus.value`（支持数组下标） */
  path: string
  /** 展示文案（literal）。与 labelKey 二选一，labelKey 优先 */
  label?: string
  /** i18n key（渲染层用当前语言解析，缺失则回退 label） */
  labelKey?: string
  /** 字段类型 */
  type: SchemaFieldType
  /** number 类型的最小值（可选） */
  min?: number
  /** number 类型的最大值（可选） */
  max?: number
  /** 输入占位提示（可选） */
  placeholder?: string
  /** 字段说明（可选，渲染为 title 或小字提示） */
  description?: string
  /** 分组名（可选；同一分组渲染在同一小节，缺省归入默认组） */
  group?: string
  /** 分组标题的 i18n key（可选；与 labelKey 同理，优先于 group 文本展示） */
  groupKey?: string
}

/** 一份 schema 文件（对应 schema/ 下的一个 JSON） */
export interface SaveSchema {
  /** schema 名（文件内 `name` 字段；缺省取文件名） */
  name?: string
  /** 描述（可选） */
  description?: string
  /** 字段列表 */
  fields: SaveFieldSchema[]
}

const FIELD_TYPES: readonly SchemaFieldType[] = ['number', 'text', 'boolean']

function isFieldType(v: unknown): v is SchemaFieldType {
  return typeof v === 'string' && (FIELD_TYPES as readonly string[]).includes(v)
}

/**
 * 解析一份 schema JSON 文本为 SaveSchema（防御性）：
 * - 非法 JSON 抛错（由调用方决定是否跳过该文件）；
 * - 字段级校验：path 非空、type 合法、label/labelKey 至少其一；
 *   不满足的字段被跳过，不影响其余字段。
 */
export function parseSaveSchema(json: string): SaveSchema {
  const raw: unknown = JSON.parse(json)
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('schema 顶层必须是对象')
  }
  const obj = raw as Record<string, unknown>
  const fieldsRaw = Array.isArray(obj.fields) ? obj.fields : []
  const fields: SaveFieldSchema[] = []
  for (const f of fieldsRaw) {
    if (!f || typeof f !== 'object' || Array.isArray(f)) continue
    const rec = f as Record<string, unknown>
    if (typeof rec.path !== 'string' || rec.path.trim().length === 0) continue
    if (!isFieldType(rec.type)) continue
    if (typeof rec.label !== 'string' && typeof rec.labelKey !== 'string') continue
    const field: SaveFieldSchema = {
      path: rec.path,
      type: rec.type
    }
    if (typeof rec.label === 'string') field.label = rec.label
    if (typeof rec.labelKey === 'string') field.labelKey = rec.labelKey
    if (typeof rec.min === 'number') field.min = rec.min
    if (typeof rec.max === 'number') field.max = rec.max
    if (typeof rec.placeholder === 'string') field.placeholder = rec.placeholder
    if (typeof rec.description === 'string') field.description = rec.description
    if (typeof rec.group === 'string') field.group = rec.group
    if (typeof rec.groupKey === 'string') field.groupKey = rec.groupKey
    fields.push(field)
  }
  const schema: SaveSchema = { fields }
  if (typeof obj.name === 'string') schema.name = obj.name
  if (typeof obj.description === 'string') schema.description = obj.description
  return schema
}

/**
 * 合并多份 schema：按字段 path 去重，后者覆盖前者。
 * 组顺序保持首次出现顺序；字段顺序保持各 schema 内顺序。
 */
export function mergeSaveSchemas(...schemas: SaveSchema[]): SaveSchema {
  const byPath = new Map<string, SaveFieldSchema>()
  const order: string[] = []
  const groupOrder: string[] = []
  for (const s of schemas) {
    for (const f of s.fields) {
      if (!byPath.has(f.path)) order.push(f.path)
      byPath.set(f.path, f)
      const g = f.group ?? ''
      if (!groupOrder.includes(g)) groupOrder.push(g)
    }
  }
  return {
    fields: order.map((p) => byPath.get(p)!),
    // 合并结果不携带 name/description（多来源无唯一值）
  }
}

/** 按字段类型把「用户输入」规约为可安全写入的值；非法输入返回 null */
export function coerceFieldValue(field: SaveFieldSchema, raw: unknown): unknown {
  switch (field.type) {
    case 'number': {
      const n = Number(raw)
      if (!Number.isFinite(n)) return null
      let v = n
      if (field.min !== undefined && v < field.min) v = field.min
      if (field.max !== undefined && v > field.max) v = field.max
      return v
    }
    case 'boolean':
      return raw === true || raw === 'true' || raw === 1 || raw === '1' || raw === 'on'
    case 'text':
      return String(raw ?? '')
  }
}

/** 读取字段当前值（沿路径；缺失返回 undefined，由渲染层展示空态） */
export function getSchemaFieldValue(contents: Record<string, unknown>, field: SaveFieldSchema): unknown {
  return getPath(contents, field.path)
}

/** 把用户输入按类型规约后写入 contents（原地改，未知字段天然保留） */
export function setSchemaFieldValue(
  contents: Record<string, unknown>,
  field: SaveFieldSchema,
  raw: unknown
): void {
  const value = coerceFieldValue(field, raw)
  if (value === null) return
  setPath(contents, field.path, value)
}
