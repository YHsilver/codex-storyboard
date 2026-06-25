const projectsView = document.querySelector("#projects-view");
const storyboardView = document.querySelector("#storyboard-view");
const projectsGrid = document.querySelector("#projects-grid");
const projectCardTemplate = document.querySelector("#project-card-template");
const body = document.querySelector("#shots-body");
const shotTemplate = document.querySelector("#shot-row-template");
const saveStatus = document.querySelector("#save-status");
const durationTotal = document.querySelector("#duration-total");
const selectPortal = document.querySelector("#select-portal");
const generateAllButton = document.querySelector("#generate-all");
const generateMaterialsButton = document.querySelector("#generate-materials");
const generateStoryboardsButton = document.querySelector("#generate-storyboards");
const projectDialog = document.querySelector("#project-dialog");
const projectForm = document.querySelector("#project-form");
const projectNameInput = document.querySelector("#project-name-input");
const ratioOptions = document.querySelector("#ratio-options");
const deleteDialog = document.querySelector("#delete-dialog");
const mediaUpload = document.querySelector("#media-upload");
const assetUpload = document.querySelector("#asset-upload");
const settingsDialog = document.querySelector("#settings-dialog");
const assetPickerDialog = document.querySelector("#asset-picker-dialog");
const videoConfirmDialog = document.querySelector("#video-confirm-dialog");
const projectDesignOption = document.querySelector("#project-design-option");
const projectDesignUpload = document.querySelector("#project-design-upload");
const designUpload = document.querySelector("#design-upload");
const designDialog = document.querySelector("#design-dialog");
const removeDesignDialog = document.querySelector("#remove-design-dialog");
const designMenu = document.querySelector("#design-menu");
const designMenuTrigger = document.querySelector("#design-menu-trigger");
const designMenuPopover = document.querySelector("#design-menu-popover");
const lightbox = document.querySelector("#lightbox");
const lightboxStage = document.querySelector("#lightbox-stage");
const toast = document.querySelector("#toast");
const themeButtons = document.querySelectorAll("[data-theme-toggle]");
const themeStorageKey = "codex-storyboard-theme";

const ratios = ["9:16", "16:9", "3:4", "4:3", "1:1"];
const selectOptions = {
  rollType: [
    { value: "A-ROLL", label: "A-ROLL" },
    { value: "B-ROLL", label: "B-ROLL" }
  ],
  mediaType: [
    { value: "image", label: "图片" },
    { value: "video", label: "视频" }
  ],
  generator: [
    { value: "image-gen", label: "Image Generation" },
    { value: "jimeng-cli", label: "即梦 CLI" }
  ]
};

let project = null;
let projects = [];
let settings = null;
let assetLibrary = [];
let saveTimer;
let savePromise = Promise.resolve();
let pollTimer;
let activeSelect;
let dialogMode = "create";
let editingProjectId = "";
let deletingProjectId = "";
let uploadShotId = "";
let lightboxShotId = "";
let toastTimer;
let pendingProjectDesign = null;
let designMenuPinned = false;
let designMenuCloseTimer;
let assetPickerShotId = "";
let assetUploadShotId = "";
let videoConfirmShotId = "";

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (!(options.body instanceof FormData)) headers["content-type"] = "application/json";
  const response = await fetch(path, { ...options, headers });
  const value = await response.json();
  if (!response.ok) {
    const error = new Error(value.error || "请求失败");
    error.status = response.status;
    throw error;
  }
  return value;
}

