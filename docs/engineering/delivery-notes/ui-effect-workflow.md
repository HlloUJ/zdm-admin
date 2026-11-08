# 效果图工作流交付记录

范围：2026-11-05 用户确认的效果图设计规则。业务页面、接口、数据与运行配置没有变更；原有 `operation-feedback-standard` 业务批次及预览保持原状。本规则任务使用独立工程 Worktree，不接管单活跃登记。

## 原始基准与首次失败

- 规则提交：`e5edc653abf8ce461688c33820b4f67c3b047744`。
- 原始快照：`7c8300a0eb0d4afebb086cb62bbb738705276cf5`，保护引用为 `refs/tags/zdm-accepted/ui-effect-workflow`；由主线已发布校验器保存，后续不重建。
- 首次本地校验错误：向要求完整 SHA 的接口传入 `HEAD`。修正为实际 SHA 后，校验原快照成功。
- [首次远程快照检查](https://github.com/HlloUJ/zdm-admin/actions/runs/41987888142)失败：PR 创建先于保护引用发布，原日志为 `couldn't find remote ref refs/tags/zdm-accepted/ui-effect-workflow`。这是交付顺序错误，不是业务差异或测试失败；该记录不能被后续绿灯替代。

## 纠正与后续验证

已发布原始保护引用，并使用准确提交校验其内容；不修改原始基准、验证器、保护策略、断言或测试重试次数。本工程记录形成新候选，后续必需门禁验证新候选，不重跑原工作流冒充首次成功。此记录属于工程交付证据，不改变已确认的五文件规则内容。

本地五文件格式、两个 Skill 的 YAML 元数据及相关本地文档链接检查通过。Skill 自带 Python 校验器因缺少 PyYAML 未能运行，改用项目现有 YAML 解析依赖完成元数据检查；未安装额外依赖。最终合并和远程检查结果以 [PR #83](https://github.com/HlloUJ/zdm-admin/pull/83) 的准确候选记录为准，本记录不预称交付成功。
