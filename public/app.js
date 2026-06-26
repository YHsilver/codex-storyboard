const projectsView = document.querySelector("#projects-view");
const storyboardView = document.querySelector("#storyboard-view");
const projectsGrid = document.querySelector("#projects-grid");
const projectCardTemplate = document.querySelector("#project-card-template");
const body = document.querySelector("#shots-body");
const tableShell = document.querySelector(".table-shell");
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
const assetLibraryDialog = document.querySelector("#asset-library-dialog");
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
let uploadStage = "video";
let lightboxShotId = "";
let lightboxStageName = "video";
let toastTimer;
let pendingProjectDesign = null;
let designMenuPinned = false;
let designMenuCloseTimer;
let assetPickerShotId = "";
let assetPickerStage = "materials";
let assetUploadShotId = "";
let assetUploadKind = "material";
let assetUploadMeta = {};
let videoConfirmShotId = "";
let videoConfirmShotIds = [];
let dirtyShotVersion = 0;
const dirtyShotFields = new Map();

function markShotDirty(shot, fields) {
  if (!shot?.id) return;
  const names = Array.isArray(fields) ? fields : [fields];
  const dirty = dirtyShotFields.get(shot.id) || new Map();
  names.filter(Boolean).forEach((field) => {
    dirtyShotVersion += 1;
    dirty.set(field, dirtyShotVersion);
  });
  dirtyShotFields.set(shot.id, dirty);
}

function clearSavedShotDirty(snapshot) {
  snapshot.forEach((fields, shotId) => {
    const dirty = dirtyShotFields.get(shotId);
    if (!dirty) return;
    fields.forEach((version, field) => {
      if (dirty.get(field) === version) dirty.delete(field);
    });
    if (dirty.size === 0) dirtyShotFields.delete(shotId);
  });
}

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
    mediaType: "video",
    duration: 5,
    visualPrompt: "",
    generator: "jimeng-cli",
    configKey: "",
    materialConfigKey: "",
    storyboardConfigKey: "",
    videoConfigKey: "",
    inputAssetRefs: [],
    subjectAssetRefs: [],
    materialPrompt: "",
    materialAssetRefs: [],
    materialStatus: "idle",
    materialTaskId: "",
    materialError: "",
    storyboardPrompt: "",
    storyboardUrl: "",
    storyboardUrls: [],
    storyboardStatus: "idle",
    storyboardTaskId: "",
    storyboardError: "",
    mediaUrl: "",
    mediaUrls: [],
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

