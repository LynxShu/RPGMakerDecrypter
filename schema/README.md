# schema/ — 存档字段即插即用（蓝图 §11.4-1）

第三方插件（YEP / VisuStella / 自研）会给存档新增字段，核心编辑模型不认识它们
（仍会**无损保留**，见 `src/lib/save/model.ts` 的设计原则），但用户无法在快捷表单里编辑。
本目录用于描述这些字段：往这里放一个 JSON，编辑器即按描述渲染出对应的标量字段。

## 格式

一个文件 = 一份 schema：

```jsonc
{
  "name": "MyPlugin",               // 可选：显示名
  "description": "…",               // 可选
  "fields": [
    {
      "path": "plugin.data.level",  // 必填：点分路径（支持数组下标，如 actors._data.1._hp）
      "label": "Level",             // 与 labelKey 二选一（labelKey 优先，走 i18n）
      "labelKey": "plugin.level",   // 可选：i18n key（需在语言包里定义）
      "type": "number",             // 必填：number | text | boolean
      "min": 1,                     // number 可选
      "max": 99,                    // number 可选
      "placeholder": "…",           // 可选
      "description": "…",           // 可选（渲染为字段下方的可见小字提示）
      "group": "MyPlugin",          // 可选：分组名（同组字段渲染在同一小节）
      "groupKey": "plugin.group"    // 可选：分组标题的 i18n key（优先于 group 文本展示）
    }
  ]
}
```

## 约定

- 只加载 `*.json`；文件名以 `_` 开头的视为**示例/模板**，不会加载（如 `_example-plugin.json`）。
- 字段级校验是防御性的：`path` 为空、`type` 非法、`label`/`labelKey` 都没有的字段会被跳过，
  不影响其余字段；整个文件 JSON 非法则跳过该文件并 warn。
- 多个文件按字段 `path` 合并，后者覆盖前者。
- 与语言包同理念：社区/用户直接丢文件，无需改代码。语言包文档见 `README.md` 的「语言包」一节。

## 说明

- 渲染层把 schema 字段按 `group` 分组渲染在快捷表单（每组一个小节）；
  缺省组（无 `group`）归入「自定义字段 (schema)」小节并排在最后。
  `groupKey`（或 `labelKey`）走 i18n 词典批量解析，缺失回退 `group`/`label`/`path`。
- `description` 渲染为字段下方的**可见小字提示**（不再只是悬停 title）。
- 改动与 JSON 树共享同一 `contents` 对象（原地改，未知字段保留）。
- 数值字段非法输入不会写入（`coerceFieldValue` 返回 null 时放弃写入），不会毁档。
