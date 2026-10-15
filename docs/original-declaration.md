# 原创资格与页面核验

抖音、视频号、快手、小红书、哔哩哔哩共用原创审查流程，原创与 AI 标注分别处理。原创不等于首发、独家，也不等于仅获得素材使用授权。本功能不能自动作出法律上的原创认定：资格由制作/运营流程核查内容来源、创作过程与目标平台条件后传入。

HTTP `/publish` 可传 `originalDeclaration`；CLI 使用 `--original-declaration-json '<JSON>'`。单任务示例：

```json
{
  "eligible": true,
  "reason": "独立脚本、原创操作示意和授权配音；已核对目标平台原创条件",
  "platform": "dy",
  "fileSha256": "填写当前实际成片的64位SHA256",
  "evidence": ["content.json", "originality-review.json"]
}
```

`eligible:true` 必须绑定平台、视频 SHA256、非空理由和证据。运行时重新计算实际上传文件哈希；不匹配在打开投稿页前停止。多平台请求分别在 `platforms[]` 内传审查，不能把抖音审查用于其它平台。定时任务保留审查，到点再次检查素材。

不符合或未能确认条件时传 `{"eligible":false,"reason":"具体原因"}`；缺省也不声明原创。仅授权搬运、来源不明、平台明确排除的素材不能因为使用了自制模板就获得资格。已有默认勾选会尝试取消并核验；无法取消时停止提交。

只操作具有可读选中状态的独立原创控件，不点击普通“原创声明”标题，不把 AI 下拉选项或“本人实拍”当成原创承诺。B站“内容为自制：未经作者允许，禁止转载”为独立可选授权声明，符合条件时选择并核验其勾选标记，同时确认 AI 主声明未改变。不选择首发或独家。

小红书原创开关在 AI 声明上方的 `.custom-switch-card` 内，文字和开关是兄弟节点，读取该行原生 checkbox 核验。平台当前提示视频小于10秒不支持原创声明：运行时读取上传预览视频时长，不足10秒时即使请求审查为符合，也按平台限制不勾选，并记录 `runtimeRestriction:xhs_duration_below_10_seconds`、实际时长与关闭状态；不影响如实标注 AI。超过10秒仍需满足其它原创条件。开关因未知原因禁用时停止提交，不能强行移除 disabled。

遇首次原创协议或条款变更，先保存 `termsText` / `termsSha256` 并停止提交；运营流程读取实际条款、重新判断资格后，可传相同的 `acceptedTermsSha256` 再受控恢复。不会自动接受未审查协议；包含首发/独家要求或明确 AI 限制的协议不能直接自动确认。恢复前核对本地任务与平台作品，保留原始 intent，禁止盲目重试。

回执与历史新增 `originalDeclaration`（平台处理结果）和 `creativeStatementVerification`。处理结果：

- `selected`：已读取并核验选中状态，`verified:true, selected:true`。
- `not_claimed`：不声明且已核验关闭，`verified:true, selected:false`。
- `not_offered`：当前已加载表单没有可独立核验的原创控件，`verified:false`；不代表原创声明成功，也不阻止保留 AI 声明后的正常投稿。
- `failed`：资格、控件、协议、选中状态或 AI 保留核验失败，返回 `retryable:false, needsAttention:true`，停止提交。

测试：`node scripts/test-original-declaration.js`、`test-original-declaration-api.js`、`test-original-declaration-dom.js`，并运行既有平台、声明、取消与步骤停顿回归。真实核验只用非公开草稿或不提交的编辑页，不能额外公开测试。