function mediaFileNameFromUrl(url) {
  const value = String(url || "");
  if (!value) return "";
  try {
    const parsed = new URL(value, location.origin);
    return decodeURIComponent(parsed.pathname.split("/").filter(Boolean).at(-1) || "");
  } catch {
    const clean = value.split(/[?#]/)[0];
    return decodeURIComponent(clean.split("/").filter(Boolean).at(-1) || "");
  }
}

function setLightboxCaption(label, fileName = "") {
  const caption = document.querySelector("#lightbox-caption");
  caption.replaceChildren();
  const labelNode = document.createElement("span");
  labelNode.className = "lightbox-caption-label";
  labelNode.textContent = label;
  caption.append(labelNode);
  if (!fileName) return;
  const fileNode = document.createElement("span");
  fileNode.className = "lightbox-file-name";
  fileNode.textContent = fileName;
  fileNode.title = fileName;
  caption.append(fileNode);
}

function tableScrollPosition() {
  if (!tableShell) return null;
  return {
    top: tableShell.scrollTop,
    left: tableShell.scrollLeft
  };
}

function restoreTableScroll(position) {
  if (!position || !tableShell) return;
  requestAnimationFrame(() => {
    tableShell.scrollTop = position.top;
    tableShell.scrollLeft = position.left;
  });
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

function canQueueStage(shot, stage) {
  if (!shot.visualPrompt.trim()) return false;
  if (stage === "materials") return !["pending", "processing", "ready"].includes(shot.materialStatus);
  if (stage === "storyboard") return !["pending", "processing", "ready"].includes(shot.storyboardStatus);
  return !["pending", "processing", "ready"].includes(shot.videoStatus || shot.generationStatus);
}

function updateBatchButton() {
  const materialCount = project?.shots.filter((shot) => canQueueStage(shot, "materials")).length || 0;
  const storyboardCount = project?.shots.filter((shot) => canQueueStage(shot, "storyboard")).length || 0;
  const videoCount = project?.shots.filter((shot) => canQueueStage(shot, "video")).length || 0;
  const pendingMaterials = project?.shots.filter((shot) => shot.materialStatus === "pending").length || 0;
  const pendingStoryboards = project?.shots.filter((shot) => shot.storyboardStatus === "pending").length || 0;
  const pendingVideos = project?.shots.filter((shot) => (shot.videoStatus || shot.generationStatus) === "pending").length || 0;
  generateMaterialsButton.dataset.action = pendingMaterials > 0 ? "cancel" : "generate";
  generateMaterialsButton.disabled = pendingMaterials === 0 && materialCount === 0;
  generateMaterialsButton.textContent = pendingMaterials > 0 ? `取消物料队列 ${pendingMaterials}` : (materialCount > 0 ? `批量物料图 ${materialCount}` : "批量物料图");
  generateStoryboardsButton.dataset.action = pendingStoryboards > 0 ? "cancel" : "generate";
  generateStoryboardsButton.disabled = pendingStoryboards === 0 && storyboardCount === 0;
  generateStoryboardsButton.textContent = pendingStoryboards > 0 ? `取消故事板队列 ${pendingStoryboards}` : (storyboardCount > 0 ? `批量故事板 ${storyboardCount}` : "批量故事板");
  generateAllButton.dataset.action = pendingVideos > 0 ? "cancel" : "generate";
  generateAllButton.disabled = pendingVideos === 0 && videoCount === 0;
  generateAllButton.textContent = pendingVideos > 0 ? `取消视频队列 ${pendingVideos}` : (videoCount > 0 ? `批量视频 ${videoCount}` : "批量视频");
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

async function refreshAssetLibrary() {
  const result = await api("/api/assets");
  assetLibrary = result.assets || [];
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
    dirtyShotFields.clear();
    if (project) renderStoryboard();
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
  document.title = "智能分镜台";
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

function renderStagePreview({ url, stage, shot, index, assetId = "", deletable = true }) {
  const frame = document.createElement("div");
  frame.className = "preview-frame";
  frame.style.aspectRatio = project.aspectRatio.replace(":", " / ");
  const [ratioWidth, ratioHeight] = project.aspectRatio.split(":").map(Number);
  if (ratioWidth < ratioHeight) frame.classList.add("portrait-preview");

  const preview = document.createElement("button");
  preview.type = "button";
  preview.className = "preview";
  frame.append(preview);

  if (!url) {
    const empty = document.createElement("span");
    empty.className = "empty-preview";
    empty.textContent = {
      materials: "未生成物料图",
      storyboard: "未生成故事板",
      video: "未生成视频"
    }[stage];
    preview.append(empty);
    preview.disabled = true;
    return frame;
  }

  const media = stage === "video"
    ? Object.assign(document.createElement("video"), { muted: true, preload: "metadata" })
    : document.createElement("img");
  media.src = url;
  media.alt = shot.visualPrompt || `镜头 ${index + 1}`;
  preview.append(media);

  const label = document.createElement("span");
  label.className = "media-kind";
  label.textContent = { materials: "MAT", storyboard: "STORY", video: "VIDEO" }[stage];
  preview.append(label);
  preview.addEventListener("click", () => openLightbox(shot, index, stage, url));

  if (deletable && !["processing"].includes(stageInfo(shot, stage).status)) {
    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "remove-media";
    removeButton.setAttribute("aria-label", "删除产物");
    removeButton.title = "删除产物";
    removeButton.textContent = "×";
    removeButton.addEventListener("click", (event) => {
      event.stopPropagation();
      deleteStageMedia(shot, stage, assetId || url);
    });
    frame.append(removeButton);
  }
  return frame;
}

function renderMaterialOutputs(container, shot, index) {
  const refs = Array.isArray(shot.materialAssetRefs) ? shot.materialAssetRefs : [];
  const list = document.createElement("div");
  list.className = "stage-output-list";
  if (refs.length > 1) list.classList.add("is-gallery");
  if (refs.length === 0) {
    list.append(renderStagePreview({ stage: "materials", shot, index }));
  }
  refs.forEach((assetId) => {
    const asset = assetById(assetId);
    if (!asset) return;
    list.append(renderStagePreview({ url: asset.url, stage: "materials", shot, index, assetId }));
  });
  container.append(list);
}

function stageUrls(shot, stage) {
  if (stage === "storyboard") return [...new Set([shot.storyboardUrl, ...(shot.storyboardUrls || [])].filter(Boolean))];
  if (stage === "video") return [...new Set([shot.mediaUrl, ...(shot.mediaUrls || [])].filter(Boolean))];
  return [];
}

function renderMediaOutputs(container, shot, index, stage) {
  const list = document.createElement("div");
  list.className = "stage-output-list";
  const asset = stage === "storyboard" ? storyboardAsset(shot) : null;
  const urls = stageUrls(shot, stage);
  const outputCount = urls.length + (asset?.url && !shot.storyboardUrl ? 1 : 0);
  if (outputCount > 1) list.classList.add("is-gallery");
  if (asset?.url && !shot.storyboardUrl) {
    list.append(renderStagePreview({
      url: asset.url,
      stage,
      shot,
      index,
      assetId: asset.id,
      deletable: true
    }));
  }
  if (urls.length === 0 && !asset?.url) {
    list.append(renderStagePreview({ stage, shot, index }));
  }
  urls.forEach((url) => {
    list.append(renderStagePreview({ url, stage, shot, index }));
  });
  container.append(list);
}

function renderStageProduct(container, shot, index, stage) {
  container.replaceChildren();
  container.tabIndex = stage === "materials" || stage === "storyboard" ? 0 : -1;
  container.setAttribute("aria-label", `${stageInfo(shot, stage).label}，聚焦后可粘贴上传文件`);
  container.onpaste = async (event) => {
    if (stage !== "materials" && stage !== "storyboard") return;
    const file = pastedFileForStage(event, stage);
    if (!file) return;
    event.preventDefault();
    await uploadStageFile(shot.id, stage, file);
  };
  const meta = stageConfigMeta(stage);
  const configWrap = document.createElement("div");
  configWrap.className = "stage-config-cell";
  renderNativeConfigSelect(configWrap, shot[meta.shotField] || "", (nextValue) => {
    shot[meta.shotField] = nextValue;
    markShotDirty(shot, meta.shotField);
    queueSave();
  }, { includeProjectDefault: true, label: `${stageInfo(shot, stage).label}模型配置`, mediaType: meta.mediaType });

  const previewWrap = document.createElement("div");
  previewWrap.className = "preview-slot";
  if (stage === "materials") {
    renderMaterialOutputs(previewWrap, shot, index);
  } else {
    renderMediaOutputs(previewWrap, shot, index, stage);
  }

  const controls = document.createElement("div");
  controls.className = "generation-controls";
  renderStageControls(controls, shot, stage);
  container.append(configWrap, previewWrap, controls);
}

function chooseUpload(shotId, stage = "video") {
  uploadShotId = shotId;
  uploadStage = stage;
  mediaUpload.accept = stage === "video"
    ? "video/mp4,video/webm,video/quicktime"
    : "image/png,image/jpeg,image/webp,image/gif";
  mediaUpload.value = "";
  mediaUpload.click();
}

async function uploadStageFile(shotId, stage, file) {
  if (!project || !shotId || !file) return;
  const form = new FormData();
  form.append("file", file);
  saveStatus.textContent = "上传中…";
  try {
    project = await api(
      `/api/projects/${encodeURIComponent(project.id)}/shots/${encodeURIComponent(shotId)}/${stage}`,
      { method: "POST", body: form }
    );
    if (stage === "materials") await refreshAssetLibrary();
    closeLightbox();
    renderStoryboard({ preserveScroll: true });
    saveStatus.textContent = "已保存";
    showToast("产物已上传");
  } catch (error) {
    saveStatus.textContent = "上传失败";
    showToast(error.message, "error");
  }
}

async function uploadMedia(file) {
  await uploadStageFile(uploadShotId, uploadStage, file);
}

function pastedFileForStage(event, stage) {
  const files = [...(event.clipboardData?.files || [])];
  if (stage === "video") return files.find((file) => file.type.startsWith("video/"));
  return files.find((file) => file.type.startsWith("image/"));
}

async function deleteStageMedia(shot, stage = "video", assetId = "") {
  saveStatus.textContent = "删除产物…";
  try {
    const suffix = assetId
      ? `${stage}/${encodeURIComponent(assetId)}`
      : stage;
    project = await api(
      `/api/projects/${encodeURIComponent(project.id)}/shots/${encodeURIComponent(shot.id)}/${suffix}`,
      { method: "DELETE" }
    );
    closeLightbox();
    renderStoryboard({ preserveScroll: true });
    saveStatus.textContent = "已保存";
    showToast("产物已删除");
  } catch (error) {
    saveStatus.textContent = "删除失败";
    showToast(error.message, "error");
  }
}

function assetById(assetId) {
  return assetLibrary.find((asset) => asset.id === assetId);
}

function storyboardAsset(shot) {
  return shot.storyboardAssetRef ? assetById(shot.storyboardAssetRef) : null;
}

function assetNotes(asset) {
  return asset?.notes || asset?.usage || "";
}

function subjectKey(asset) {
  return String(asset.personName || asset.name || asset.id || "")
    .trim()
    .toLocaleLowerCase();
}

function subjectDisplayName(group) {
  return group.name || group.image?.name || group.audio?.name || "未命名主体";
}

function subjectDisplayNotes(group) {
  return group.notes || assetNotes(group.image) || assetNotes(group.audio);
}

function groupSubjectAssets(assets = assetLibrary) {
  const groups = new Map();
  assets
    .filter((asset) => asset.kind === "subject")
    .forEach((asset) => {
      const key = subjectKey(asset);
      const group = groups.get(key) || {
        key,
        ids: [],
        name: asset.personName || asset.name,
        notes: assetNotes(asset),
        image: null,
        audio: null,
        assets: []
      };
      group.ids.push(asset.id);
      group.assets.push(asset);
      if (!group.notes && assetNotes(asset)) group.notes = assetNotes(asset);
      if (!group.name && (asset.personName || asset.name)) group.name = asset.personName || asset.name;
      if (asset.type === "audio" && !group.audio) group.audio = asset;
      if (asset.type === "image" && !group.image) group.image = asset;
      groups.set(key, group);
    });
  return [...groups.values()].sort((a, b) => subjectDisplayName(a).localeCompare(subjectDisplayName(b), "zh-Hans-CN"));
}

function subjectGroupsForRefs(refs = []) {
  const refSet = new Set(refs);
  return groupSubjectAssets().filter((group) => group.ids.some((id) => refSet.has(id)));
}

function subjectGroupForAsset(assetId) {
  return groupSubjectAssets().find((group) => group.ids.includes(assetId));
}

function renderSubjectThumb(group, options = {}) {
  const thumb = renderAssetThumb(group.image || group.audio, options);
  if (group.audio) thumb.dataset.hasAudio = "true";
  return thumb;
}

function renderAssetThumb(asset, options = {}) {
  const thumb = document.createElement("span");
  thumb.className = "asset-thumb";
  if (asset?.type === "image" && asset.url) {
    const image = document.createElement("img");
    image.src = asset.url;
    image.alt = asset.name;
    thumb.append(image);
    if (options.preview) {
      thumb.classList.add("asset-thumb-preview");
      thumb.setAttribute("role", "button");
      thumb.tabIndex = 0;
      thumb.title = "点击放大";
      const open = (event) => {
        event.preventDefault();
        event.stopPropagation();
        openAssetLightbox(asset);
      };
      thumb.addEventListener("click", open);
      thumb.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") open(event);
      });
    }
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
      markShotDirty(shot, "inputAssetRefs");
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

function renderSubjectRefs(container, shot) {
  container.replaceChildren();
  const list = document.createElement("div");
  list.className = "asset-ref-list subject-ref-list";
  const refs = Array.isArray(shot.subjectAssetRefs) ? shot.subjectAssetRefs : [];
  if (refs.length === 0) {
    const empty = document.createElement("span");
    empty.className = "empty-preview";
    empty.textContent = "未选择主体";
    list.append(empty);
  }
  subjectGroupsForRefs(refs).forEach((group) => {
    const item = document.createElement("div");
    item.className = "asset-ref-item subject-ref-item";
    const meta = document.createElement("span");
    meta.className = "asset-meta";
    const name = document.createElement("strong");
    name.textContent = subjectDisplayName(group);
    const detail = document.createElement("span");
    detail.textContent = group.audio ? "含音频" : "仅图片";
    meta.append(name, detail);
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "remove-asset-ref";
    remove.textContent = "移除";
    remove.addEventListener("click", () => {
      shot.subjectAssetRefs = refs.filter((id) => !group.ids.includes(id));
      renderSubjectRefs(container, shot);
      markShotDirty(shot, "subjectAssetRefs");
      queueSave();
    });
    item.append(renderSubjectThumb(group), meta, remove);
    list.append(item);
  });

  const actions = document.createElement("div");
  actions.className = "asset-ref-actions";
  const pick = document.createElement("button");
  pick.type = "button";
  pick.textContent = "选择主体";
  pick.addEventListener("click", () => openAssetPicker(shot.id, "subjects"));
  const upload = document.createElement("button");
  upload.type = "button";
  upload.textContent = "上传主体";
  upload.addEventListener("click", () => chooseAssetUpload(shot.id, "subject"));
  actions.append(pick, upload);
  container.append(list, actions);
}

function chooseAssetUpload(shotId = "", kind = "material", meta = {}) {
  assetUploadShotId = shotId;
  assetUploadKind = kind;
  assetUploadMeta = meta;
  assetUpload.accept = meta.accept || "image/png,image/jpeg,image/webp,image/gif,audio/mpeg,audio/mp3,audio/wav,audio/mp4,audio/aac";
  assetUpload.value = "";
  assetUpload.click();
}

function chooseSubjectAudioUpload(group) {
  chooseAssetUpload("", "subject", {
    accept: "audio/mpeg,audio/mp3,audio/wav,audio/mp4,audio/aac",
    replaceAssetId: group.audio?.id || "",
    fields: {
      name: subjectDisplayName(group),
      personName: subjectDisplayName(group),
      notes: subjectDisplayNotes(group)
    }
  });
}

async function uploadAsset(file) {
  if (!file) return;
  const form = new FormData();
  form.append("file", file);
  if (assetUploadKind === "subject") form.append("kind", "subject");
  Object.entries(assetUploadMeta.fields || {}).forEach(([key, value]) => {
    form.append(key, value);
  });
  try {
    const result = await api("/api/assets", { method: "POST", body: form });
    assetLibrary = result.assets || [];
    if (assetUploadMeta.replaceAssetId) {
      await deleteAsset(assetUploadMeta.replaceAssetId, { silent: true });
    }
    if (assetUploadShotId && project) {
      const shot = project.shots.find((item) => item.id === assetUploadShotId);
      if (shot) {
        const field = assetUploadKind === "subject" ? "subjectAssetRefs" : "inputAssetRefs";
        const ids = assetUploadKind === "subject"
          ? (subjectGroupForAsset(result.asset.id)?.ids || [result.asset.id])
          : [result.asset.id];
        shot[field] = [...new Set([...(shot[field] || []), ...ids])];
        markShotDirty(shot, field);
        queueSave();
      }
    }
    renderStoryboard({ preserveScroll: true });
    renderAssetLibraryDialog();
    showToast("物料已添加");
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    assetUploadShotId = "";
    assetUploadKind = "material";
    assetUploadMeta = {};
  }
}

function openLightbox(shot, index, stage = "video", url = "") {
  lightboxShotId = shot.id;
  lightboxStageName = stage;
  lightboxStage.replaceChildren();
  document.querySelector("#lightbox-upload").hidden = false;
  const mediaUrl = url || (stage === "storyboard" ? shot.storyboardUrl : shot.mediaUrl);
  const media = stage === "video"
    ? Object.assign(document.createElement("video"), { controls: true, autoplay: true })
    : document.createElement("img");
  media.src = mediaUrl;
  media.alt = shot.visualPrompt || `镜头 ${index + 1}`;
  lightboxStage.append(media);
  setLightboxCaption(
    `镜头 ${String(index + 1).padStart(2, "0")} · ${stageInfo(shot, stage).label}`,
    mediaFileNameFromUrl(mediaUrl)
  );
  showLightbox();
  document.body.classList.add("lightbox-open");
  document.querySelector("#lightbox-close").focus();
}

function showLightbox() {
  lightbox.hidden = false;
  if (typeof lightbox.showModal === "function" && !lightbox.open) {
    lightbox.showModal();
  }
}

function openAssetLightbox(asset) {
  if (!asset?.url || asset.type !== "image") return;
  lightboxShotId = "";
  lightboxStageName = "asset";
  lightboxStage.replaceChildren();
  document.querySelector("#lightbox-upload").hidden = true;
  const image = document.createElement("img");
  image.src = asset.url;
  image.alt = asset.name || "物料图片";
  lightboxStage.append(image);
  setLightboxCaption(asset.name || "物料图片", asset.fileName || mediaFileNameFromUrl(asset.url));
  showLightbox();
  document.body.classList.add("lightbox-open");
  document.querySelector("#lightbox-close").focus();
}

function closeLightbox() {
  if (lightbox.hidden && !lightbox.open) return;
  lightboxStage.querySelector("video")?.pause();
  lightboxStage.querySelector("audio")?.pause();
  if (lightbox.open && typeof lightbox.close === "function") lightbox.close();
  lightbox.hidden = true;
  lightboxStage.replaceChildren();
  lightboxShotId = "";
  lightboxStageName = "video";
  document.querySelector("#lightbox-upload").hidden = false;
  document.body.classList.remove("lightbox-open");
}

function selectLabel(field, value) {
  return selectOptions[field].find((option) => option.value === value)?.label || value;
}

function configOptions({ includeProjectDefault = false, mediaType = "" } = {}) {
  const options = (settings?.modelConfigs || [])
    .filter((config) => !mediaType || config.mediaType === mediaType)
    .map((config) => ({
    value: config.key,
    label: `${config.key} · ${config.name}`
  }));
  return includeProjectDefault
    ? [{ value: "", label: "使用项目默认" }, ...options]
    : options;
}

function stageConfigMeta(stage) {
  if (stage === "materials") {
    return {
      projectField: "materialConfigKey",
      shotField: "materialConfigKey",
      selectId: "material-config-select",
      mediaType: "image",
      fallback: settings?.defaultImageConfigKey || settings?.defaultConfigKey || ""
    };
  }
  if (stage === "storyboard") {
    return {
      projectField: "storyboardConfigKey",
      shotField: "storyboardConfigKey",
      selectId: "storyboard-config-select",
      mediaType: "image",
      fallback: settings?.defaultImageConfigKey || settings?.defaultConfigKey || ""
    };
  }
  return {
    projectField: "videoConfigKey",
    shotField: "videoConfigKey",
    selectId: "video-config-select",
    mediaType: "video",
    fallback: settings?.defaultVideoConfigKey || ""
  };
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
  const options = selectOptions[field] || [];

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
    rollType: "镜头类型"
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

function resizeTextarea(textarea) {
  textarea.style.height = "auto";
  textarea.style.height = `${textarea.scrollHeight}px`;
}

function renderProjectConfigSelects() {
  ["materials", "storyboard", "video"].forEach((stage) => {
    const meta = stageConfigMeta(stage);
    const select = document.querySelector(`#${meta.selectId}`);
    select.replaceChildren();
    configOptions({ mediaType: meta.mediaType }).forEach((option) => {
      const item = document.createElement("option");
      item.value = option.value;
      item.textContent = option.label;
      select.append(item);
    });
    select.value = project[meta.projectField] || meta.fallback;
    select.disabled = select.options.length === 0;
  });
}

function renderNativeConfigSelect(container, value, onChange, options = {}) {
  const select = document.createElement("select");
  select.className = "row-config-select";
  select.setAttribute("aria-label", options.label || "模型配置");
  configOptions({
    includeProjectDefault: options.includeProjectDefault,
    mediaType: options.mediaType
  }).forEach((option) => {
    const item = document.createElement("option");
    item.value = option.value;
    item.textContent = option.label;
    select.append(item);
  });
  select.value = value || "";
  select.addEventListener("change", () => onChange(select.value));
  container.replaceChildren(select);
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
    const dirtySnapshot = new Map(
      [...dirtyShotFields].map(([shotId, fields]) => [shotId, new Map(fields)])
    );
    if (dirtySnapshot.size === 0) {
      saveStatus.textContent = "已保存";
      return;
    }
    for (const [shotId, fields] of dirtySnapshot) {
      const localShot = project.shots.find((shot) => shot.id === shotId);
      if (!localShot) continue;
      const patch = {};
      fields.forEach((_version, field) => {
        patch[field] = Array.isArray(localShot[field]) ? [...localShot[field]] : localShot[field];
      });
      const saved = await api(
        `/api/projects/${encodeURIComponent(project.id)}/shots/${encodeURIComponent(shotId)}`,
        {
          method: "PATCH",
          body: JSON.stringify(patch)
        }
      );
      project.updatedAt = saved.updatedAt;
      const savedShots = new Map(saved.shots.map((shot) => [shot.id, shot]));
      project.shots.forEach((shot) => {
        const savedShot = savedShots.get(shot.id);
        if (!savedShot) return;
        const stillDirty = dirtyShotFields.get(shot.id);
        Object.entries(savedShot).forEach(([field, value]) => {
          if (stillDirty?.has(field)) return;
          shot[field] = value;
        });
      });
      clearSavedShotDirty(new Map([[shotId, fields]]));
    }
    saveStatus.textContent = "已保存";
  } catch (error) {
    saveStatus.textContent = "保存失败";
    showToast(error.message, "error");
  }
}

function renderStoryboard(options = {}) {
  const scrollPosition = options.preserveScroll ? tableScrollPosition() : null;
  closeSelect();
  document.title = `${project.title} · 智能分镜台`;
  document.querySelector("#project-title").textContent = project.title;
  document.querySelector("#project-ratio").textContent = project.aspectRatio;
  renderProjectConfigSelects();
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
      if (control.tagName === "TEXTAREA") {
        control.classList.toggle("visual-prompt-input", field === "visualPrompt");
        control.classList.toggle("notes-input", field === "notes");
        resizeTextarea(control);
      }
      control.addEventListener("input", () => {
        shot[field] = field === "duration" ? Number(control.value) : control.value;
        markShotDirty(shot, field);
        if (control.tagName === "TEXTAREA") resizeTextarea(control);
        updateSummary();
        if (field === "visualPrompt") {
          updateBatchButton();
          row.querySelectorAll(".stage-product").forEach((container) => {
            renderStageProduct(container, shot, index, container.dataset.stage);
          });
        }
        queueSave();
      });
    });

    row.querySelectorAll("[data-select-field]").forEach((container) => {
      const field = container.dataset.selectField;
      renderSelect(container, field, shot, (changedField) => {
        markShotDirty(shot, changedField);
        queueSave();
      });
    });

    renderSubjectRefs(row.querySelector(".subject-ref-cell"), shot);

    row.querySelectorAll(".stage-product").forEach((container) => {
      renderStageProduct(container, shot, index, container.dataset.stage);
    });

    row.querySelector(".delete-shot").addEventListener("click", async () => {
      await api(
        `/api/projects/${encodeURIComponent(project.id)}/shots/${encodeURIComponent(shot.id)}`,
        { method: "DELETE" }
      );
      project.shots.splice(index, 1);
      renderStoryboard({ preserveScroll: true });
    });
    body.append(row);
    row.querySelectorAll("textarea").forEach(resizeTextarea);
  });

  updateSummary();
  updateBatchButton();
  restoreTableScroll(scrollPosition);
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

function createBlankConfig(index, mediaType = "image") {
  return {
    key: `config${index}`,
    name: `配置 ${index}`,
    mediaType,
    provider: mediaType === "video" ? "jimeng-cli" : "image-gen",
    prompt: "",
    referenceTemplate: "",
    jimeng: {
      imageModel: "seedream 4.7",
      videoModel: "seedance 2.0 mini",
      imageResolution: "2k",
      videoResolution: "720p",
      pollSeconds: 30,
    }
  };
}

function escapeAttribute(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function renderModelConfigDialog() {
  if (!settings) return;
  const defaultImageSelect = document.querySelector("#default-image-config-key");
  const defaultVideoSelect = document.querySelector("#default-video-config-key");
  defaultImageSelect.replaceChildren();
  defaultVideoSelect.replaceChildren();
  (settings.modelConfigs || []).filter((config) => config.mediaType === "image").forEach((config) => {
    const option = document.createElement("option");
    option.value = config.key;
    option.textContent = `${config.key} · ${config.name}`;
    defaultImageSelect.append(option);
  });
  (settings.modelConfigs || []).filter((config) => config.mediaType === "video").forEach((config) => {
    const option = document.createElement("option");
    option.value = config.key;
    option.textContent = `${config.key} · ${config.name}`;
    defaultVideoSelect.append(option);
  });
  defaultImageSelect.value = settings.defaultImageConfigKey || settings.defaultConfigKey || "";
  defaultVideoSelect.value = settings.defaultVideoConfigKey || "";

  const imageList = document.querySelector("#image-config-list");
  const videoList = document.querySelector("#video-config-list");
  imageList.replaceChildren();
  videoList.replaceChildren();
  (settings.modelConfigs || []).forEach((config) => {
    const card = document.createElement("article");
    card.className = "model-config-card";
    card.dataset.key = config.key;
    card.dataset.mediaType = config.mediaType || "image";
    const isVideo = config.mediaType === "video";
    card.innerHTML = `
      <div class="settings-grid">
        <label class="form-field"><span>Key</span><input data-config-field="key" value="${escapeAttribute(config.key)}" /></label>
        <label class="form-field"><span>名称</span><input data-config-field="name" value="${escapeAttribute(config.name)}" /></label>
        <label class="form-field"><span>类型</span><input data-config-field="mediaType" value="${isVideo ? "视频" : "图片"}" disabled /></label>
        <label class="form-field"><span>提供方</span><select data-config-field="provider" ${isVideo ? "disabled" : ""}><option value="image-gen">Image Generation</option><option value="jimeng-cli">即梦 CLI</option></select></label>
        <label class="form-field jimeng-image-field"><span>图片模型</span><input data-config-field="imageModel" value="${escapeAttribute(config.jimeng?.imageModel || "")}" /></label>
        <label class="form-field jimeng-image-field"><span>图片分辨率</span><input data-config-field="imageResolution" value="${escapeAttribute(config.jimeng?.imageResolution || "")}" /></label>
        <label class="form-field jimeng-video-field"><span>视频模型</span><input data-config-field="videoModel" value="${escapeAttribute(config.jimeng?.videoModel || "")}" /></label>
        <label class="form-field jimeng-video-field"><span>视频分辨率</span><input data-config-field="videoResolution" value="${escapeAttribute(config.jimeng?.videoResolution || "")}" /></label>
        <label class="form-field jimeng-field"><span>Poll 秒数</span><input data-config-field="pollSeconds" type="number" min="0" step="1" value="${escapeAttribute(config.jimeng?.pollSeconds || 30)}" /></label>
      </div>
      <label class="form-field"><span>prompt 前缀</span><textarea data-config-field="prompt" class="compact-textarea"></textarea></label>
      <label class="form-field"><span>prompt 模板</span><textarea data-config-field="referenceTemplate" class="compact-textarea"></textarea></label>
      <div class="panel-heading"><span></span><button class="delete-config secondary compact-button" type="button">删除配置</button></div>
    `;
    card.querySelector('[data-config-field="provider"]').value = config.provider || "image-gen";
    card.querySelector('[data-config-field="prompt"]').value = config.prompt || "";
    card.querySelector('[data-config-field="referenceTemplate"]').value = config.referenceTemplate || "";
    updateConfigCardVisibility(card);
    card.querySelector('[data-config-field="provider"]').addEventListener("change", () => updateConfigCardVisibility(card));
    card.querySelector(".delete-config").disabled = settings.modelConfigs.length <= 1;
    card.querySelector(".delete-config").addEventListener("click", () => {
      const currentKey = card.querySelector('[data-config-field="key"]')?.value || config.key;
      syncSettingsFromDialog();
      settings.modelConfigs = settings.modelConfigs.filter((item) => item.key !== currentKey);
      if (!settings.modelConfigs.some((item) => item.key === settings.defaultImageConfigKey)) {
        settings.defaultImageConfigKey = settings.modelConfigs.find((item) => item.mediaType === "image")?.key || "";
      }
      if (!settings.modelConfigs.some((item) => item.key === settings.defaultVideoConfigKey)) {
        settings.defaultVideoConfigKey = settings.modelConfigs.find((item) => item.mediaType === "video")?.key || "";
      }
      renderModelConfigDialog();
    });
    (isVideo ? videoList : imageList).append(card);
  });
}

function updateConfigCardVisibility(card) {
  const mediaType = card.dataset.mediaType || "image";
  const provider = card.querySelector('[data-config-field="provider"]')?.value || "image-gen";
  card.querySelectorAll(".jimeng-image-field").forEach((field) => {
    field.hidden = mediaType !== "image" || provider !== "jimeng-cli";
  });
  card.querySelectorAll(".jimeng-video-field").forEach((field) => {
    field.hidden = mediaType !== "video";
  });
  card.querySelectorAll(".jimeng-field").forEach((field) => {
    field.hidden = mediaType === "image" && provider !== "jimeng-cli";
  });
}

function readModelConfigsFromDialog() {
  return [...document.querySelectorAll(".model-config-card")].map((card, index) => {
    const value = (field) => card.querySelector(`[data-config-field="${field}"]`)?.value || "";
    const mediaType = card.dataset.mediaType === "video" ? "video" : "image";
    const provider = mediaType === "video"
      ? "jimeng-cli"
      : (value("provider") === "jimeng-cli" ? "jimeng-cli" : "image-gen");
    const jimeng = {};
    if (mediaType === "image" && provider === "jimeng-cli") {
      jimeng.imageModel = value("imageModel");
      jimeng.imageResolution = value("imageResolution");
      jimeng.pollSeconds = Number(value("pollSeconds"));
    }
    if (mediaType === "video") {
      jimeng.videoModel = value("videoModel");
      jimeng.videoResolution = value("videoResolution");
      jimeng.pollSeconds = Number(value("pollSeconds"));
    }
    return {
      key: value("key") || `config${index + 1}`,
      name: value("name") || value("key") || `配置 ${index + 1}`,
      mediaType,
      provider,
      prompt: value("prompt"),
      referenceTemplate: value("referenceTemplate"),
      jimeng
    };
  });
}

function syncSettingsFromDialog() {
  if (!settingsDialog.open || !settings) return;
  settings.modelConfigs = readModelConfigsFromDialog();
  settings.defaultConfigKey = document.querySelector("#default-image-config-key").value;
  settings.defaultImageConfigKey = settings.defaultConfigKey;
  settings.defaultVideoConfigKey = document.querySelector("#default-video-config-key").value;
}

function nextConfigIndex() {
  const used = new Set((settings.modelConfigs || []).map((config) => config.key));
  let index = (settings.modelConfigs || []).length + 1;
  while (used.has(`config${index}`)) index += 1;
  return index;
}

function addModelConfig(mediaType) {
  syncSettingsFromDialog();
  const nextConfig = createBlankConfig(nextConfigIndex(), mediaType);
  settings.modelConfigs.push(nextConfig);
  renderModelConfigDialog();
  const target = document.querySelector(
    `${mediaType === "video" ? "#video-config-list" : "#image-config-list"} [data-key="${CSS.escape(nextConfig.key)}"]`
  );
  target?.scrollIntoView({ behavior: "smooth", block: "end" });
  target?.querySelector('[data-config-field="name"]')?.focus({ preventScroll: true });
}

function renderAssetLibraryDialog() {
  const list = document.querySelector("#asset-library-list");
  list.replaceChildren();
  if (assetLibrary.length === 0) {
    const empty = document.createElement("p");
    empty.className = "delete-message";
    empty.textContent = "暂无物料。";
    list.append(empty);
    return;
  }

  const subjects = groupSubjectAssets();
  const materials = assetLibrary.filter((asset) => asset.kind !== "subject");

  const renderSection = (title, emptyText) => {
    const section = document.createElement("section");
    section.className = "asset-library-section";
    const heading = document.createElement("div");
    heading.className = "asset-library-section-title";
    heading.textContent = title;
    const grid = document.createElement("div");
    grid.className = "asset-library-grid";
    section.append(heading, grid);
    list.append(section);
    if (emptyText) {
      const empty = document.createElement("p");
      empty.className = "delete-message";
      empty.textContent = emptyText;
      grid.append(empty);
    }
    return grid;
  };

  const subjectGrid = renderSection("主体", subjects.length === 0 ? "暂无主体。" : "");
  subjects.forEach((group) => {
    const card = document.createElement("article");
    card.className = "asset-card subject-card";
    const fields = document.createElement("div");
    fields.className = "asset-card-fields";
    const name = Object.assign(document.createElement("input"), {
      value: subjectDisplayName(group),
      placeholder: "名称",
      "aria-label": "主体名称"
    });
    name.dataset.assetEdit = "subject-name";
    name.dataset.assetIds = group.ids.join(",");
    const notes = Object.assign(document.createElement("textarea"), {
      value: subjectDisplayNotes(group),
      placeholder: "备注",
      "aria-label": "主体备注"
    });
    notes.dataset.assetEdit = "subject-notes";
    notes.dataset.assetIds = group.ids.join(",");
    notes.className = "asset-note-input";
    const sync = () => {
      group.assets.forEach((asset) => updateAsset(asset.id, {
        name: name.value,
        personName: name.value,
        notes: notes.value,
        kind: "subject"
      }));
    };
    name.addEventListener("change", sync);
    notes.addEventListener("change", sync);
    fields.append(name, notes);
    const media = document.createElement("div");
    media.className = "asset-card-media";
    const mediaStatus = document.createElement("span");
    mediaStatus.textContent = group.image && group.audio
      ? "图片 + 音频"
      : (group.audio ? "音频" : "图片");
    const audioBox = document.createElement("div");
    audioBox.className = "subject-audio-box";
    const audioLabel = document.createElement("span");
    audioLabel.textContent = group.audio ? group.audio.name : "未关联音频";
    audioBox.append(audioLabel);
    if (group.audio?.url) {
      const audioPlayer = document.createElement("audio");
      audioPlayer.controls = true;
      audioPlayer.preload = "none";
      audioPlayer.src = group.audio.url;
      audioPlayer.setAttribute("aria-label", `${subjectDisplayName(group)} 音频`);
      audioBox.append(audioPlayer);
    }
    const audioButton = document.createElement("button");
    audioButton.type = "button";
    audioButton.className = "secondary compact-button";
    audioButton.textContent = group.audio ? "替换音频" : "上传音频";
    audioButton.addEventListener("click", () => chooseSubjectAudioUpload(group));
    audioBox.append(audioButton);
    if (group.audio) {
      const deleteAudioButton = document.createElement("button");
      deleteAudioButton.type = "button";
      deleteAudioButton.className = "secondary compact-button";
      deleteAudioButton.textContent = "删除音频";
      deleteAudioButton.addEventListener("click", async () => {
        await deleteAsset(group.audio.id, { silent: true });
        renderAssetLibraryDialog();
        showToast("音频已删除");
      });
      audioBox.append(deleteAudioButton);
    }
    media.append(renderSubjectThumb(group, { preview: true }), mediaStatus, audioBox);
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "delete-asset";
    remove.textContent = "删除";
    remove.addEventListener("click", async () => {
      for (const assetId of group.ids) await deleteAsset(assetId, { silent: true });
      renderAssetLibraryDialog();
      showToast("主体已删除");
    });
    card.append(media, fields, remove);
    subjectGrid.append(card);
  });

  const materialGrid = renderSection("普通物料", materials.length === 0 ? "暂无普通物料。" : "");
  materials.forEach((asset) => {
    const card = document.createElement("article");
    card.className = "asset-card";
    const fields = document.createElement("div");
    fields.className = "asset-card-fields";
    const name = Object.assign(document.createElement("input"), {
      value: asset.name,
      placeholder: "名称",
      "aria-label": "物料名称"
    });
    name.dataset.assetEdit = "material-name";
    name.dataset.assetId = asset.id;
    const notes = Object.assign(document.createElement("textarea"), {
      value: assetNotes(asset),
      placeholder: "备注",
      "aria-label": "物料备注"
    });
    notes.dataset.assetEdit = "material-notes";
    notes.dataset.assetId = asset.id;
    notes.className = "asset-note-input";
    const sync = () => updateAsset(asset.id, {
        name: name.value,
        notes: notes.value,
        kind: "material"
      });
    [name, notes].forEach((input) => {
      input.addEventListener("change", sync);
    });
    fields.append(name, notes);
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "delete-asset";
    remove.textContent = "删除";
    remove.addEventListener("click", () => deleteAsset(asset.id));
    card.append(renderAssetThumb(asset, { preview: true }), fields, remove);
    materialGrid.append(card);
  });
}

async function openSettingsDialog() {
  await loadSettingsAndAssets();
  renderModelConfigDialog();
  settingsDialog.showModal();
}

async function openAssetLibraryDialog() {
  await loadSettingsAndAssets();
  renderAssetLibraryDialog();
  assetLibraryDialog.showModal();
}

async function saveSettingsFromDialog() {
  const configs = readModelConfigsFromDialog();
  const next = {
    presetsVersion: settings.presetsVersion,
    defaultConfigKey: document.querySelector("#default-image-config-key").value,
    defaultImageConfigKey: document.querySelector("#default-image-config-key").value,
    defaultVideoConfigKey: document.querySelector("#default-video-config-key").value,
    modelConfigs: configs
  };
  settings = await api("/api/settings", { method: "PUT", body: JSON.stringify(next) });
  renderModelConfigDialog();
  renderStoryboard({ preserveScroll: true });
  showToast("配置已保存");
}

async function updateAsset(assetId, update) {
  const result = await api(`/api/assets/${encodeURIComponent(assetId)}`, {
    method: "PATCH",
    body: JSON.stringify(update)
  });
  assetLibrary = result.assets || [];
  if (project) renderStoryboard({ preserveScroll: true });
}

async function flushAssetLibraryEdits() {
  if (!assetLibraryDialog.open) return;
  const updates = new Map();
  document.querySelectorAll("#asset-library-dialog [data-asset-edit]").forEach((field) => {
    const edit = field.dataset.assetEdit;
    if (edit.startsWith("subject-")) {
      field.dataset.assetIds.split(",").filter(Boolean).forEach((assetId) => {
        const update = updates.get(assetId) || {};
        if (edit === "subject-name") {
          update.name = field.value;
          update.personName = field.value;
          update.kind = "subject";
        }
        if (edit === "subject-notes") {
          update.notes = field.value;
          update.kind = "subject";
        }
        updates.set(assetId, update);
      });
      return;
    }
    const assetId = field.dataset.assetId;
    if (!assetId) return;
    const update = updates.get(assetId) || {};
    if (edit === "material-name") update.name = field.value;
    if (edit === "material-notes") update.notes = field.value;
    update.kind = "material";
    updates.set(assetId, update);
  });
  for (const [assetId, update] of updates) {
    await updateAsset(assetId, update);
  }
}

async function deleteAsset(assetId, options = {}) {
  const result = await api(`/api/assets/${encodeURIComponent(assetId)}`, { method: "DELETE" });
  assetLibrary = result.assets || [];
  if (project) project = await api(`/api/projects/${encodeURIComponent(project.id)}`);
  if (!options.silent) renderAssetLibraryDialog();
  if (project) renderStoryboard({ preserveScroll: true });
  if (!options.silent) showToast("物料已删除");
}

function openAssetPicker(shotId, stage = "materials") {
  assetPickerShotId = shotId;
  assetPickerStage = stage;
  const shot = project.shots.find((item) => item.id === shotId);
  const selected = new Set(stage === "storyboard"
    ? [shot?.storyboardAssetRef].filter(Boolean)
    : (stage === "materials"
      ? shot?.materialAssetRefs || []
      : (stage === "subjects" ? shot?.subjectAssetRefs || [] : shot?.inputAssetRefs || [])));
  const list = document.querySelector("#asset-picker-list");
  list.replaceChildren();
  assetPickerDialog.classList.toggle("subject-picker-dialog", stage === "subjects");
  list.classList.toggle("subject-picker-grid", stage === "subjects");
  document.querySelector("#asset-picker-title").textContent =
    stage === "storyboard" ? "选择故事板图" : (stage === "subjects" ? "选择主体参考" : "选择物料图");
  const candidates = stage === "subjects"
    ? groupSubjectAssets()
    : assetLibrary.filter((asset) => asset.type === "image");
  if (candidates.length === 0) {
    const empty = document.createElement("p");
    empty.className = "delete-message";
    empty.textContent = stage === "subjects" ? "物料库中暂无主体。" : "物料库中暂无图片物料。";
    list.append(empty);
  }
  candidates.forEach((item) => {
    const asset = stage === "subjects" ? item.image || item.audio : item;
    const label = document.createElement("label");
    label.className = "asset-picker-option";
    const input = document.createElement("input");
    input.type = stage === "storyboard" ? "radio" : "checkbox";
    input.name = "asset-picker-selection";
    input.value = stage === "subjects" ? item.key : asset.id;
    input.checked = stage === "subjects"
      ? item.ids.some((id) => selected.has(id))
      : selected.has(asset.id);
    const meta = document.createElement("span");
    meta.className = "asset-meta";
    const name = document.createElement("strong");
    name.textContent = stage === "subjects" ? subjectDisplayName(item) : asset.name;
    const detail = document.createElement("span");
    detail.textContent = stage === "subjects"
      ? [item.audio ? "含音频" : "仅图片", subjectDisplayNotes(item)].filter(Boolean).join(" · ")
      : assetNotes(asset);
    meta.append(name, detail);
    label.append(input, stage === "subjects" ? renderSubjectThumb(item) : renderAssetThumb(asset), meta);
    list.append(label);
  });
  assetPickerDialog.showModal();
}

function applyAssetPicker() {
  const shot = project.shots.find((item) => item.id === assetPickerShotId);
  if (!shot) return;
  const selected = [...document.querySelectorAll("#asset-picker-list input:checked")]
    .map((input) => input.value);
  if (assetPickerStage === "storyboard") {
    shot.storyboardAssetRef = selected[0] || "";
    if (shot.storyboardAssetRef) {
      shot.storyboardUrl = "";
      shot.storyboardUrls = [];
      shot.storyboardStatus = "ready";
      shot.storyboardTaskId = "";
      shot.storyboardError = "";
      shot.storyboardCompletedAt = new Date().toISOString();
    } else if (!shot.storyboardUrl) {
      shot.storyboardStatus = "idle";
    }
  } else if (assetPickerStage === "materials") {
    shot.materialAssetRefs = selected;
    shot.materialStatus = selected.length > 0 ? "ready" : "idle";
    shot.materialTaskId = "";
    shot.materialError = "";
    shot.materialCompletedAt = selected.length > 0 ? new Date().toISOString() : null;
  } else if (assetPickerStage === "subjects") {
    const groups = groupSubjectAssets();
    shot.subjectAssetRefs = selected.flatMap((key) => groups.find((group) => group.key === key)?.ids || []);
  } else {
    shot.inputAssetRefs = selected;
  }
  markShotDirty(shot, assetPickerStage === "storyboard"
    ? ["storyboardAssetRef", "storyboardUrl", "storyboardUrls", "storyboardStatus", "storyboardTaskId", "storyboardError", "storyboardCompletedAt"]
    : assetPickerStage === "materials"
      ? ["materialAssetRefs", "materialStatus", "materialTaskId", "materialError", "materialCompletedAt"]
      : assetPickerStage === "subjects"
        ? "subjectAssetRefs"
        : "inputAssetRefs");
  assetPickerDialog.close();
  assetPickerShotId = "";
  assetPickerStage = "materials";
  renderStoryboard({ preserveScroll: true });
  queueSave();
}

function stageInfo(shot, stage) {
  if (stage === "materials") {
    return {
      status: shot.materialStatus || "idle",
      taskId: shot.materialTaskId || "",
      error: shot.materialError || "",
      label: "物料图",
      action: "添加到队列"
    };
  }
  if (stage === "storyboard") {
    return {
      status: shot.storyboardStatus || "idle",
      taskId: shot.storyboardTaskId || "",
      error: shot.storyboardError || "",
      label: "故事板",
      action: "添加到队列"
    };
  }
  return {
    status: shot.videoStatus || shot.generationStatus || "idle",
    taskId: shot.videoTaskId || shot.generationTaskId || "",
    error: shot.videoError || shot.generationError || "",
    label: "视频",
    action: "添加到队列"
  };
}

function stageButtonLabel(shot, stage) {
  const info = stageInfo(shot, stage);
  if (info.status === "pending") return "取消";
  if (info.status === "processing") return "生成中";
  return info.action;
}

function renderStageControls(container, shot, stage) {
  container.replaceChildren();
  const info = stageInfo(shot, stage);
  const row = document.createElement("div");
  row.className = "pipeline-stage";
  row.dataset.stage = stage;

  const status = document.createElement("span");
  status.className = "generation-status";
  status.dataset.status = info.status;
  status.title = info.error;
  status.textContent = statusLabel(info.status, info.error);

  const upload = document.createElement("button");
  upload.className = "generate-shot";
  upload.type = "button";
  upload.textContent = "上传";
  upload.addEventListener("click", () => chooseUpload(shot.id, stage));

  const pick = document.createElement("button");
  pick.className = "generate-shot";
  pick.type = "button";
  pick.textContent = "物料库";
  pick.hidden = stage === "video";
  pick.addEventListener("click", () => openAssetPicker(shot.id, stage));

  const button = document.createElement("button");
  button.className = "generate-shot";
  button.type = "button";
  button.textContent = stageButtonLabel(shot, stage);
  button.dataset.action = info.status === "pending" ? "cancel" : "generate";
  button.disabled = info.status === "processing" || !shot.visualPrompt.trim();
  button.addEventListener("click", () => {
    if (info.status === "pending") return cancelGeneration({ generationTaskId: info.taskId });
    if (stage === "video") return confirmVideoGeneration(shot);
    return queueGeneration(
      [shot.id],
      info.status === "ready" || info.status === "failed",
      { stage }
    );
  });

  row.append(status, upload, pick, button);
  container.append(row);
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
    renderStoryboard({ preserveScroll: true });
  } catch (error) {
    project = await api(`/api/projects/${encodeURIComponent(project.id)}`);
    renderStoryboard({ preserveScroll: true });
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
  const shots = Array.isArray(shot) ? shot : [shot];
  videoConfirmShotId = shots[0]?.id || "";
  videoConfirmShotIds = shots.map((item) => item.id);
  document.querySelector("#video-confirm-message").textContent =
    shots.length === 1
      ? `即将提交镜头 ${project.shots.indexOf(shots[0]) + 1} 的视频生成任务。主体参考、物料图和故事板图会自动作为输入，视频任务会消耗额度。`
      : `即将批量提交 ${shots.length} 个视频生成任务。主体参考、物料图和故事板图会自动作为输入，视频任务会消耗额度。`;
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
    renderStoryboard({ preserveScroll: true });
  } catch (error) {
    saveStatus.textContent = "提交失败";
    showToast(error.message, "error");
  }
}

async function cancelGenerationBatch(stage, shotIds) {
  saveStatus.textContent = "取消生成任务…";
  try {
    const result = await api("/api/generation/tasks/cancel", {
      method: "POST",
      body: JSON.stringify({
        projectId: project.id,
        shotIds,
        stage
      })
    });
    project = result.project;
    saveStatus.textContent = result.canceled.length > 0
      ? `已取消 ${result.canceled.length} 个生成任务`
      : "没有可取消的任务";
    renderStoryboard({ preserveScroll: true });
  } catch (error) {
    project = await api(`/api/projects/${encodeURIComponent(project.id)}`);
    renderStoryboard({ preserveScroll: true });
    saveStatus.textContent = "取消失败";
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
        renderStoryboard({ preserveScroll: true });
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
document.querySelector("#open-model-configs").addEventListener("click", openSettingsDialog);
document.querySelector("#open-asset-library").addEventListener("click", openAssetLibraryDialog);
document.querySelector("#add-shot-top").addEventListener("click", addShot);
document.querySelector("#add-shot-bottom").addEventListener("click", addShot);
["materials", "storyboard", "video"].forEach((stage) => {
  const meta = stageConfigMeta(stage);
  document.querySelector(`#${meta.selectId}`).addEventListener("change", async (event) => {
    if (!project) return;
    project[meta.projectField] = event.target.value;
    saveStatus.textContent = "保存中…";
    project = await api(`/api/projects/${encodeURIComponent(project.id)}`, {
      method: "PATCH",
      body: JSON.stringify({ [meta.projectField]: project[meta.projectField] })
    });
    renderStoryboard({ preserveScroll: true });
    saveStatus.textContent = "已保存";
  });
});

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
  const pending = project.shots.filter((shot) => (shot.videoStatus || shot.generationStatus) === "pending");
  if (pending.length > 0) {
    await cancelGenerationBatch("video", pending.map((shot) => shot.id));
    return;
  }
  const shots = project.shots.filter((item) => canQueueStage(item, "video"));
  if (shots.length > 0) confirmVideoGeneration(shots);
});
generateMaterialsButton.addEventListener("click", async () => {
  const pending = project.shots.filter((shot) => shot.materialStatus === "pending");
  if (pending.length > 0) {
    await cancelGenerationBatch("materials", pending.map((shot) => shot.id));
    return;
  }
  const shotIds = project.shots.filter((shot) => canQueueStage(shot, "materials")).map((shot) => shot.id);
  await queueGeneration(shotIds, true, { stage: "materials" });
});
generateStoryboardsButton.addEventListener("click", async () => {
  const pending = project.shots.filter((shot) => shot.storyboardStatus === "pending");
  if (pending.length > 0) {
    await cancelGenerationBatch("storyboard", pending.map((shot) => shot.id));
    return;
  }
  const shotIds = project.shots.filter((shot) => canQueueStage(shot, "storyboard")).map((shot) => shot.id);
  await queueGeneration(shotIds, true, { stage: "storyboard" });
});

mediaUpload.addEventListener("change", () => uploadMedia(mediaUpload.files?.[0]));
assetUpload.addEventListener("change", () => uploadAsset(assetUpload.files?.[0]));
document.querySelector("#choose-asset-upload").addEventListener("click", () => chooseAssetUpload(""));
document.querySelector("#choose-subject-upload").addEventListener("click", () => chooseAssetUpload("", "subject"));
document.querySelector("#save-settings").addEventListener("click", saveSettingsFromDialog);
document.querySelector("#add-image-config").addEventListener("click", () => {
  addModelConfig("image");
});
document.querySelector("#add-video-config").addEventListener("click", () => {
  addModelConfig("video");
});
document.querySelector("#apply-asset-picker").addEventListener("click", applyAssetPicker);
document.querySelector("#confirm-video-generation").addEventListener("click", async () => {
  const shotIds = videoConfirmShotIds.length > 0 ? videoConfirmShotIds : [videoConfirmShotId].filter(Boolean);
  const shots = project.shots.filter((item) => shotIds.includes(item.id));
  videoConfirmDialog.close();
  videoConfirmShotId = "";
  videoConfirmShotIds = [];
  if (shots.length === 0) return;
  await queueGeneration(shotIds, shots.some((shot) => ["ready", "failed"].includes(shot.videoStatus || shot.generationStatus)), {
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
  if (lightboxShotId) chooseUpload(lightboxShotId, lightboxStageName);
});
lightbox.addEventListener("click", (event) => {
  if (event.target === lightbox || event.target === lightboxStage) closeLightbox();
});
document.addEventListener("keydown", (event) => {
  const lightboxOpen = lightbox.open || !lightbox.hidden;
  if (event.key === "Escape" && !designMenuPopover.hidden) {
    closeDesignMenu(true);
    designMenuTrigger.focus();
  }
  if (event.key === "Escape" && lightboxOpen) closeLightbox();
  if (event.key === "Tab" && lightboxOpen) {
    const controls = [
      document.querySelector("#lightbox-close"),
      document.querySelector("#lightbox-upload")
    ].filter((control) => !control.hidden);
    const index = controls.indexOf(document.activeElement);
    event.preventDefault();
    controls[(index + (event.shiftKey ? -1 : 1) + controls.length) % controls.length].focus();
  }
});
document.querySelectorAll("[data-close-dialog]").forEach((button) => {
  button.addEventListener("click", async () => {
    const dialog = button.closest("dialog");
    if (dialog === assetLibraryDialog) await flushAssetLibraryEdits();
    dialog.close();
  });
});
assetLibraryDialog.addEventListener("cancel", async (event) => {
  event.preventDefault();
  await flushAssetLibraryEdits();
  assetLibraryDialog.close();
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
