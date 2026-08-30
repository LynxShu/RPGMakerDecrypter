/**
 * 存档快捷表单（renderer，原生 DOM）。
 *
 * 覆盖最常用的可编辑项（真实 MZ 结构，防御性处理缺失字段）：
 * - 金币 party._gold
 * - 队伍成员 party._actors
 * - 物品/武器/防具 party._items/_weapons/_armors（{ id: count }）
 * - 变量 variables._data / 开关 switches._data（按 id 读写）
 * - 位置 map._mapId / player._x / _y / _direction
 * - 角色 actors._data（等级/HP/MP/TP）
 *
 * 所有输入在 change（失焦/回车）时提交 → onChange() → 上层重渲染。
 * 折叠状态经 `open` Set 跨渲染保留。
 *
 * 性能：标签由上层按 locale 缓存后经 `opts.labels` 同步传入（不再每次渲染
 * 串行 IPC 翻译）；输入带 `data-focus-id`，重渲染后恢复焦点，避免编辑丢焦点。
 */
import {
  addItem,
  getActorRows,
  getGold,
  getItemRows,
  getPartyActors,
  getPlayerPos,
  getSwitchRows,
  getVariableRows,
  getSchemaFieldValue,
  removeItem,
  removeSwitch,
  removeVariable,
  setActorField,
  setGold,
  setItemCount,
  setPartyActors,
  setPlayerPos,
  setSchemaFieldValue,
  setSwitch,
  setVariable,
  type ActorField,
  type ItemKind,
  type PlayerPos,
  type SaveFieldSchema
} from '@lib/save'

export interface QuickFormOptions {
  onChange: () => void
  /** 折叠的 section 集合（跨渲染保留） */
  open: Set<string>
  /** schema 目录提供的插件自定义字段（蓝图 §11.4-1） */
  schemaFields?: SaveFieldSchema[]
  /** 缓存好的 `save.*` 标签（含 schemaFields 标题），键为完整 key（如 `save.gold`） */
  labels: Record<string, string>
  /** 缓存好的 schema labelKey/groupKey 翻译 */
  schemaDict: Record<string, string>
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  return e
}