function currentTheme() {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

function updateThemeButtons() {
  const isDark = currentTheme() === "dark";
  themeButtons.forEach((button) => {
    button.setAttribute("aria-label", isDark ? "切换到浅色主题" : "切换到深色主题");
    button.title = isDark ? "切换到浅色主题" : "切换到深色主题";
  });
}

function toggleTheme() {
  const next = currentTheme() === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  try {
    localStorage.setItem(themeStorageKey, next);
  } catch {
    // 浏览器禁用本地存储时，本次切换仍然生效。
  }
  updateThemeButtons();
}

function showToast(message, type = "info") {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.dataset.type = type;
  toast.hidden = false;
  toastTimer = setTimeout(() => { toast.hidden = true; }, 2600);
}

function emptyShot() {
  return {
    rollType: "B-ROLL",
    mediaType: "image",
    duration: 5,
    visualPrompt: "",
    generator: "image-gen",
    inputAssetRefs: [],
    materialPrompt: "",
    materialAssetRefs: [],
    materialStatus: "idle",
    materialTaskId: "",
    materialError: "",
    storyboardPrompt: "",
    storyboardUrl: "",
    storyboardStatus: "idle",
    storyboardTaskId: "",
    storyboardError: "",
    mediaUrl: "",
    notes: "",
    generationStatus: "idle",
    generationTaskId: "",
    generationError: ""
  };
}

function formatDuration(seconds) {
  const total = Math.round(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function generationLabel(shot) {
  return {
    idle: "未生成",
    pending: "等待处理",
    processing: "生成中",
    ready: "已完成",
    failed: shot.generationError || "生成失败"
  }[shot.generationStatus] || "未生成";
}

function statusLabel(status, error = "") {
  return {
    idle: "未生成",
    pending: "等待处理",
    processing: "生成中",
    ready: "已完成",
    failed: error || "生成失败"
  }[status] || "未生成";
}

function generationButtonLabel(shot) {
  if (shot.generationStatus === "pending") return "取消队列";
  if (shot.generationStatus === "processing") return "生成中";
  if (!shot.visualPrompt.trim() && !["pending", "processing"].includes(shot.generationStatus)) {
    return "填写画面描述";
  }
  if (shot.generationStatus === "ready" || shot.generationStatus === "failed") return "重新生成";
  return shot.mediaType === "video" ? "生成视频" : "生成图片";
}

function canQueueStage(shot, stage) {
  if (!shot.visualPrompt.trim()) return false;
  if (stage === "materials") return !["pending", "processing", "ready"].includes(shot.materialStatus);
  if (stage === "storyboard") {
    return (shot.inputAssetRefs?.length > 0 || shot.materialAssetRefs?.length > 0) &&
      !["pending", "processing", "ready"].includes(shot.storyboardStatus);
  }
  return (
    Boolean(shot.storyboardUrl) &&
    !["pending", "processing", "ready"].includes(shot.videoStatus || shot.generationStatus)
  );
}

function updateBatchButton() {
  const materialCount = project?.shots.filter((shot) => canQueueStage(shot, "materials")).length || 0;
  const storyboardCount = project?.shots.filter((shot) => canQueueStage(shot, "storyboard")).length || 0;
  const nextVideo = project?.shots.find((shot) => canQueueStage(shot, "video"));
  generateMaterialsButton.disabled = materialCount === 0;
  generateMaterialsButton.textContent = materialCount > 0 ? `批量物料图 ${materialCount}` : "批量物料图";
  generateStoryboardsButton.disabled = storyboardCount === 0;
  generateStoryboardsButton.textContent = storyboardCount > 0 ? `批量故事板 ${storyboardCount}` : "批量故事板";
  generateAllButton.disabled = !nextVideo;
  generateAllButton.textContent = nextVideo ? "确认下个视频" : "逐条视频";
}

function projectPath(projectId) {
  return `/project/${encodeURIComponent(projectId)}`;
}

function currentProjectId() {
  return decodeURIComponent(location.pathname.match(/^\/project\/([^/]+)\/?$/)?.[1] || "");
}

function navigate(path) {
  history.pushState({}, "", path);
  route();
}

function openProjectDialog(mode, target = null) {
  dialogMode = mode;
  editingProjectId = target?.id || "";
  document.querySelector("#project-dialog-title").textContent =
    mode === "create" ? "新建项目" : "重命名项目";
  document.querySelector("#project-submit").textContent =
    mode === "create" ? "创建项目" : "保存名称";
  projectNameInput.value = target?.title || "";
  ratioOptions.hidden = mode === "rename";
  projectDesignOption.hidden = mode === "rename";
  if (mode === "create") {
    ratioOptions.querySelector('input[value="9:16"]').checked = true;
    pendingProjectDesign = null;
    projectDesignUpload.value = "";
    document.querySelector("#project-design-file-name").textContent = "未选择 DESIGN.md";
  }
  projectDialog.showModal();
  requestAnimationFrame(() => projectNameInput.focus());
}

function renderRatioOptions() {
  ratios.forEach((ratio) => {
    const label = document.createElement("label");
    label.className = "ratio-option";
    const input = document.createElement("input");
    input.type = "radio";
    input.name = "aspectRatio";
    input.value = ratio;
    const shapeStage = document.createElement("span");
    shapeStage.className = "ratio-shape-stage";
    const shape = document.createElement("span");
    shape.className = "ratio-shape";
    shape.style.aspectRatio = ratio.replace(":", " / ");
    const [ratioWidth, ratioHeight] = ratio.split(":").map(Number);
    if (ratioWidth <= ratioHeight) shape.style.height = "34px";
    else shape.style.width = "38px";
    shapeStage.append(shape);
    const text = document.createElement("strong");
    text.textContent = ratio;
    label.append(input, shapeStage, text);
    ratioOptions.append(label);
  });
}

async function loadProjects() {
  const result = await api("/api/projects");
  projects = result.projects;
  renderProjects();
}

async function loadSettingsAndAssets() {
  const [settingsResult, assetsResult] = await Promise.all([
    api("/api/settings"),
    api("/api/assets")
  ]);
  settings = settingsResult;
  assetLibrary = assetsResult.assets || [];
}

function renderProjects() {
  projectsGrid.replaceChildren();
  document.querySelector("#project-count").textContent = `${projects.length} 个项目`;

  projects.forEach((item) => {
    const card = projectCardTemplate.content.firstElementChild.cloneNode(true);
    card.dataset.id = item.id;
    card.style.setProperty("--project-ratio", item.aspectRatio.replace(":", " / "));
    card.querySelector(".project-card-title").textContent = item.title;
    card.querySelector(".project-meta").textContent =
      `${item.shotCount} 个镜头 · ${formatDuration(item.duration)} · ${item.aspectRatio}`;
    card.querySelector(".project-placeholder strong").textContent = item.aspectRatio;
    const image = card.querySelector(".project-cover img");
    if (item.coverUrl) {
      image.src = item.coverUrl;
      image.alt = `${item.title} 项目封面`;
      card.classList.add("has-cover");
    }
    card.querySelector(".project-open").addEventListener("click", () => navigate(projectPath(item.id)));
    card.querySelector(".rename-project").addEventListener("click", () => openProjectDialog("rename", item));
    card.querySelector(".delete-project").addEventListener("click", () => {
      deletingProjectId = item.id;
      document.querySelector("#delete-message").textContent =
        `“${item.title}”包含 ${item.shotCount} 个镜头。删除后项目和全部素材将无法恢复。`;
      deleteDialog.showModal();
    });
    projectsGrid.append(card);
  });

  const add = document.createElement("button");
  add.className = "new-project-card";
  add.type = "button";
  add.innerHTML = "<span>＋</span><strong>新建项目</strong><small>选择名称与画面比例</small>";
  add.addEventListener("click", () => openProjectDialog("create"));
  projectsGrid.append(add);
}

async function loadProject(projectId) {
  try {
    const [loadedProject] = await Promise.all([
      api(`/api/projects/${encodeURIComponent(projectId)}`),
      loadSettingsAndAssets()
    ]);
    project = loadedProject;
    renderStoryboard();
    startPolling();
  } catch (error) {
    showToast("项目不存在或已被删除", "error");
    history.replaceState({}, "", "/");
    await showProjectsView();
  }
}

function showProjectsView() {
  clearInterval(pollTimer);
  closeDesignMenu(true);
  project = null;
  projectsView.hidden = false;
  storyboardView.hidden = true;
  document.querySelector("#home-actions").hidden = false;
  document.querySelector("#storyboard-actions").hidden = true;
  document.title = "Codex 分镜台";
  return loadProjects();
}

function showStoryboardView(projectId) {
  projectsView.hidden = true;
  storyboardView.hidden = false;
  document.querySelector("#home-actions").hidden = true;
  document.querySelector("#storyboard-actions").hidden = false;
  return loadProject(projectId);
}

function route() {
  const projectId = currentProjectId();
  return projectId ? showStoryboardView(projectId) : showProjectsView();
}

function renderPreview(shot, index) {
  const frame = document.createElement("div");
  frame.className = "preview-frame";
  frame.style.aspectRatio = project.aspectRatio.replace(":", " / ");
  const [ratioWidth, ratioHeight] = project.aspectRatio.split(":").map(Number);
  if (ratioWidth < ratioHeight) frame.classList.add("portrait-preview");

  const preview = document.createElement("button");
  preview.type = "button";
  preview.className = "preview";
  frame.append(preview);

  if (!shot.mediaUrl && shot.storyboardUrl) {
    const image = document.createElement("img");
    image.src = shot.storyboardUrl;
    image.alt = shot.visualPrompt || `镜头 ${index + 1} 故事板图`;
    preview.append(image);
    const label = document.createElement("span");
    label.className = "media-kind";
    label.textContent = "STORY";
    preview.append(label);
    preview.disabled = true;
    return frame;
  }

  if (!shot.mediaUrl) {
    const empty = document.createElement("span");
    empty.className = "empty-preview";
    empty.textContent = shot.storyboardUrl ? "故事板图已完成" : "等待最终视频";
    preview.append(empty);
    preview.disabled = true;
    return frame;
  }

  const media = shot.mediaType === "video"
    ? Object.assign(document.createElement("video"), { muted: true, preload: "metadata" })
    : document.createElement("img");
  media.src = shot.mediaUrl;
  media.alt = shot.visualPrompt || `镜头 ${index + 1} 素材`;
  preview.append(media);

  const label = document.createElement("span");
  label.className = "media-kind";
  label.textContent = shot.mediaType === "video" ? "VIDEO" : "IMAGE";
  preview.append(label);
  preview.addEventListener("click", () => openLightbox(shot, index));

  if (shot.generationStatus !== "processing") {
    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "remove-media";
    removeButton.setAttribute("aria-label", "删除素材");
    removeButton.title = "删除素材";
    removeButton.textContent = "×";
    removeButton.addEventListener("click", (event) => {
      event.stopPropagation();
      deleteMedia(shot);
    });
    frame.append(removeButton);
  }
  return frame;
}

function chooseUpload(shotId) {
  uploadShotId = shotId;
  mediaUpload.value = "";
  mediaUpload.click();
}

async function uploadMedia(file) {
  if (!project || !uploadShotId || !file) return;
  const form = new FormData();
  form.append("file", file);
  saveStatus.textContent = "上传中…";
  try {
    project = await api(
      `/api/projects/${encodeURIComponent(project.id)}/shots/${encodeURIComponent(uploadShotId)}/media`,
      { method: "POST", body: form }
    );
    closeLightbox();
    renderStoryboard();
    saveStatus.textContent = "已保存";
    showToast("素材已上传");
  } catch (error) {
    saveStatus.textContent = "上传失败";
    showToast(error.message, "error");
  }
}

async function deleteMedia(shot) {
  saveStatus.textContent = "删除素材…";
  try {
    project = await api(
      `/api/projects/${encodeURIComponent(project.id)}/shots/${encodeURIComponent(shot.id)}/media`,
      { method: "DELETE" }
    );
    closeLightbox();
    renderStoryboard();
    saveStatus.textContent = "已保存";
    showToast("素材已删除");
  } catch (error) {
    saveStatus.textContent = "删除失败";
    showToast(error.message, "error");
  }
}

function assetById(assetId) {
  return assetLibrary.find((asset) => asset.id === assetId);
}

function renderAssetThumb(asset) {
  const thumb = document.createElement("span");
  thumb.className = "asset-thumb";
  if (asset?.type === "image" && asset.url) {
    const image = document.createElement("img");
    image.src = asset.url;
    image.alt = asset.name;
    thumb.append(image);
  } else {
    thumb.textContent = asset?.type === "audio" ? "音频" : "图片";
  }
  return thumb;
}

function renderAssetRefs(container, shot) {
  container.replaceChildren();
  const list = document.createElement("div");
  list.className = "asset-ref-list";
  const refs = Array.isArray(shot.inputAssetRefs) ? shot.inputAssetRefs : [];
  if (refs.length === 0) {
    const empty = document.createElement("span");
    empty.className = "empty-preview";
    empty.textContent = "未引用输入物料";
    list.append(empty);
  }
  refs.forEach((assetId) => {
    const asset = assetById(assetId);
    if (!asset) return;
    const item = document.createElement("div");
    item.className = "asset-ref-item";
    const meta = document.createElement("span");
    meta.className = "asset-meta";
    const name = document.createElement("strong");
    name.textContent = asset.name;
    const detail = document.createElement("span");
    detail.textContent = asset.type === "audio" ? "音频参考" : "图片参考";
    meta.append(name, detail);
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "remove-asset-ref";
    remove.textContent = "移除";
    remove.addEventListener("click", () => {
      shot.inputAssetRefs = refs.filter((id) => id !== assetId);
      renderAssetRefs(container, shot);
      queueSave();
    });
    item.append(renderAssetThumb(asset), meta, remove);
    list.append(item);
  });

  const actions = document.createElement("div");
  actions.className = "asset-ref-actions";
  const pick = document.createElement("button");
  pick.type = "button";
  pick.textContent = "选择";
  pick.addEventListener("click", () => openAssetPicker(shot.id));
  const upload = document.createElement("button");
  upload.type = "button";
  upload.textContent = "上传";
  upload.addEventListener("click", () => chooseAssetUpload(shot.id));
  actions.append(pick, upload);
  container.append(list, actions);
}

function chooseAssetUpload(shotId = "") {
  assetUploadShotId = shotId;
  assetUpload.value = "";
  assetUpload.click();
}

async function uploadAsset(file) {
  if (!file) return;
  const form = new FormData();
  form.append("file", file);
  try {
    const result = await api("/api/assets", { method: "POST", body: form });
    assetLibrary = result.assets || [];
    if (assetUploadShotId && project) {
      const shot = project.shots.find((item) => item.id === assetUploadShotId);
      if (shot) {
        shot.inputAssetRefs = [...new Set([...(shot.inputAssetRefs || []), result.asset.id])];
        queueSave();
      }
    }
    renderStoryboard();
    renderSettingsDialog();
    showToast("物料已添加");
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    assetUploadShotId = "";
  }
}

function openLightbox(shot, index) {
  lightboxShotId = shot.id;
  lightboxStage.replaceChildren();
  const media = shot.mediaType === "video"
    ? Object.assign(document.createElement("video"), { controls: true, autoplay: true })
    : document.createElement("img");
  media.src = shot.mediaUrl;
  media.alt = shot.visualPrompt || `镜头 ${index + 1} 素材`;
  lightboxStage.append(media);
  document.querySelector("#lightbox-caption").textContent =
    `镜头 ${String(index + 1).padStart(2, "0")} · ${shot.mediaType === "video" ? "视频" : "图片"}`;
  lightbox.hidden = false;
  document.body.classList.add("lightbox-open");
  document.querySelector("#lightbox-close").focus();
}

function closeLightbox() {
  if (lightbox.hidden) return;
  lightboxStage.querySelector("video")?.pause();
  lightbox.hidden = true;
  lightboxStage.replaceChildren();
  lightboxShotId = "";
  document.body.classList.remove("lightbox-open");
}

function selectLabel(field, value) {
  return selectOptions[field].find((option) => option.value === value)?.label || value;
}

function closeSelect({ restoreFocus = false } = {}) {
  if (!activeSelect) return;
  activeSelect.menu.remove();
  activeSelect.trigger.setAttribute("aria-expanded", "false");
  if (restoreFocus) activeSelect.trigger.focus();
  activeSelect = null;
}

function positionMenu(trigger, menu) {
  const rect = trigger.getBoundingClientRect();
  const gap = 5;
  const roomBelow = window.innerHeight - rect.bottom;
  const top = roomBelow >= menu.offsetHeight + gap
    ? rect.bottom + gap
    : Math.max(8, rect.top - menu.offsetHeight - gap);
  menu.style.left = `${Math.min(rect.left, window.innerWidth - menu.offsetWidth - 8)}px`;
  menu.style.top = `${top}px`;
  menu.style.width = `${Math.max(rect.width, 150)}px`;
}

function openSelect(trigger, field, shot, onChange) {
  if (activeSelect?.trigger === trigger) return closeSelect({ restoreFocus: true });
  closeSelect();
  const menu = document.createElement("div");
  menu.className = "select-menu";
  menu.setAttribute("role", "listbox");
  menu.setAttribute("aria-label", trigger.getAttribute("aria-label"));
  const options = field === "generator" && shot.mediaType === "video"
    ? selectOptions.generator.filter((option) => option.value === "jimeng-cli")
    : selectOptions[field];

  options.forEach((option, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "select-option";
    button.setAttribute("role", "option");
    button.setAttribute("aria-selected", String(option.value === shot[field]));
    button.dataset.index = String(index);
    button.textContent = option.label;
    button.addEventListener("click", () => {
      onChange(option.value);
      closeSelect({ restoreFocus: true });
    });
    button.addEventListener("keydown", (event) => {
      if (event.key === "Escape") return closeSelect({ restoreFocus: true });
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const next = event.key === "ArrowDown"
          ? Math.min(index + 1, options.length - 1)
          : Math.max(index - 1, 0);
        menu.querySelector(`[data-index="${next}"]`)?.focus();
      }
    });
    menu.append(button);
  });

  selectPortal.append(menu);
  trigger.setAttribute("aria-expanded", "true");
  activeSelect = { trigger, menu };
  positionMenu(trigger, menu);
  menu.querySelector('[aria-selected="true"]')?.focus();
}

function updateSelectTrigger(trigger, field, value) {
  const label = trigger.querySelector(".select-value");
  label.className = `select-value ${
    field === "rollType" ? (value === "A-ROLL" ? "roll-a" : "roll-b") : ""
  }`;
  label.textContent = selectLabel(field, value);
}

function renderSelect(container, field, shot, onChange) {
  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "select-trigger";
  trigger.setAttribute("aria-haspopup", "listbox");
  trigger.setAttribute("aria-expanded", "false");
  trigger.setAttribute("aria-label", {
    rollType: "镜头类型",
    mediaType: "媒体类型",
    generator: "生成方式"
  }[field]);
  const value = document.createElement("span");
  value.className = `select-value ${
    field === "rollType" ? (shot[field] === "A-ROLL" ? "roll-a" : "roll-b") : ""
  }`;
  value.textContent = selectLabel(field, shot[field]);
  const chevron = document.createElement("span");
  chevron.className = "select-chevron";
  trigger.append(value, chevron);
  const activate = () => openSelect(trigger, field, shot, (nextValue) => {
    shot[field] = nextValue;
    updateSelectTrigger(trigger, field, nextValue);
    onChange(field);
  });
  trigger.addEventListener("click", activate);
  trigger.addEventListener("keydown", (event) => {
    if (["ArrowDown", "Enter", " "].includes(event.key)) {
      event.preventDefault();
      activate();
    }
  });
  container.replaceChildren(trigger);
}

function updateSummary() {
  durationTotal.textContent = formatDuration(
    project.shots.reduce((sum, shot) => sum + Number(shot.duration || 0), 0)
  );
}

function queueSave() {
  saveStatus.textContent = "保存中…";
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    savePromise = saveProject();
  }, 450);
}

