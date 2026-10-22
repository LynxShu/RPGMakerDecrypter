# fixtures（回归测试样本）

用于回归测试，**防止重构把加密算法改坏**（蓝图 §11.4-6）。

## 目录约定

```
fixtures/
  encrypted/   # 传入（加密输入）
    *.rpgmvp / *.rpgmvo / *.rpgmvm / *.png_ / *.ogg_ / *.m4a_
  expected/    # 预期解密结果（可选，用于对比）
  key.json     # 每个样本对应的密钥（可选，用于自动找 key 校验）
```

## 如何放入真实样本

把**你拥有或有授权的**真实游戏加密资源（体积建议小，如单张 PNG / 单段音频）放入
`fixtures/encrypted/`，并在 `key.json` 记录该样本的密钥，举例：

```json
{
  "encrypted/sample_.png": "0123456789abcdef",
  "encrypted/sample.rpgmvo": "0123456789abcdef"
}
```

M0 的**合成回归向量**已经内置于 `tests/crypto.test.ts`
（round-trip、假头签名、短密钥、key 反推、魔数校验等），无需额外样本即可跑通。

## 真实样本回归（本地）

当前已放置一个真实 MZ 游戏样本于 `fixtures/real-sample/`（含 `data/System.json` 密钥等）。
跑真实端到端回归：

```bash
node scripts/regression-real.cjs
```

该样本仅**本地回归**用，因版权与体积**不进 git 仓库**（已在 `.gitignore` 忽略 `fixtures/real-sample/`）。

> 注意：请勿把含版权风险的真实游戏资源提交进仓库。若要新增其他样本目录，请添加到 `.gitignore`。
