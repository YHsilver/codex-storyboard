# 即梦 CLI 使用说明

本文根据本机 `dreamina -h` 以及常用 `dreamina <subcommand> -h` 输出整理。

## 基础信息

`dreamina` 是即梦官方 AIGC CLI，用于登录、账号查询、任务查询和生成工作流。

基本流程：

```bash
dreamina login
dreamina text2image --prompt="a cat portrait"
dreamina query_result --submit_id=<submit_id> --download_dir=<output_dir>
```

所有生成操作都会消耗点数。生成任务是异步任务，大多数生成命令支持 `--poll`，用于提交后短时间轮询；如果未完成，再用 `query_result` 查询。

## 登录和账号

### 登录

```bash
dreamina login
dreamina login --headless
dreamina login checklogin --device_code=<device_code> --poll=30
```

- `dreamina login` 使用 OAuth Device Flow，会打印 `verification_uri`、`user_code`、`device_code`，并等待授权完成。
- `--headless` 只打印授权材料，不持续轮询。
- 本地登录状态有效时会复用现有状态。

### 退出和重新登录

```bash
dreamina logout
dreamina relogin
```

### 查询点数

```bash
dreamina user_credit
```

## 任务查询

### 查询单个异步任务

```bash
dreamina query_result --submit_id=<submit_id>
dreamina query_result --submit_id=<submit_id> --download_dir=<output_dir>
```

- `--submit_id`：任务提交后返回的任务 ID。
- `--download_dir`：将结果媒体下载到目标目录。

### 列出历史任务

```bash
dreamina list_task
dreamina list_task --gen_status=success
dreamina list_task --gen_task_type=<type> --limit=20 --offset=0
dreamina list_task --submit_id=<submit_id>
```

可用参数：

- `--gen_status`：按生成状态过滤。
- `--gen_task_type`：按任务类型过滤。
- `--limit`：返回数量，默认 20。
- `--offset`：分页偏移。
- `--submit_id`：按提交 ID 过滤。

## 会话

生成命令支持 `--session=<id>`，默认是 `0`。本项目当前策略是每次生成使用新会话，不在模型配置中暴露会话策略。

会话管理命令：

```bash
dreamina session create
dreamina session create "My Video Project"
dreamina session list
dreamina session ls -n 100
dreamina session search "Video"
dreamina session rename 10086 "New Project Name"
dreamina session rm 10086
```

说明：

- 会话用于组织创作历史。
- Session `0` 是默认会话，不能重命名或删除。
- 删除会话会把历史安全移动回默认会话。

## 图片生成

### 文生图：`text2image`

```bash
dreamina text2image \
  --prompt="a cat portrait" \
  --ratio=1:1 \
  --resolution_type=2k \
  --model_version=4.7 \
  --poll=30
```

参数：

- `--prompt`：生成提示词。
- `--ratio`：支持 `21:9`、`16:9`、`3:2`、`4:3`、`1:1`、`3:4`、`2:3`、`9:16`。
- `--resolution_type`：
  - `3.0`、`3.1` 支持 `1k`、`2k`。
  - `4.0`、`4.1`、`4.5`、`4.6`、`4.7`、`5.0` 支持 `2k`、`4k`。
- `--model_version`：支持 `3.0`、`3.1`、`4.0`、`4.1`、`4.5`、`4.6`、`4.7`、`5.0`。
- `--poll`：提交后轮询秒数，`0` 表示不轮询。

省略 `--model_version` 或 `--resolution_type` 时使用默认值。

### 图生图：`image2image`

```bash
dreamina image2image \
  --images ./input.png \
  --prompt="turn into watercolor" \
  --ratio=16:9 \
  --resolution_type=2k \
  --model_version=4.7 \
  --poll=30
```

参数：

- `--images`：本地输入图片路径，1 到 10 张。
- `--prompt`：编辑提示词。
- `--ratio`：同 `text2image`。
- `--resolution_type`：支持 `2k`、`4k`，不支持 `1k`。
- `--model_version`：支持 `4.0`、`4.1`、`4.5`、`4.6`、`4.7`、`5.0`。
- `--poll`：提交后轮询秒数。

注意：一次最多上传 10 张图片，否则可能导致生图失败。

### 图片放大：`image_upscale`

```bash
dreamina image_upscale \
  --image=./input.png \
  --resolution_type=4k \
  --poll=30
```

参数：

- `--image`：本地输入图片路径。
- `--resolution_type`：支持 `2k`、`4k`、`8k`。
- `--poll`：提交后轮询秒数。

注意：`2k` 非 VIP 可用，`4k` 和 `8k` 需要 VIP。

## 视频生成

Seedance 2.0 系列是 CLI 中重点视频模型。常见模型值：

- `seedance2.0`
- `seedance2.0fast`
- `seedance2.0_vip`
- `seedance2.0fast_vip`
- `seedance2.0mini`

本项目优先使用 `multimodal2video`，因为它支持图片、视频、音频等全能参考输入。

### 全能参考视频：`multimodal2video`

```bash
dreamina multimodal2video \
  --image ./storyboard.png \
  --image ./character.png \
  --audio ./music.mp3 \
  --prompt="turn this into a cinematic shot" \
  --model_version=seedance2.0 \
  --video_resolution=720p \
  --duration=5 \
  --ratio=16:9 \
  --poll=30
```

参数：