async function flushSave() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
    savePromise = saveProject();
  }
  await savePromise;
}

async function saveProject() {
  try {
    const saved = await api(`/api/projects/${encodeURIComponent(project.id)}`, {
      method: "PUT",
      body: JSON.stringify(project)
    });
    project.updatedAt = saved.updatedAt;
    saveStatus.textContent = "已保存";
  } catch (error) {
    saveStatus.textContent = "保存失败";
    showToast(error.message, "error");
  }
}

function renderStoryboard() {
  closeSelect();
  document.title = `${project.title} · Codex 分镜台`;
  document.querySelector("#project-title").textContent = project.title;
  document.querySelector("#project-ratio").textContent = project.aspectRatio;
  renderDesignState();
  document.documentElement.style.setProperty("--preview-ratio", project.aspectRatio.replace(":", " / "));
  body.replaceChildren();

  project.shots.forEach((shot, index) => {
    const row = shotTemplate.content.firstElementChild.cloneNode(true);
    row.dataset.id = shot.id;
    row.querySelector(".index-cell").textContent = String(index + 1).padStart(2, "0");

    row.querySelectorAll("[data-field]").forEach((control) => {
      const field = control.dataset.field;
      control.value = shot[field];
      control.addEventListener("input", () => {
        shot[field] = field === "duration" ? Number(control.value) : control.value;
        updateSummary();
        if (field === "visualPrompt") {
          updateBatchButton();
          renderPipelineControls(row.querySelector(".generation-controls"), shot);
        }
        queueSave();
      });
    });

    row.querySelectorAll("[data-select-field]").forEach((container) => {
      const field = container.dataset.selectField;
      renderSelect(container, field, shot, (changedField) => {
        if (changedField === "mediaType") {
          shot.generator = shot.mediaType === "video" ? "jimeng-cli" : "image-gen";
          renderStoryboard();
        }
        if (changedField === "generator") renderStoryboard();
        queueSave();
      });
    });

    if (shot.mediaType === "video" && shot.generator !== "jimeng-cli") shot.generator = "jimeng-cli";
    renderAssetRefs(row.querySelector(".asset-ref-cell"), shot);
    row.querySelector(".preview-slot").append(renderPreview(shot, index));
    renderPipelineControls(row.querySelector(".generation-controls"), shot);

    row.querySelector(".delete-shot").addEventListener("click", async () => {
      await api(
        `/api/projects/${encodeURIComponent(project.id)}/shots/${encodeURIComponent(shot.id)}`,
        { method: "DELETE" }
      );
      project.shots.splice(index, 1);
      renderStoryboard();
    });
    body.append(row);
  });

  updateSummary();
  updateBatchButton();
}

