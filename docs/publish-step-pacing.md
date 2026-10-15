# 投稿页面内的步骤停顿

五个平台（抖音、视频号、快手、小红书、B站）在上传/文案/标签/声明等关键操作后停顿2–4秒，最终提交或保存草稿前停顿5–8秒。已有控件就绪、上传完成、声明核验和提交结果判断继续执行，停顿不代替这些检查，不改变平台间排队或增加重试次数。

运行中的每个新任务会读取Electron userData目录中的`publish-step-pacing.json`。Windows默认路径为`%APPDATA%/matrix-video/publish-step-pacing.json`。无需重启即可为下一个任务生效；进行中的任务使用启动时的配置快照。

```json
{
  "enabled": true,
  "stepMinMs": 2000,
  "stepMaxMs": 4000,
  "beforeSubmitMinMs": 5000,
  "beforeSubmitMaxMs": 8000
}
```

文件不存在时启用上述默认值。`enabled:false`关闭新增停顿，保留原来的页面等待。时间值须为0–60000的有限数字且下限不大于上限；格式错误或读取失败会在上传前停止任务、提示处理，不会静默忽略配置。日志`[publish-step]`记录平台、阶段和实际等待毫秒数，不记录登录凭证。

此功能只放缓操作，不承诺避免平台风控或验证。短信、扫码、验证码仍须账号本人处理。测试时使用草稿或离线夹具，禁止为了验证停顿重复公开发布内容。

基础回归：`node scripts/test-publish-step-pacing.js`。其它相关回归沿用`scripts/test-xhs-statement*.js`、`scripts/test-blbl-publish-verification.js`、`scripts/test-sph-ks-repair.js`与`scripts/test-puppeteer-cancel.js`。DOM/打包测试需准备esbuild与jsdom测试工具。