function escapeAttr(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function label(labels: Record<string, string>, key: string): string {
  return labels[`save.${key}`] ?? key
}

function miniBtn(text: string, cls: string, onClick: () => void): HTMLButtonElement {
  const b = el('button', 'btn-mini' + (cls ? ' ' + cls : ''))
  b.textContent = text
  b.addEventListener('click', onClick)
  return b
}

function numberInput(value: number | null, min = '0', focusId?: string): HTMLInputElement {
  const i = el('input')
  i.type = 'number'
  i.min = min
  i.value = value === null ? '' : String(value)
  if (focusId) i.dataset.focusId = focusId
  return i
}

/** 解析数字输入：非数字→0，向下取整，下限 0 */
function clampInt(s: string): number {
  const n = Math.floor(Number(s))
  return Number.isNaN(n) ? 0 : Math.max(0, n)
}

function appendSection(
  container: HTMLElement,
  id: string,
  title: string,
  open: Set<string>,
  build: (body: HTMLElement) => void
): void {
  const details = el('details', 'section')
  details.id = id
  const summary = el('summary')
  summary.textContent = title
  details.appendChild(summary)
  const body = el('div', 'section-body')
  details.appendChild(body)
  details.open = open.has(id)
  details.addEventListener('toggle', () => {
    if (details.open) open.add(id)
    else open.delete(id)
  })
  build(body)
  container.appendChild(details)
}

function appendEmpty(body: HTMLElement, text: string): void {
  const note = el('div', 'empty-note')
  note.textContent = text
  body.appendChild(note)
}

export function renderQuickForm(
  container: HTMLElement,
  contents: Record<string, unknown>,
  opts: QuickFormOptions
): void {
  // 重建前记录当前聚焦输入（data-focus-id），重建后恢复焦点，避免「编辑→丢焦点」
  const active = document.activeElement as HTMLElement | null
  const focusId = active && container.contains(active) && active.dataset.focusId ? active.dataset.focusId : null

  container.innerHTML = ''
  const onChange = opts.onChange
  const L = opts.labels

  const S = {
    gold: label(L, 'gold'),
    party: label(L, 'party'),
    partyActors: label(L, 'partyActors'),
    items: label(L, 'items'),
    weapons: label(L, 'weapons'),
    armors: label(L, 'armors'),
    variables: label(L, 'variables'),
    switches: label(L, 'switches'),
    position: label(L, 'position'),
    actors: label(L, 'actors'),
    level: label(L, 'level'),
    hp: label(L, 'hp'),
    mp: label(L, 'mp'),
    tp: label(L, 'tp'),
    mapId: label(L, 'mapId'),
    x: label(L, 'x'),
    y: label(L, 'y'),
    direction: label(L, 'direction'),
    id: label(L, 'id'),
    count: label(L, 'count'),
    value: label(L, 'value'),
    empty: label(L, 'empty'),
    add: label(L, 'add'),
    remove: label(L, 'remove'),
    missing: label(L, 'missing'),
    schemaFields: label(L, 'schemaFields')
  }

  // ---- 金币 ----
  appendSection(container, 'gold', S.gold, opts.open, (body) => {
    const gold = getGold(contents)
    if (gold === null) {
      appendEmpty(body, S.missing)
      return
    }
    const row = el('div', 'form-row')
    const lab = el('span', 'row-id')
    lab.textContent = S.gold
    const input = numberInput(gold, '0', 'gold')
    input.addEventListener('change', () => {
      setGold(contents, clampInt(input.value))
      onChange()
    })
    row.append(lab, input)
    body.appendChild(row)
  })

  // ---- 队伍成员 ----
  appendSection(container, 'party', S.party, opts.open, (body) => {
    const actors = getPartyActors(contents)
    if (actors === null) {
      appendEmpty(body, S.missing)
      return
    }
    const row = el('div', 'form-row')
    const lab = el('span', 'row-id')
    lab.textContent = S.partyActors
    const input = el('input')
    input.type = 'text'
    input.dataset.focusId = 'party'
    input.value = actors.join(', ')
    input.placeholder = '1, 3, 5'
    input.addEventListener('change', () => {
      const ids = input.value
        .split(',')
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isInteger(n) && n > 0)
      setPartyActors(contents, ids)
      onChange()
    })
    row.append(lab, input)
    body.appendChild(row)
  })

  // ---- 物品 / 武器 / 防具 ----
  const itemKinds: Array<{ kind: ItemKind; label: string; id: string }> = [
    { kind: 'items', label: S.items, id: 'items' },
    { kind: 'weapons', label: S.weapons, id: 'weapons' },
    { kind: 'armors', label: S.armors, id: 'armors' }
  ]
  for (const { kind, label: sectionLabel, id } of itemKinds) {
    appendSection(container, id, sectionLabel, opts.open, (body) => {
      const rows = getItemRows(contents, kind)
      if (rows.length === 0) appendEmpty(body, S.empty)
      for (const r of rows) {
        const row = el('div', 'form-row')
        const idSpan = el('span', 'row-id')
        idSpan.textContent = `#${r.id}`
        const input = numberInput(r.count, '0', `${id}-${r.id}`)
        input.title = S.count
        input.addEventListener('change', () => {
          setItemCount(contents, kind, r.id, clampInt(input.value))
          onChange()
        })
        const del = miniBtn('✕', 'danger', () => {
          removeItem(contents, kind, r.id)
          onChange()
        })
        del.title = S.remove
        row.append(idSpan, input, del)
        body.appendChild(row)
      }
      const addRow = el('div', 'add-row')
      const idInput = numberInput(null, '1', `${id}-add-id`)
      idInput.placeholder = S.id
      const cntInput = numberInput(1, '1', `${id}-add-count`)
      cntInput.placeholder = S.count
      const addBtn = miniBtn(S.add, '', () => {
        const idv = Number(idInput.value)
        if (Number.isInteger(idv) && idv > 0) {
          addItem(contents, kind, idv, clampInt(cntInput.value) || 1)
          onChange()
        }
      })
      addRow.append(idInput, cntInput, addBtn)
      body.appendChild(addRow)
    })
  }

  // ---- 变量 ----
  appendSection(container, 'variables', S.variables, opts.open, (body) => {
    const rows = getVariableRows(contents)
    if (rows.length === 0) appendEmpty(body, S.empty)
    for (const r of rows) {
      const row = el('div', 'form-row')
      const idSpan = el('span', 'row-id')
      idSpan.textContent = String(r.id)
      const input = numberInput(r.value, '0', `var-${r.id}`)
      input.addEventListener('change', () => {
        setVariable(contents, r.id, clampInt(input.value))
        onChange()
      })
      const del = miniBtn('✕', 'danger', () => {
        removeVariable(contents, r.id)
        onChange()
      })
      del.title = S.remove
      row.append(idSpan, input, del)
      body.appendChild(row)
    }
    const addRow = el('div', 'add-row')
    const idInput = numberInput(null, '0', 'var-add-id')
    idInput.placeholder = S.id
    const valInput = numberInput(0, '0', 'var-add-val')
    valInput.placeholder = S.value
    const addBtn = miniBtn(S.add, '', () => {
      const idv = Number(idInput.value)
      if (Number.isInteger(idv) && idv >= 0) {
        setVariable(contents, idv, clampInt(valInput.value))
        onChange()
      }
    })
    addRow.append(idInput, valInput, addBtn)
    body.appendChild(addRow)
  })

  // ---- 开关 ----
  appendSection(container, 'switches', S.switches, opts.open, (body) => {
    const rows = getSwitchRows(contents)
    if (rows.length === 0) appendEmpty(body, S.empty)
    for (const r of rows) {
      const row = el('div', 'form-row')
      const idSpan = el('span', 'row-id')
      idSpan.textContent = String(r.id)
      const cb = el('input')
      cb.type = 'checkbox'
      cb.dataset.focusId = `switch-${r.id}`
      cb.checked = r.value
      cb.addEventListener('change', () => {
        setSwitch(contents, r.id, cb.checked)
        onChange()
      })
      const del = miniBtn('✕', 'danger', () => {
        removeSwitch(contents, r.id)
        onChange()
      })
      del.title = S.remove
      row.append(idSpan, cb, del)
      body.appendChild(row)
    }
    const addRow = el('div', 'add-row')
    const idInput = numberInput(null, '0', 'switch-add-id')
    idInput.placeholder = S.id
    const addBtn = miniBtn(S.add, '', () => {
      const idv = Number(idInput.value)
      if (Number.isInteger(idv) && idv >= 0) {
        setSwitch(contents, idv, true)
        onChange()
      }
    })
    addRow.append(idInput, addBtn)
    body.appendChild(addRow)
  })

  // ---- 位置 ----
  appendSection(container, 'position', S.position, opts.open, (body) => {
    const pos = getPlayerPos(contents)
    const fields: Array<{ key: keyof PlayerPos; label: string; value: number | null; focusId: string }> = [
      { key: 'mapId', label: S.mapId, value: pos.mapId, focusId: 'pos-mapId' },
      { key: 'x', label: S.x, value: pos.x, focusId: 'pos-x' },
      { key: 'y', label: S.y, value: pos.y, focusId: 'pos-y' },
      { key: 'direction', label: S.direction, value: pos.direction, focusId: 'pos-dir' }
    ]
    for (const f of fields) {
      const row = el('div', 'form-row')
      const lab = el('span', 'row-id')
      lab.textContent = f.label
      const input = numberInput(f.value, '0', f.focusId)
      input.addEventListener('change', () => {
        setPlayerPos(contents, { [f.key]: clampInt(input.value) } as Partial<PlayerPos>)
        onChange()
      })
      row.append(lab, input)
      body.appendChild(row)
    }
  })

  // ---- 角色 ----
  appendSection(container, 'actors', S.actors, opts.open, (body) => {
    const actors = getActorRows(contents)
    if (actors.length === 0) appendEmpty(body, S.empty)
    const actorFields: Array<{ field: ActorField; label: string }> = [
      { field: 'level', label: S.level },
      { field: 'hp', label: S.hp },
      { field: 'mp', label: S.mp },
      { field: 'tp', label: S.tp }
    ]
    for (const a of actors) {
      const row = el('div', 'form-row')
      const name = el('span', 'row-name')
      name.textContent = `#${a.actorId} ${a.name}`
      name.title = a.name
      row.appendChild(name)
      for (const { field, label: fieldLabel } of actorFields) {
        const lab = el('span', 'row-id')
        lab.textContent = fieldLabel
        const input = numberInput(a[field], '0', `actor-${a.actorId}-${field}`)
        input.addEventListener('change', () => {
          setActorField(contents, a.actorId, field, clampInt(input.value))
          onChange()
        })
        row.append(lab, input)
      }
      body.appendChild(row)
    }
  })

  // ---- schema 自定义字段（蓝图 §11.4-1，即插即用） ----
  // 渲染层细化：按 group 分组渲染（组标题可走 i18n groupKey）、
  // description 显示为小字提示；labelKey/groupKey 用缓存字典同步解析。
  const schemaFields = opts.schemaFields ?? []
  if (schemaFields.length > 0) {
    const resolveLabel = (f: SaveFieldSchema): string => {
      if (f.labelKey) {
        const via = opts.schemaDict[f.labelKey]
        if (via && via !== f.labelKey) return via
        return f.label ?? f.path
      }
      return f.label ?? f.path
    }
    const resolveGroup = (g: string | undefined): string => {
      if (!g) return S.schemaFields
      const f = schemaFields.find((x) => x.group === g)
      if (f?.groupKey) {
        const via = opts.schemaDict[f.groupKey]
        if (via && via !== f.groupKey) return via
      }
      return g
    }

    // 按 group 分组（保持首次出现顺序；缺省组排在最后）
    const groups: Array<{ group: string; fields: SaveFieldSchema[] }> = []
    const index = new Map<string, number>()
    for (const f of schemaFields) {
      const g = f.group ?? ''
      let idx = index.get(g)
      if (idx === undefined) {
        idx = groups.length
        index.set(g, idx)
        groups.push({ group: g, fields: [] })
      }
      groups[idx].fields.push(f)
    }
    groups.sort((a, b) => {
      if (a.group === '') return 1
      if (b.group === '') return -1
      return 0
    })

    for (const g of groups) {
      const title = resolveGroup(g.group || undefined)
      appendSection(container, 'schema-' + (g.group || 'default'), title, opts.open, (body) => {
        for (const f of g.fields) {
          const row = el('div', 'form-row')
          const lab = el('span', 'row-id')
          lab.textContent = resolveLabel(f)
          lab.title = f.path
          const value = getSchemaFieldValue(contents, f)
          const focusId = `schema-${f.path}`
          let input: HTMLInputElement
          if (f.type === 'boolean') {
            input = el('input')
            input.type = 'checkbox'
            input.dataset.focusId = focusId
            input.checked = value === true
            input.addEventListener('change', () => {
              setSchemaFieldValue(contents, f, input.checked)
              onChange()
            })
          } else if (f.type === 'number') {
            input = el('input')
            input.type = 'number'
            input.min = f.min !== undefined ? String(f.min) : '0'
            if (f.max !== undefined) input.max = String(f.max)
            input.dataset.focusId = focusId
            input.value = typeof value === 'number' ? String(value) : ''
            input.placeholder = f.placeholder ?? ''
            input.addEventListener('change', () => {
              setSchemaFieldValue(contents, f, input.value)
              onChange()
            })
          } else {
            input = el('input')
            input.type = 'text'
            input.dataset.focusId = focusId
            input.value = typeof value === 'string' ? value : ''
            input.placeholder = f.placeholder ?? ''
            input.addEventListener('change', () => {
              setSchemaFieldValue(contents, f, input.value)
              onChange()
            })
          }
          row.append(lab, input)
          body.appendChild(row)
          if (f.description) {
            const desc = el('div', 'field-desc')
            desc.textContent = f.description
            body.appendChild(desc)
          }
        }
      })
    }
  }

  // 恢复焦点
  if (focusId) {
    const target = container.querySelector<HTMLElement>(`[data-focus-id="${escapeAttr(focusId)}"]`)
    if (target) target.focus()
  }
}