- `--image`：本地图片输入，可重复传入。
- `--video`：本地视频输入，可重复传入。
- `--audio`：本地音频输入，可重复传入。
- `--prompt`：可选，多模态编辑提示词。
- `--duration`：视频时长，支持 4 到 15 秒，默认 5。
- `--ratio`：支持 `1:1`、`3:4`、`16:9`、`4:3`、`9:16`、`21:9`。
- `--video_resolution`：
  - `seedance2.0_vip` 支持 `720p` 或 `1080p`。
  - 其他模型支持 `720p`。
- `--model_version`：支持 Seedance 2.0 系列和 `seedance2.0mini`。
- `--poll`：提交后轮询秒数。

限制：

- 至少需要一个 `--image` 或 `--video`。
- 输入限制：图片最多 9 个，视频最多 3 个，音频最多 3 个。
- 音频输入必须是 2 到 15 秒。
- 部分高内容安全风险模型首次使用前可能需要先在 Dreamina Web 端完成授权确认。

### 文生视频：`text2video`

```bash
dreamina text2video \
  --prompt="a cat running" \
  --model_version=seedance2.0fast \
  --video_resolution=720p \
  --duration=5 \
  --ratio=16:9 \
  --poll=30
```

参数：

- `--prompt`：生成提示词。
- `--duration`：4 到 15 秒，默认 5。
- `--ratio`：支持 `1:1`、`3:4`、`16:9`、`4:3`、`9:16`、`21:9`。
- `--video_resolution`：`seedance2.0_vip` 支持 `720p` 或 `1080p`，其他模型支持 `720p`。
- `--model_version`：默认 `seedance2.0fast`，支持 Seedance 2.0 系列和 `seedance2.0mini`。
- `--poll`：提交后轮询秒数。

### 图生视频：`image2video`

```bash
dreamina image2video \
  --image=./first.png \
  --prompt="camera push in" \
  --model_version=seedance2.0 \
  --video_resolution=720p \
  --duration=5 \
  --poll=30
```

参数：

- `--image`：本地首帧图片路径。
- `--prompt`：生成提示词。
- `--duration`：不同模型支持范围不同：
  - `3.0`、`3.0fast`、`3.0pro` 支持 3 到 10 秒。
  - `3.5pro` 支持 4 到 12 秒。
  - Seedance 2.0 系列和 `seedance2.0mini` 支持 4 到 15 秒。
- `--video_resolution`：`seedance2.0_vip` 支持 `720p` 或 `1080p`，其他模型支持 `720p`。
- `--model_version`：支持 `3.0`、`3.0fast`、`3.0pro`、`3.0_fast`、`3.0_pro`、`3.5pro`、`3.5_pro`、Seedance 2.0 系列和 `seedance2.0mini`。
- `--poll`：提交后轮询秒数。

说明：比例从输入图片推断，不能在该命令中设置 `--ratio`。

### 多帧视频：`multiframe2video`

```bash
dreamina multiframe2video \
  --images ./a.png,./b.png \
  --prompt="character turns around" \
  --duration=3 \
  --poll=30

dreamina multiframe2video \
  --images ./a.png,./b.png,./c.png \
  --transition-prompt="turn from A to B" \
  --transition-prompt="turn from B to C" \
  --transition-duration=3 \
  --transition-duration=3 \
  --poll=30
```

参数：

- `--images`：2 到 20 张本地图片。
- `--prompt`：仅适用于刚好 2 张图片的简写提示词。
- `--duration`：仅适用于刚好 2 张图片的简写转场时长，默认 3 秒。
- `--transition-prompt`：3 张及以上图片时使用；N 张图片需要 N-1 个转场提示。
- `--transition-duration`：N 张图片需要 N-1 个转场时长；省略时每段默认 3 秒。
- `--poll`：提交后轮询秒数。

限制：

- 每段时长限制为 0.5 到 8 秒。
- 总时长必须大于等于 2 秒。
- 比例从第一张图推断。
- 不支持覆盖 `model_version` 和 `video_resolution`。

### 首尾帧视频：`frames2video`

```bash
dreamina frames2video \
  --first=./start.png \
  --last=./end.png \
  --prompt="season changes" \
  --model_version=seedance2.0fast \
  --video_resolution=720p \
  --duration=5 \
  --poll=30
```

参数：

- `--first`：本地首帧图片。
- `--last`：本地尾帧图片。
- `--prompt`：生成提示词。
- `--duration`：
  - `3.0` 支持 3 到 10 秒。
  - `3.5pro` 支持 4 到 12 秒。
  - Seedance 2.0 系列和 `seedance2.0mini` 支持 4 到 15 秒。
- `--video_resolution`：`seedance2.0_vip` 支持 `720p` 或 `1080p`，其他模型支持 `720p`。
- `--model_version`：默认 `seedance2.0fast`，支持 `3.0`、`3.5pro`、Seedance 2.0 系列和 `seedance2.0mini`。
- `--poll`：提交后轮询秒数。

说明：比例从首帧图片推断。

## 本项目中的使用约定

- 物料图和故事板图是图片阶段，只使用图片模型配置。
- 视频阶段只使用视频模型配置。
- “即梦模型即队列”，不再维护单独队列字段。
- 每次生成使用新会话。
- 视频阶段优先使用 `dreamina multimodal2video`。
- 如果生成命令返回异步 `submit_id`，先记录 `jimengSubmitId`，后续用 `query_result --submit_id=... --download_dir=...` 下载结果。