function renderDesignState() {
  const hasDesign = Boolean(project?.hasDesign);
  designMenu.dataset.active = String(hasDesign);
  document.querySelector("#design-status").textContent =
    hasDesign ? "已配置视觉规范" : "无视觉规范";
  document.querySelector("#design-description").textContent = hasDesign
    ? "生成素材时自动应用"
    : "生成素材时不应用统一视觉规范";
  document.querySelector("#view-design").hidden = !hasDesign;
  document.querySelector("#remove-design").hidden = !hasDesign;
  document.querySelector("#import-design").textContent = hasDesign
    ? "替换 DESIGN.md"
    : "导入 DESIGN.md";
}

function renderSettingsDialog() {
  if (!settings) return;
  document.querySelector("#setting-image-model").value = settings.jimeng.imageModel;
  document.querySelector("#setting-video-model").value = settings.jimeng.videoModel;
  document.querySelector("#setting-image-resolution").value = settings.jimeng.imageResolution;
  document.querySelector("#setting-video-resolution").value = settings.jimeng.videoResolution;
  document.querySelector("#setting-queue").value = settings.jimeng.queue || "";
  document.querySelector("#setting-poll").value = settings.jimeng.pollSeconds;
  document.querySelector("#setting-session").value = settings.jimeng.sessionStrategy;
  document.querySelector("#setting-fixed-prefix").value = settings.promptTemplates.fixedPrefix;
  document.querySelector("#setting-reference-template").value = settings.promptTemplates.referenceTemplate;

  const list = document.querySelector("#asset-library-list");
  list.replaceChildren();
  if (assetLibrary.length === 0) {
    const empty = document.createElement("p");
    empty.className = "delete-message";
    empty.textContent = "暂无物料。";
    list.append(empty);
    return;
  }
  assetLibrary.forEach((asset) => {
    const card = document.createElement("article");
    card.className = "asset-card";
    const fields = document.createElement("div");
    fields.className = "asset-card-fields";
    const name = Object.assign(document.createElement("input"), { value: asset.name, placeholder: "名称" });
    const personName = Object.assign(document.createElement("input"), { value: asset.personName || "", placeholder: "人物名" });
    const aliases = Object.assign(document.createElement("input"), { value: (asset.aliases || []).join(", "), placeholder: "别名，逗号分隔" });
    const tags = Object.assign(document.createElement("input"), { value: (asset.tags || []).join(", "), placeholder: "标签，逗号分隔" });
    [name, personName, aliases, tags].forEach((input) => {
      input.addEventListener("change", () => updateAsset(asset.id, {
        name: name.value,
        personName: personName.value,
        aliases: aliases.value.split(","),
        tags: tags.value.split(",")
      }));
    });
    fields.append(name, personName, aliases, tags);
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "delete-asset";
    remove.textContent = "删除";
    remove.addEventListener("click", () => deleteAsset(asset.id));
    card.append(renderAssetThumb(asset), fields, remove);
    list.append(card);
  });
}

