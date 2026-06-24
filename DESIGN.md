# Design System

## Direction

克制的桌面生产力工具。Light Theme 以白色内容面、浅灰表头、细分隔线和青色主操作构成；Dark Theme 使用深灰黑背景、低对比边框和相同的青色强调色。整体接近专业脚本编辑器，不使用营销页面结构。

## Typography

- 字体：系统无衬线字体栈。
- 应用标题：16px / 700。
- 表头：12px / 600。
- 正文和输入：13px / 400。
- 数字列使用等宽数字。

## Color

- Light 页面背景：中性浅灰；内容表面：白色。
- Dark 页面背景：近黑灰；内容表面：深灰；表头与浮层使用略亮一级的深灰。
- Light 主文字：近黑；Dark 主文字：柔和白。
- 次级文字在两种主题中均保持可读，但不抢占正文层级。
- 分隔线使用低对比中性色，Dark Theme 不使用纯白边框。
- 主操作与焦点：青色。
- A-ROLL：蓝色；B-ROLL：橙色；素材就绪：绿色。
- 图片和视频素材不应用主题滤镜或颜色变换。

## Layout

- 顶栏固定为 64px。
- 顶栏提供 Light / Dark 切换按钮。
- 表格紧接顶栏，不设置宣传区。
- 表格区域独立滚动，表头固定在表格容器顶部。
- 使用 4px 基础间距系统。

## Components

- 按钮：8px 圆角，清晰 hover、active、focus-visible 状态。
- 自定义下拉：按钮触发，弹层通过 fixed portal 挂载到 body。
- 文本域：透明默认态，hover 出现浅灰底，focus 显示青色边框。
- 素材预览：8px 圆角，16:9 画面，空状态简短。
- 生成按钮：`pending` 状态显示“取消队列”并保持可点击；`processing` 状态禁用。
- 主题按钮：点击后立即切换全站主题，并将选择保存到浏览器本地。

## Theme

- 默认使用 Light Theme。
- 用户选择通过 `localStorage` 保存，对所有项目和页面生效。
- 页面脚本加载前应用已保存主题，避免 Light 到 Dark 的闪烁。
- Dark Theme 覆盖项目首页、分镜表格、输入控件、自定义下拉、原生 Dialog、上传区域、Toast 和 Lightbox 操作栏。
- Lightbox 遮罩继续使用半透明深色；主题只调整控制按钮和说明文字。

## Motion

仅用于下拉菜单出现和保存状态，时长 120–180ms。遵循 `prefers-reduced-motion`。
