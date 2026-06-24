# Codex 分镜台 MVP 设计

## 目标

验证一条最短闭环：

1. 用户在 Codex 对话中描述视频需求。
2. Codex 调用本地 API 创建分镜行。
3. 右侧栏网页实时展示分镜表格。
4. Codex 生成图片或视频后，将本地素材回填到对应镜头。

## 第一版范围

- 一行代表一个最终镜头。
- 支持手动新增、编辑、删除镜头。
- 支持 Codex 通过 HTTP API 批量创建和修改镜头。
- 支持图片和视频预览。
- 支持本地 JSON 持久化。
- 支持把本地素材文件复制到项目素材目录并回填。

不包含：

- 独立聊天框。
- 时间线剪辑。
- 在线协作和账户系统。
- 直接调用 Image Generation、HyperFrames、Remotion。
- 完整 MCP 插件封装。

## 字段

| 字段 | 说明 |
| --- | --- |
| `rollType` | `A-ROLL` 或 `B-ROLL` |
| `mediaType` | `image` 或 `video` |
| `duration` | 镜头时长，单位秒 |
| `dialogue` | 对应台词 |
| `visualPrompt` | 画面描述，同时作为生成提示词 |
| `generator` | `manual`、`image-gen`、`hyperframes`、`remotion` |
| `mediaUrl` | 回填后的素材地址 |
| `notes` | 人工备注 |

## API

- `GET /api/project`：读取整个项目。
- `PUT /api/project`：替换整个项目。
- `POST /api/shots`：新增一个或多个镜头。
- `PATCH /api/shots/:id`：修改一个镜头。
- `DELETE /api/shots/:id`：删除一个镜头。
- `POST /api/shots/:id/media`：复制本地素材并回填预览。

## 技术选择

- Node.js 原生 HTTP 服务。
- 原生 HTML、CSS、JavaScript。
- JSON 文件持久化。
- 不引入依赖，降低启动和迁移成本。