async function openSettingsDialog() {
  await loadSettingsAndAssets();
  renderSettingsDialog();
  settingsDialog.showModal();
}

async function saveSettingsFromDialog() {
  const next = {
    jimeng: {
      imageModel: document.querySelector("#setting-image-model").value,
      videoModel: document.querySelector("#setting-video-model").value,
      imageResolution: document.querySelector("#setting-image-resolution").value,
      videoResolution: document.querySelector("#setting-video-resolution").value,
      queue: document.querySelector("#setting-queue").value,
      pollSeconds: Number(document.querySelector("#setting-poll").value),
      sessionStrategy: document.querySelector("#setting-session").value
    },
    promptTemplates: {
      fixedPrefix: document.querySelector("#setting-fixed-prefix").value,
      referenceTemplate: document.querySelector("#setting-reference-template").value
    }
  };
  settings = await api("/api/settings", { method: "PUT", body: JSON.stringify(next) });
  renderSettingsDialog();
  showToast("配置已保存");
}

async function updateAsset(assetId, update) {
  const result = await api(`/api/assets/${encodeURIComponent(assetId)}`, {
    method: "PATCH",
    body: JSON.stringify(update)
  });
  assetLibrary = result.assets || [];
  renderStoryboard();
}

async function deleteAsset(assetId) {
  const result = await api(`/api/assets/${encodeURIComponent(assetId)}`, { method: "DELETE" });
  assetLibrary = result.assets || [];
  if (project) project = await api(`/api/projects/${encodeURIComponent(project.id)}`);
  renderSettingsDialog();
  renderStoryboard();
  showToast("物料已删除");
}

