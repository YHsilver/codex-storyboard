---
name: process-storyboard-tasks
description: 处理待执行或可恢复的 Codex Storyboard 图片和视频生成任务。当用户要求生成分镜资产、处理分镜队列、生成全部镜头、生成指定分镜行、恢复中断的生成，或把 Image Generation / Jimeng CLI 输出写回本地分镜时使用。
---

# 处理 Codex Storyboard 任务

处理 `http://127.0.0.1:43218` 上的本地分镜队列。

## 必读参考

- 任一任务使用 `jimeng-cli` 时，在构建或运行 Dreamina 命令前必须阅读 `references/dreamina-cli.md`。

## 工作流程

1. 调用 `list_storyboard_generation_tasks`，传入 `status: "processing,pending"` 和 `includePrompt: false`。
2. 当 `canResume: true` 且存在 `jimengSubmitId` 时，优先恢复 processing 任务。查询当前 submit ID，并且只能使用本次下载到本地的当前文件完成任务。
3. 然后按阶段顺序处理 pending 任务：`materials`、`storyboard`、`video`。这些阶段不是硬依赖；如果后续阶段已入队，也应处理。
4. 在认领任务前，核验每个任务需要的能力：

   - `image-gen` 需要内置 Image Generation 工具。
   - `jimeng-cli` 需要本地 `dreamina` 命令。`dreamina -h`、`dreamina version` 和 `dreamina user_credit` 可用于能力检查。

5. 对选入批次的任务，在 claim/resume 前再次调用 `list_storyboard_generation_tasks`，传入 `taskId`、`includePrompt: true` 和当前状态，确保拿到完整的 prompt payload。
6. 每批最多并发处理 5 个任务。只有当前批次的每个任务都已完成、失败，或已记录为带 `jimengSubmitId` 的异步处理中状态后，才能开始新批次。
7. 生成 pending 任务前，调用 `claim_storyboard_generation_task`，传入 `workerId` 和合理的 `leaseSeconds`。如果认领失败，只跳过该任务。
8. 如果已认领任务有 `hasDesign: true`，在生成任何内容前，必须读取精确绝对路径 `designPath` 指向的完整 Markdown 文件。
9. 在存在 DESIGN.md 时，基于 `compiledPrompt`、`promptPrefix`、`referenceTemplate`、`inputAssets`、`subjectPairs`、`commandPlan` 和 DESIGN.md 构建最终 API prompt：

   - `compiledPrompt` 是给本 skill 的指令包，不一定是要原样发送给图片或视频 API 的文本。
   - 如果存在 `promptPrefix` 或 `promptTemplates.fixedPrefix`，将其逐字复制到最终 API prompt 的开头。
   - 将 `referenceTemplate` 视为强推荐格式。对视频任务，应尽量保留其结构、章节顺序、风格要求和负面控制。
   - 只能用 `@图片1`、`@音频1` 等标签引用图片和音频，并且必须严格匹配 `inputAssets` 顺序。
   - 使用 `subjectPairs` 绑定主体图片和音频。不要因为音频在 `inputAssets` 中位置相近，就把它附加到其他主体上。
   - 只有当 `inputAssets` 中存在当前镜头的 storyboard 图片时，才包含 storyboard 或 `【分镜】` 章节。
   - 不要读取图片/音频文件内容来理解参考素材。应使用文件名、资产名、用途、标签、镜头文本、主体备注和 DESIGN.md。

10. 按 `stage`、`generator` 和 `mediaType` 路由处理：

   - `materials`：只生成当前镜头缺失的素材参考。如果 `inputAssets` 中已有主体/人物参考，或阶段目标说明主体已存在，不要生成任何角色/人物/主体图片。如果阶段目标说明场景/背景缺失，生成干净的空镜/背景图，不能有人、主体、文字或水印。完成时使用 `mediaType: "image"`，并提供有用的 `assetName`、`tags` 或 `aliases`。
   - `storyboard`：只生成当前镜头的关键分镜帧。完成时使用 `mediaType: "image"`。
   - `video`：始终使用 `dreamina multimodal2video`，传入当前任务的图片/音频输入、最终 prompt、模型版本、时长、比例、视频分辨率、poll 值和输出目录。`--ratio` 值必须匹配 `aspectRatio`。
   - 对非视频 `image-gen` 任务，使用 Image Generation，遵守 `aspectRatio`，并在支持时把 `inputAssets` 作为参考。
   - 对非视频 `jimeng-cli` 任务，无图片输入时使用 `text2image`，有图片输入时使用 `image2image`。

11. 如果 Jimeng 返回已完成的本地文件，先验证该文件，再调用 `complete_storyboard_generation_task`。
12. 如果 Jimeng 返回带 `submit_id` 的 async/querying 状态，调用 `update_storyboard_generation_task` 写入 `jimengSubmitId`；之后通过查询同一个 submit ID 恢复，并用下载到本地的文件完成任务。
13. 如果生成或验证失败，调用 `fail_storyboard_generation_task` 并提供简洁原因。
14. 持续处理，直到没有可处理的 pending 任务或可恢复的 processing 任务。

## 输出位置

使用任务提供的精确绝对路径 `outputDir`。将下载的 Jimeng 输出和临时 prompt 文件放入该目录。MCP 完成工具会把最终图片或视频复制到 storyboard media 目录。

## 约束

- 在精确的本地文件完成视觉或技术验证前，不要将任务标记为完成。
- 不要用现有项目视频、之前的 `mediaUrl`、之前的 `mediaUrls` 或过期的 `jimengSubmitId` 完成视频任务。
- 保留 `projectId`、`aspectRatio`、`width`、`height` 和请求的视频 `duration`。
- 当 `hasDesign` 为 true 时，绝不能猜测、截断或只读取部分 `DESIGN.md`。
- 不要套用当前工作区或其他项目的 DESIGN.md。
- 报告 Jimeng 失败时，应包含确认过的命令、错误摘要、可用时的 CLI 版本，并提及 `~/.dreamina_cli/logs/` 下的日志。
