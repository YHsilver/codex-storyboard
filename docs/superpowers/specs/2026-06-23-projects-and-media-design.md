# 智能分镜台：多项目与本地素材设计

## 目标

在现有单项目分镜台基础上增加本地项目管理、手动素材上传和素材放大预览，同时保持当前原生前端与 Node 本地服务，不引入数据库或前端框架。

## 项目首页

根地址 `/` 默认显示项目首页。

首页支持：

- 新建项目
- 打开项目
- 重命名项目
- 删除项目

新建项目时填写：

- 项目名称
- 画面比例：`9:16`、`16:9`、`3:4`、`4:3`、`1:1`

项目卡片显示项目名称、画面比例、镜头数量、总时长和最近素材封面。没有素材时显示比例占位图。

删除项目时必须二次确认，并明确提示将永久删除项目及全部本地素材。确认后删除项目文件夹和项目索引记录。

## 项目存储

每个项目使用独立目录：

```text
data/
  projects.json
  projects/
    <project-id>/
      project.json
      media/
```

`projects.json` 保存项目索引和排序所需的摘要信息。完整镜头数据保存在对应的 `project.json` 中，素材只保存在对应项目的 `media/` 中。

现有 `data/storyboard.json` 及已有素材在首次启动时自动迁移为：

- 项目名称：`智能分镜台`
- 画面比例：`16:9`

迁移完成后不重复执行。

## 分镜台路由

项目页使用 `/project/<project-id>`。

顶部增加：

- 返回项目首页
- 当前项目名称
- 当前画面比例

原有镜头编辑、生成队列和批量生成能力保持不变。

## 项目比例

项目比例是项目级唯一设置，并用于：

- 素材预览框的显示比例
- 图片生成任务的目标比例
- HyperFrames 画布尺寸
- Remotion 画布尺寸
- 项目首页封面比例标识

生成任务必须包含 `projectId` 和 `aspectRatio`。MCP 领取任务和完成任务时使用 `projectId`，确保素材回填到正确项目。

## 手动素材上传

当镜头生成方式为“手动素材”时：

- 没有素材：点击空素材框或“本地上传”按钮打开文件选择器。
- 已有素材：按钮仍显示“重新上传”。
- 支持常用图片：PNG、JPEG、WebP、GIF。
- 支持常用视频：MP4、WebM、MOV。
- 上传后根据文件类型自动更新镜头的媒体类型。
- 新素材保存到当前项目的 `media/` 目录并回填预览。

第一版通过浏览器文件上传到本地 Node 服务，不依赖客户端绝对文件路径。

## 素材放大预览

点击已有图片或视频时，在当前分镜台上打开 Lightbox，不进行页面跳转：

- 使用覆盖当前页面的半透明深色遮罩。
- 原分镜台在遮罩后方仍隐约可见。
- 图片或视频居中完整显示，不裁切。
- 视频在弹层内提供原生播放控制。
- 点击遮罩空白区域、右上角关闭按钮或按 `Esc` 关闭。
- 底部浮动操作栏显示镜头信息和“重新上传”按钮。
- 弹层打开期间锁定页面滚动，并将键盘焦点留在弹层内。

## API

项目接口：

- `GET /api/projects`
- `POST /api/projects`
- `PATCH /api/projects/:projectId`
- `DELETE /api/projects/:projectId`
- `GET /api/projects/:projectId`
- `PUT /api/projects/:projectId`

镜头接口改为项目作用域：

- `POST /api/projects/:projectId/shots`
- `PATCH /api/projects/:projectId/shots/:shotId`
- `DELETE /api/projects/:projectId/shots/:shotId`
- `POST /api/projects/:projectId/shots/:shotId/media`

素材上传使用 `multipart/form-data`，服务端根据实际文件扩展名与 MIME 类型保存文件。

生成任务接口继续保留统一队列路径，但请求和响应必须包含 `projectId`：

- `GET /api/generation/tasks`
- `POST /api/generation/tasks`
- `POST /api/generation/tasks/:taskId/claim`
- `POST /api/generation/tasks/:taskId/complete`
- `POST /api/generation/tasks/:taskId/fail`

## 错误处理

- 不支持的文件类型：拒绝上传，并在页面显示明确错误。
- 上传失败：保留原素材，不覆盖项目数据。
- 删除项目失败：保留项目索引，不显示删除成功。
- 项目不存在：返回项目首页并提示项目已不存在。
- MCP 回填的项目或镜头不存在：任务失败，不把素材写入其他项目。

## 验收标准

1. 根地址能创建、打开、重命名和删除多个本地项目。
2. 现有三个镜头及已生成素材迁移后保持可用。
3. 每种项目比例都能正确改变素材预览框比例。
4. 手动素材可通过空预览框或按钮上传，并可重新上传替换。
5. 图片和视频点击后在当前页面 Lightbox 中放大查看。
6. 单镜头和批量生成任务携带正确的项目 ID 与比例。
7. 多项目同时存在时，生成素材不会回填到错误项目。
8. 删除项目后对应项目目录与素材被永久删除。