function openAssetPicker(shotId) {
  assetPickerShotId = shotId;
  const shot = project.shots.find((item) => item.id === shotId);
  const selected = new Set(shot?.inputAssetRefs || []);
  const list = document.querySelector("#asset-picker-list");
  list.replaceChildren();
  if (assetLibrary.length === 0) {
    const empty = document.createElement("p");
    empty.className = "delete-message";
    empty.textContent = "物料库为空，请先新增物料。";
    list.append(empty);
  }
  assetLibrary.forEach((asset) => {
    const label = document.createElement("label");
    label.className = "asset-picker-option";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = asset.id;
    checkbox.checked = selected.has(asset.id);
    const meta = document.createElement("span");
    meta.className = "asset-meta";
    const name = document.createElement("strong");
    name.textContent = asset.name;
    const detail = document.createElement("span");
    detail.textContent = [asset.personName, ...(asset.tags || [])].filter(Boolean).join(" · ") || asset.type;
    meta.append(name, detail);
    label.append(checkbox, renderAssetThumb(asset), meta);
    list.append(label);
  });
  assetPickerDialog.showModal();
}

function applyAssetPicker() {
  const shot = project.shots.find((item) => item.id === assetPickerShotId);
  if (!shot) return;
  shot.inputAssetRefs = [...document.querySelectorAll("#asset-picker-list input:checked")]
    .map((input) => input.value);
  assetPickerDialog.close();
  assetPickerShotId = "";
  renderStoryboard();
  queueSave();
}

function stageInfo(shot, stage) {
  if (stage === "materials") {
    return {
      status: shot.materialStatus || "idle",
      taskId: shot.materialTaskId || "",
      error: shot.materialError || "",
      label: "物料图",
      action: "生成物料"
    };
  }
  if (stage === "storyboard") {
    return {
      status: shot.storyboardStatus || "idle",
      taskId: shot.storyboardTaskId || "",
      error: shot.storyboardError || "",
      label: "故事板",
      action: "生成故事板"
    };
  }
  return {
    status: shot.videoStatus || shot.generationStatus || "idle",
    taskId: shot.videoTaskId || shot.generationTaskId || "",
    error: shot.videoError || shot.generationError || "",
    label: "视频",
    action: "生成视频"
  };
}

function stageButtonLabel(shot, stage) {
  const info = stageInfo(shot, stage);
  if (info.status === "pending") return "取消";
  if (info.status === "processing") return "生成中";
  if (info.status === "ready" || info.status === "failed") return `重生成${info.label}`;
  return info.action;
}

function renderPipelineControls(container, shot) {
  container.replaceChildren();
  ["materials", "storyboard", "video"].forEach((stage) => {
    const info = stageInfo(shot, stage);
    const row = document.createElement("div");
    row.className = "pipeline-stage";
    row.dataset.stage = stage;

    const status = document.createElement("span");
    status.className = "generation-status";
    status.dataset.status = info.status;
    status.title = info.error;
    status.textContent = `${info.label}：${statusLabel(info.status, info.error)}`;

    const button = document.createElement("button");
    button.className = "generate-shot";
    button.type = "button";
    button.textContent = stageButtonLabel(shot, stage);
    button.dataset.action = info.status === "pending" ? "cancel" : "generate";
    button.disabled =
      info.status === "processing" ||
      !shot.visualPrompt.trim() ||
      (stage === "storyboard" && !(shot.inputAssetRefs?.length || shot.materialAssetRefs?.length)) ||
      (stage === "video" && !shot.storyboardUrl);
    button.addEventListener("click", () => {
      if (info.status === "pending") return cancelGeneration({ generationTaskId: info.taskId });
      if (stage === "video") return confirmVideoGeneration(shot);
      return queueGeneration(
        [shot.id],
        info.status === "ready" || info.status === "failed",
        { stage }
      );
    });

    row.append(status, button);
    container.append(row);
  });
}

