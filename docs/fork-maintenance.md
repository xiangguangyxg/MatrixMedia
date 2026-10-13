# 个人 Fork 维护约定

本 Fork 用于维护 MatrixMedia 的本地发布修复，许可证沿用 GPL-2.0-only。此次代码与测试由 OpenAI Codex 辅助完成。

## 仓库与分支

- 个人仓库：`xiangguangyxg/MatrixMedia`。
- 上游仓库：`hanliang97/MatrixMedia`，本次修复基于提交 `2b416e229506d0191d620d955e6601eabe586f81`。
- `main` 保留同步上游的基线；本次修复使用 `fix/sph-ks-publish-verification`。后续工作在本 Fork 的修复分支进行，测试通过后再形成版本。
- 同步上游前先保存当前提交。合并到测试分支，处理冲突并重新运行相关回归；不要用强制重置覆盖修复分支。

## 本次修复与验证边界

输入框重新挂载时重新获取并核验文案；关闭已识别的编辑器引导/反馈遮挡；精确选择并核验 AI 声明，包括视频号英文选项。声明缺失或文本不匹配时停止。提交后的成功/失败提示和页面状态参与结果判断；终止性业务失败不自动重复上传。

快手 `--draft-test` 仅用于已明确允许丢弃的单文件测试：恢复后核验文案与 AI 声明，放弃测试视频，再刷新检查恢复入口消失。它不会公开发布。普通发布遇到未完成编辑会停止；不得将其他未完成作品当成测试视频清理。视频号不支持这个自动清理参数。

已通过：18 个离线页面场景和 12 项相关测试；快手真实草稿恢复核验与清理。尚未通过：修复版的快手正式公开发布、视频号实际草稿和正式发布。原安装保留，视频号测试通过前不替换。

## 回归检查

使用 Node.js 20.x 和上游的 Yarn 依赖。新增页面测试另需 `jsdom@24.1.3`；可在测试工作副本中执行 `npm install --no-save --package-lock=false --ignore-scripts jsdom@24.1.3`，不提交依赖目录或安装产物。`esbuild` 由原项目构建依赖提供。

按顺序执行以下脚本（`node scripts/<名称>.js`）：

1. `test-sph-ks-repair`
2. `test-ks-draft-test-args`
3. `test-publish-abnormal`
4. `test-publish-draft-args`
5. `test-cli-detect-argv`
6. `test-sph-creative-statement`
7. `test-publish-failure-queue`
8. `test-puppeteer-cancel`
9. `test-local-video-publish-bt2`
10. `test-sph-video-product`
11. `test-sph-video-drama`
12. `test-sph-video-series`

离线场景不会读取账号会话或连接平台；页面夹具无法代替线上验证。打包后检查 `cli publish --help`。线上先核对后台防止重复，测试草稿通过后再用下一条未发布原创验证正式发布。未知结果先查后台，不重复提交。

## 版本交付

每次保存问题、根因、验证结果和未验证部分；代码通过回归后构建独立程序并记录提交 SHA 和文件哈希。实际发布验证完成后再打版本标签或制作 Release。切换程序前备份原程序并核对固定路径、快捷方式和定时任务；不删除账号数据。

只提交源码、测试和维护文档。Cookie、会话、账户数据、发布素材、原始日志、个人截图、遥测密钥和本机绝对路径不上传。账号与素材留在本机。受限制网站的访问约束不会因 Fork、CLI 或程序替换而改变。