function openDesignMenu() {
  clearTimeout(designMenuCloseTimer);
  designMenuPopover.hidden = false;
  designMenuTrigger.setAttribute("aria-expanded", "true");
}

function closeDesignMenu(force = false) {
  clearTimeout(designMenuCloseTimer);
  if (designMenuPinned && !force) return;
  designMenuPinned = false;
  designMenuPopover.hidden = true;
  designMenuTrigger.setAttribute("aria-expanded", "false");
}

function scheduleDesignMenuClose() {
  clearTimeout(designMenuCloseTimer);
  if (designMenuPinned) return;
  designMenuCloseTimer = setTimeout(() => closeDesignMenu(), 100);
}

async function uploadProjectDesign(projectId, file) {
  const form = new FormData();
  form.append("file", file);
  return api(`/api/projects/${encodeURIComponent(projectId)}/design`, {
    method: "POST",
    body: form
  });
}

async function importCurrentDesign(file) {
  if (!project || !file) return;
  const replacing = project.hasDesign;
  saveStatus.textContent = replacing ? "替换视觉规范…" : "导入视觉规范…";
  try {
    project = await uploadProjectDesign(project.id, file);
    renderDesignState();
    saveStatus.textContent = "已保存";
    showToast(replacing ? "视觉规范已更新" : "视觉规范已导入");
  } catch (error) {
    saveStatus.textContent = "导入失败";
    showToast(error.message, "error");
  }
}

async function viewCurrentDesign() {
  try {
    const result = await api(`/api/projects/${encodeURIComponent(project.id)}/design`);
    document.querySelector("#design-content").textContent = result.content;
    designDialog.showModal();
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function removeCurrentDesign() {
  try {
    project = await api(`/api/projects/${encodeURIComponent(project.id)}/design`, {
      method: "DELETE"
    });
    removeDesignDialog.close();
    renderDesignState();
    saveStatus.textContent = "已保存";
    showToast("视觉规范已移除");
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function cancelGeneration(shot) {
  saveStatus.textContent = "取消生成任务…";
  try {
    const result = await api(
      `/api/generation/tasks/${encodeURIComponent(shot.generationTaskId)}/cancel`,
      { method: "POST", body: JSON.stringify({}) }
    );
    project = result.project;
    saveStatus.textContent = "已取消生成任务";
    renderStoryboard();
  } catch (error) {
    project = await api(`/api/projects/${encodeURIComponent(project.id)}`);
    renderStoryboard();
    if (error.status === 409) {
      saveStatus.textContent = "任务已开始生成";
      showToast("任务已被 Codex 领取，无法取消", "error");
      return;
    }
    saveStatus.textContent = "取消失败";
    showToast(error.message, "error");
  }
}

function confirmVideoGeneration(shot) {
  videoConfirmShotId = shot.id;
  document.querySelector("#video-confirm-message").textContent =
    `即将提交镜头 ${project.shots.indexOf(shot) + 1} 的视频生成任务。会同时引用物料图和故事板图，视频任务会消耗额度，且每次只能提交一个。`;
  videoConfirmDialog.showModal();
}

async function queueGeneration(shotIds, force = false, options = {}) {
  saveStatus.textContent = "提交生成任务…";
  try {
    await flushSave();
    const result = await api("/api/generation/tasks", {
      method: "POST",
      body: JSON.stringify({
        projectId: project.id,
        shotIds,
        force,
        stage: options.stage || "video",
        videoConfirmed: options.videoConfirmed === true
      })
    });
    project = result.project;
    saveStatus.textContent = result.queued.length > 0
      ? `已提交 ${result.queued.length} 个生成任务`
      : "任务已在队列或生成中";
    renderStoryboard();
  } catch (error) {
    saveStatus.textContent = "提交失败";
    showToast(error.message, "error");
  }
}

async function addShot() {
  project = await api(`/api/projects/${encodeURIComponent(project.id)}/shots`, {
    method: "POST",
    body: JSON.stringify(emptyShot())
  });
  renderStoryboard();
  body.lastElementChild?.scrollIntoView({ behavior: "smooth", block: "center" });
}

function startPolling() {
  clearInterval(pollTimer);
  pollTimer = setInterval(async () => {
    if (!project || saveStatus.textContent === "保存中…") return;
    try {
      const remote = await api(`/api/projects/${encodeURIComponent(project.id)}`);
      if (remote.updatedAt !== project.updatedAt) {
        project = remote;
        renderStoryboard();
      }
    } catch {
      clearInterval(pollTimer);
      history.replaceState({}, "", "/");
      await showProjectsView();
      showToast("当前项目已在其他窗口中删除", "error");
    }
  }, 1500);
}

renderRatioOptions();
updateThemeButtons();

themeButtons.forEach((button) => button.addEventListener("click", toggleTheme));
document.querySelector("#create-project").addEventListener("click", () => openProjectDialog("create"));
document.querySelector("#brand-home").addEventListener("click", () => navigate("/"));
document.querySelector("#back-home").addEventListener("click", () => navigate("/"));
document.querySelector("#open-settings").addEventListener("click", openSettingsDialog);
document.querySelector("#add-shot-top").addEventListener("click", addShot);
document.querySelector("#add-shot-bottom").addEventListener("click", addShot);

projectForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const title = projectNameInput.value.trim();
  if (!title) return projectNameInput.focus();

  if (dialogMode === "create") {
    const aspectRatio = new FormData(projectForm).get("aspectRatio");
    const created = await api("/api/projects", {
      method: "POST",
      body: JSON.stringify({ title, aspectRatio })
    });
    projectDialog.close();
    if (pendingProjectDesign) {
      try {
        await uploadProjectDesign(created.id, pendingProjectDesign);
      } catch (error) {
        navigate(projectPath(created.id));
        showToast(`项目已创建，但视觉规范导入失败：${error.message}`, "error");
        return;
      }
    }
    navigate(projectPath(created.id));
    return;
  }

  await api(`/api/projects/${encodeURIComponent(editingProjectId)}`, {
    method: "PATCH",
    body: JSON.stringify({ title })
  });
  projectDialog.close();
  await loadProjects();
});

document.querySelector("#confirm-delete").addEventListener("click", async (event) => {
  event.preventDefault();
  await api(`/api/projects/${encodeURIComponent(deletingProjectId)}`, { method: "DELETE" });
  deleteDialog.close();
  deletingProjectId = "";
  await loadProjects();
  showToast("项目已永久删除");
});

generateAllButton.addEventListener("click", async () => {
  const shot = project.shots.find((item) => canQueueStage(item, "video"));
  if (shot) confirmVideoGeneration(shot);
});
generateMaterialsButton.addEventListener("click", async () => {
  const shotIds = project.shots.filter((shot) => canQueueStage(shot, "materials")).map((shot) => shot.id);
  await queueGeneration(shotIds, true, { stage: "materials" });
});
generateStoryboardsButton.addEventListener("click", async () => {
  const shotIds = project.shots.filter((shot) => canQueueStage(shot, "storyboard")).map((shot) => shot.id);
  await queueGeneration(shotIds, true, { stage: "storyboard" });
});

mediaUpload.addEventListener("change", () => uploadMedia(mediaUpload.files?.[0]));
assetUpload.addEventListener("change", () => uploadAsset(assetUpload.files?.[0]));
document.querySelector("#choose-asset-upload").addEventListener("click", () => chooseAssetUpload(""));
document.querySelector("#save-settings").addEventListener("click", saveSettingsFromDialog);
document.querySelector("#apply-asset-picker").addEventListener("click", applyAssetPicker);
document.querySelector("#confirm-video-generation").addEventListener("click", async () => {
  const shot = project.shots.find((item) => item.id === videoConfirmShotId);
  videoConfirmDialog.close();
  videoConfirmShotId = "";
  if (!shot) return;
  await queueGeneration([shot.id], ["ready", "failed"].includes(shot.videoStatus || shot.generationStatus), {
    stage: "video",
    videoConfirmed: true
  });
});
document.querySelector("#choose-project-design").addEventListener("click", () => {
  projectDesignUpload.value = "";
  projectDesignUpload.click();
});
projectDesignUpload.addEventListener("change", () => {
  pendingProjectDesign = projectDesignUpload.files?.[0] || null;
  document.querySelector("#project-design-file-name").textContent =
    pendingProjectDesign ? "已选择 DESIGN.md" : "未选择 DESIGN.md";
});
document.querySelector("#import-design").addEventListener("click", () => {
  closeDesignMenu(true);
  designUpload.value = "";
  designUpload.click();
});
designUpload.addEventListener("change", () => importCurrentDesign(designUpload.files?.[0]));
document.querySelector("#view-design").addEventListener("click", () => {
  closeDesignMenu(true);
  viewCurrentDesign();
});
document.querySelector("#remove-design").addEventListener("click", () => {
  closeDesignMenu(true);
  removeDesignDialog.showModal();
});
document.querySelector("#confirm-remove-design").addEventListener("click", removeCurrentDesign);
designMenu.addEventListener("mouseenter", openDesignMenu);
designMenu.addEventListener("mouseleave", scheduleDesignMenuClose);
designMenuTrigger.addEventListener("click", () => {
  if (designMenuPinned) return closeDesignMenu(true);
  designMenuPinned = true;
  openDesignMenu();
});
document.querySelector("#lightbox-close").addEventListener("click", closeLightbox);
document.querySelector("#lightbox-upload").addEventListener("click", () => {
  if (lightboxShotId) chooseUpload(lightboxShotId);
});
lightbox.addEventListener("click", (event) => {
  if (event.target === lightbox || event.target === lightboxStage) closeLightbox();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !designMenuPopover.hidden) {
    closeDesignMenu(true);
    designMenuTrigger.focus();
  }
  if (event.key === "Escape" && !lightbox.hidden) closeLightbox();
  if (event.key === "Tab" && !lightbox.hidden) {
    const controls = [
      document.querySelector("#lightbox-close"),
      document.querySelector("#lightbox-upload")
    ];
    const index = controls.indexOf(document.activeElement);
    event.preventDefault();
    controls[(index + (event.shiftKey ? -1 : 1) + controls.length) % controls.length].focus();
  }
});
document.querySelectorAll("[data-close-dialog]").forEach((button) => {
  button.addEventListener("click", () => button.closest("dialog").close());
});
document.addEventListener("pointerdown", (event) => {
  if (!designMenuPopover.hidden && !designMenu.contains(event.target)) closeDesignMenu(true);
  if (!activeSelect) return;
  if (activeSelect.menu.contains(event.target) || activeSelect.trigger.contains(event.target)) return;
  closeSelect();
});
window.addEventListener("resize", () => closeSelect());
document.querySelector(".table-shell").addEventListener("scroll", () => closeSelect(), { passive: true });
window.addEventListener("popstate", route);

route();
