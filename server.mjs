import { createServer } from "node:http";
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import { basename, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = fileURLToPath(new URL(".", import.meta.url));
const publicDir = join(rootDir, "public");
const dataDir = join(rootDir, "data");
const projectsDir = join(dataDir, "projects");
const projectsFile = join(dataDir, "projects.json");
const settingsFile = join(dataDir, "settings.json");
const assetsDir = join(dataDir, "assets");
const assetFilesDir = join(assetsDir, "files");
const assetLibraryFile = join(assetsDir, "library.json");
const legacyDataFile = join(dataDir, "storyboard.json");
const legacyMediaDir = join(dataDir, "media");
const port = Number(process.env.PORT || 43218);
let generationMutationQueue = Promise.resolve();

const aspectRatios = {
  "9:16": { width: 1080, height: 1920 },
  "16:9": { width: 1920, height: 1080 },
  "3:4": { width: 1080, height: 1440 },
  "4:3": { width: 1440, height: 1080 },
  "1:1": { width: 1080, height: 1080 }
};

const generationStages = ["materials", "storyboard", "video"];
const generationStatuses = ["idle", "pending", "processing", "ready", "failed"];

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime"
};

const allowedUploads = new Map([
  ["image/png", ".png"],
  ["image/jpeg", ".jpg"],
  ["image/webp", ".webp"],
  ["image/gif", ".gif"],
  ["video/mp4", ".mp4"],
  ["video/webm", ".webm"],
  ["video/quicktime", ".mov"]
]);

const allowedAssetUploads = new Map([
  ["image/png", ".png"],
  ["image/jpeg", ".jpg"],
  ["image/webp", ".webp"],
  ["image/gif", ".gif"],
  ["audio/mpeg", ".mp3"],
  ["audio/mp3", ".mp3"],
  ["audio/wav", ".wav"],
  ["audio/x-wav", ".wav"],
  ["audio/mp4", ".m4a"],
  ["audio/aac", ".aac"]
]);

const defaultSettings = {
  presetsVersion: 1,
  defaultImageConfigKey: "cf1",
  defaultVideoConfigKey: "cf4",
  defaultConfigKey: "cf1",
  modelConfigs: [
    {
      key: "cf1",
      name: "图片 image gen + prompts",
      mediaType: "image",
      provider: "image-gen",
      prompt: "",
      referenceTemplate: "",
      jimeng: {}
    },
    {
      key: "cf2",
      name: "图片 即梦 2k model1",
      mediaType: "image",
      provider: "jimeng-cli",
      prompt: "",
      referenceTemplate: "",
      jimeng: { imageModel: "model1", imageResolution: "2k" }
    },
    {
      key: "cf3",
      name: "图片 即梦 4k model2",
      mediaType: "image",
      provider: "jimeng-cli",
      prompt: "",
      referenceTemplate: "",
      jimeng: { imageModel: "model2", imageResolution: "4k" }
    },
    {
      key: "cf4",
      name: "视频 即梦 720p seedance2.0",
      mediaType: "video",
      provider: "jimeng-cli",
      prompt: "",
      referenceTemplate: "",
      jimeng: { videoModel: "seedance2.0", videoResolution: "720p" }
    },
    {
      key: "cf5",
      name: "视频 即梦 720p seedance2.0fast_vip",
      mediaType: "video",
      provider: "jimeng-cli",
      prompt: "",
      referenceTemplate: "",
      jimeng: { videoModel: "seedance2.0fast_vip", videoResolution: "720p" }
    }
  ]
};

await mkdir(projectsDir, { recursive: true });
await mkdir(assetFilesDir, { recursive: true });
await migrateLegacyProject();
await ensureSettings();
await ensureAssetLibrary();

function sendJson(response, status, value) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(JSON.stringify(value));
  return true;
}

function sendError(response, status, message) {
  return sendJson(response, status, { error: message });
}

async function readBodyBuffer(request, limit = 100 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw new Error("上传文件不能超过 100MB");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readBody(request) {
  const buffer = await readBodyBuffer(request, 5 * 1024 * 1024);
  if (buffer.length === 0) return {};
  return JSON.parse(buffer.toString("utf8"));
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function safeId(value) {
  return /^[a-zA-Z0-9_-]+$/.test(value);
}

function createId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function createTaskId() {
  return createId("task");
}

function normalizeAspectRatio(value) {
  return aspectRatios[value] ? value : "16:9";
}

function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => String(value || "").trim())
    .filter(Boolean))];
}

function removeString(values, value) {
  return uniqueStrings(values).filter((item) => item !== value);
}

function normalizeModelConfig(config = {}, fallback = defaultSettings.modelConfigs[0]) {
  const mediaType = config.mediaType === "video" || fallback.mediaType === "video" ? "video" : "image";
  const provider = mediaType === "video"
    ? "jimeng-cli"
    : (config.provider === "jimeng-cli" || config.generator === "jimeng-cli" ? "jimeng-cli" : "image-gen");
  const key = String(config.key || fallback.key || createId("config"))
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "-") || fallback.key;
  const pollSeconds = Number(config.jimeng?.pollSeconds ?? fallback.jimeng?.pollSeconds ?? 30);
  const jimeng = {};
  if (mediaType === "image" && provider === "jimeng-cli") {
    jimeng.imageModel = String(config.jimeng?.imageModel || fallback.jimeng?.imageModel || "model1");
    jimeng.imageResolution = String(config.jimeng?.imageResolution || fallback.jimeng?.imageResolution || "2k");
    jimeng.pollSeconds = Number.isFinite(pollSeconds) && pollSeconds >= 0
      ? pollSeconds
      : (fallback.jimeng?.pollSeconds || 30);
  }
  if (mediaType === "video") {
    jimeng.videoModel = String(config.jimeng?.videoModel || fallback.jimeng?.videoModel || "seedance2.0");
    jimeng.videoResolution = String(config.jimeng?.videoResolution || fallback.jimeng?.videoResolution || "720p");
    jimeng.pollSeconds = Number.isFinite(pollSeconds) && pollSeconds >= 0
      ? pollSeconds
      : (fallback.jimeng?.pollSeconds || 30);
  }
  return {
    key,
    name: String(config.name || fallback.name || key),
    mediaType,
    provider,
    prompt: String(config.prompt ?? config.fixedPrefix ?? fallback.prompt ?? ""),
    referenceTemplate: String(config.referenceTemplate ?? fallback.referenceTemplate ?? ""),
    jimeng
  };
}

function normalizeSettings(settings = {}) {
  const presetsVersion = Number(settings.presetsVersion || 0);
  const shouldAddBuiltInPresets = presetsVersion < defaultSettings.presetsVersion;
  const legacyConfig = settings.jimeng || settings.promptTemplates
    ? {
        key: "default",
        name: "默认配置",
        prompt: settings.promptTemplates?.fixedPrefix || "",
        referenceTemplate: settings.promptTemplates?.referenceTemplate || "",
        jimeng: settings.jimeng || {}
      }
    : null;
  const rawConfigs = Array.isArray(settings.modelConfigs) && settings.modelConfigs.length > 0
    ? settings.modelConfigs
    : [legacyConfig || defaultSettings.modelConfigs[0]];
  const seen = new Set();
  const modelConfigs = rawConfigs
    .map((config) => normalizeModelConfig(config, config.mediaType === "video"
      ? defaultSettings.modelConfigs.find((item) => item.mediaType === "video")
      : defaultSettings.modelConfigs.find((item) => item.mediaType === "image")))
    .filter((config) => {
      if (seen.has(config.key)) return false;
      seen.add(config.key);
      return true;
    });
  for (const fallback of defaultSettings.modelConfigs) {
    if (shouldAddBuiltInPresets && !modelConfigs.some((config) => config.key === fallback.key)) {
      modelConfigs.push(normalizeModelConfig(fallback, fallback));
    }
  }
  for (const fallback of defaultSettings.modelConfigs) {
    if (!modelConfigs.some((config) => config.mediaType === fallback.mediaType)) {
      modelConfigs.push(normalizeModelConfig(fallback, fallback));
    }
  }
  const imageConfigs = modelConfigs.filter((config) => config.mediaType === "image");
  const videoConfigs = modelConfigs.filter((config) => config.mediaType === "video");
  const defaultImageConfigKey = imageConfigs.some((config) => config.key === settings.defaultImageConfigKey)
    ? settings.defaultImageConfigKey
    : imageConfigs.some((config) => config.key === defaultSettings.defaultImageConfigKey)
      ? defaultSettings.defaultImageConfigKey
      : imageConfigs.some((config) => config.key === settings.defaultConfigKey)
      ? settings.defaultConfigKey
      : imageConfigs[0]?.key || "";
  const defaultVideoConfigKey = videoConfigs.some((config) => config.key === settings.defaultVideoConfigKey)
    ? settings.defaultVideoConfigKey
    : videoConfigs.some((config) => config.key === defaultSettings.defaultVideoConfigKey)
      ? defaultSettings.defaultVideoConfigKey
      : videoConfigs[0]?.key || "";
  const defaultConfigKey = modelConfigs.some((config) => config.key === settings.defaultConfigKey)
    ? settings.defaultConfigKey
    : defaultImageConfigKey || modelConfigs[0].key;
  return {
    presetsVersion: defaultSettings.presetsVersion,
    defaultConfigKey,
    defaultImageConfigKey,
    defaultVideoConfigKey,
    modelConfigs
  };
}

function normalizeAsset(asset = {}) {
  const type = asset.type === "audio" ? "audio" : "image";
  return {
    id: safeId(asset.id || "") ? asset.id : createId("asset"),
    type,
    name: String(asset.name || "未命名物料").trim() || "未命名物料",
    url: String(asset.url || ""),
    fileName: basename(String(asset.fileName || "")),
    mimeType: String(asset.mimeType || ""),
    personName: String(asset.personName || ""),
    aliases: uniqueStrings(asset.aliases),
    tags: uniqueStrings(asset.tags),
    usage: String(asset.usage || ""),
    autoReference: asset.autoReference !== false,
    createdAt: asset.createdAt || new Date().toISOString(),
    updatedAt: asset.updatedAt || asset.createdAt || new Date().toISOString()
  };
}

function normalizeShot(shot = {}) {
  const legacyImageMedia = shot.mediaUrl && shot.mediaType !== "video";
  const storyboardUrl = String(shot.storyboardUrl || (legacyImageMedia ? shot.mediaUrl : "") || "");
  const mediaUrl = legacyImageMedia ? "" : String(shot.mediaUrl || "");
  const storyboardUrls = uniqueStrings([storyboardUrl, ...uniqueStrings(shot.storyboardUrls)]);
  const mediaUrls = uniqueStrings([mediaUrl, ...uniqueStrings(shot.mediaUrls)]);
  const materialStatus = generationStatuses.includes(shot.materialStatus)
    ? shot.materialStatus
    : (Array.isArray(shot.materialAssetRefs) && shot.materialAssetRefs.length > 0 ? "ready" : "idle");
  const storyboardAssetRef = String(shot.storyboardAssetRef || "");
  const storyboardStatus = generationStatuses.includes(shot.storyboardStatus)
    ? shot.storyboardStatus
    : (storyboardUrls.length > 0 || storyboardAssetRef ? "ready" : "idle");
  const videoStatus = generationStatuses.includes(shot.videoStatus || shot.generationStatus)
    ? (shot.videoStatus || shot.generationStatus)
    : mediaUrls.length > 0
      ? "ready"
      : "idle";

  return {
    id: shot.id || createId("shot"),
    rollType: shot.rollType === "A-ROLL" ? "A-ROLL" : "B-ROLL",
    mediaType: "video",
    duration: Number.isFinite(Number(shot.duration)) ? Number(shot.duration) : 5,
    visualPrompt: String(shot.visualPrompt || ""),
    generator: "jimeng-cli",
    configKey: String(shot.configKey || ""),
    materialConfigKey: String(shot.materialConfigKey || (shot.mediaType !== "video" ? shot.configKey || "" : "")),
    storyboardConfigKey: String(shot.storyboardConfigKey || (shot.mediaType !== "video" ? shot.configKey || "" : "")),
    videoConfigKey: String(shot.videoConfigKey || (shot.mediaType === "video" ? shot.configKey || "" : "")),
    inputAssetRefs: uniqueStrings(shot.inputAssetRefs),
    materialPrompt: String(shot.materialPrompt || ""),
    materialAssetRefs: uniqueStrings(shot.materialAssetRefs),
    materialStatus,
    materialTaskId: String(shot.materialTaskId || ""),
    materialError: String(shot.materialError || ""),
    materialRequestedAt: shot.materialRequestedAt || null,
    materialStartedAt: shot.materialStartedAt || null,
    materialCompletedAt: shot.materialCompletedAt || null,
    storyboardPrompt: String(shot.storyboardPrompt || ""),
    storyboardUrl: storyboardUrls[0] || "",
    storyboardUrls,
    storyboardAssetRef,
    storyboardStatus,
    storyboardTaskId: String(shot.storyboardTaskId || ""),
    storyboardError: String(shot.storyboardError || ""),
    storyboardRequestedAt: shot.storyboardRequestedAt || null,
    storyboardStartedAt: shot.storyboardStartedAt || null,
    storyboardCompletedAt: shot.storyboardCompletedAt || null,
    mediaUrl: mediaUrls[0] || "",
    mediaUrls,
    notes: String(shot.notes || ""),
    generationStatus: videoStatus,
    generationTaskId: String(shot.videoTaskId || shot.generationTaskId || ""),
    generationError: String(shot.videoError || shot.generationError || ""),
    generationRequestedAt: shot.videoRequestedAt || shot.generationRequestedAt || null,
    generationStartedAt: shot.videoStartedAt || shot.generationStartedAt || null,
    generationCompletedAt: shot.videoCompletedAt || shot.generationCompletedAt || null,
    videoStatus,
    videoTaskId: String(shot.videoTaskId || shot.generationTaskId || ""),
    videoError: String(shot.videoError || shot.generationError || ""),
    videoRequestedAt: shot.videoRequestedAt || shot.generationRequestedAt || null,
    videoStartedAt: shot.videoStartedAt || shot.generationStartedAt || null,
    videoCompletedAt: shot.videoCompletedAt || shot.generationCompletedAt || null,
    videoConfirmedAt: shot.videoConfirmedAt || null,
    jimengSubmitId: String(shot.jimengSubmitId || "")
  };
}

function normalizeProject(project = {}) {
  const now = new Date().toISOString();
  return {
    id: String(project.id || createId("project")),
    title: String(project.title || "未命名项目").trim() || "未命名项目",
    aspectRatio: normalizeAspectRatio(project.aspectRatio),
    defaultConfigKey: String(project.defaultConfigKey || ""),
    materialConfigKey: String(project.materialConfigKey || project.defaultConfigKey || ""),
    storyboardConfigKey: String(project.storyboardConfigKey || project.defaultConfigKey || ""),
    videoConfigKey: String(project.videoConfigKey || project.defaultConfigKey || ""),
    hasDesign: Boolean(project.hasDesign),
    shots: Array.isArray(project.shots) ? project.shots.map(normalizeShot) : [],
    createdAt: project.createdAt || now,
    updatedAt: project.updatedAt || now
  };
}

function projectDir(projectId) {
  return join(projectsDir, projectId);
}

function projectFile(projectId) {
  return join(projectDir(projectId), "project.json");
}

function projectMediaDir(projectId) {
  return join(projectDir(projectId), "media");
}

function projectDesignFile(projectId) {
  return join(projectDir(projectId), "DESIGN.md");
}

async function readProjectsIndex() {
  return JSON.parse(await readFile(projectsFile, "utf8"));
}

async function saveProjectsIndex(index) {
  await writeFile(projectsFile, `${JSON.stringify(index, null, 2)}\n`, "utf8");
  return index;
}

async function readProject(projectId) {
  if (!safeId(projectId)) throw Object.assign(new Error("Project not found"), { status: 404 });
  try {
    const project = normalizeProject(JSON.parse(await readFile(projectFile(projectId), "utf8")));
    project.hasDesign = await exists(projectDesignFile(projectId));
    return project;
  } catch (error) {
    if (error.code === "ENOENT") throw Object.assign(new Error("Project not found"), { status: 404 });
    throw error;
  }
}

async function saveProject(project) {
  const next = normalizeProject({ ...project, updatedAt: new Date().toISOString() });
  await mkdir(projectMediaDir(next.id), { recursive: true });
  next.hasDesign = await exists(projectDesignFile(next.id));
  await writeFile(projectFile(next.id), `${JSON.stringify(next, null, 2)}\n`, "utf8");

  const index = await readProjectsIndex();
  const record = {
    id: next.id,
    title: next.title,
    aspectRatio: next.aspectRatio,
    hasDesign: next.hasDesign,
    createdAt: next.createdAt,
    updatedAt: next.updatedAt
  };
  const existing = index.projects.findIndex((item) => item.id === next.id);
  if (existing >= 0) index.projects[existing] = record;
  else index.projects.unshift(record);
  await saveProjectsIndex(index);
  return next;
}

async function ensureSettings() {
  if (await exists(settingsFile)) return;
  await writeFile(settingsFile, `${JSON.stringify(defaultSettings, null, 2)}\n`, "utf8");
}

async function readSettings() {
  try {
    return normalizeSettings(JSON.parse(await readFile(settingsFile, "utf8")));
  } catch (error) {
    if (error.code === "ENOENT") {
      await ensureSettings();
      return normalizeSettings(defaultSettings);
    }
    throw error;
  }
}

async function saveSettings(settings) {
  const next = normalizeSettings(settings);
  await writeFile(settingsFile, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return next;
}

async function ensureAssetLibrary() {
  if (await exists(assetLibraryFile)) return;
  await writeFile(assetLibraryFile, `${JSON.stringify({ assets: [] }, null, 2)}\n`, "utf8");
}

async function readAssetLibrary() {
  try {
    const library = JSON.parse(await readFile(assetLibraryFile, "utf8"));
    return {
      assets: Array.isArray(library.assets) ? library.assets.map(normalizeAsset) : []
    };
  } catch (error) {
    if (error.code === "ENOENT") {
      await ensureAssetLibrary();
      return { assets: [] };
    }
    throw error;
  }
}

async function saveAssetLibrary(library) {
  const next = {
    assets: Array.isArray(library.assets) ? library.assets.map(normalizeAsset) : []
  };
  await writeFile(assetLibraryFile, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return next;
}

function mediaUrl(projectId, fileName) {
  return `/media/${encodeURIComponent(projectId)}/${encodeURIComponent(fileName)}`;
}

function assetUrl(fileName) {
  return `/assets/${encodeURIComponent(fileName)}`;
}

function mediaFileNameFromUrl(url) {
  const parts = String(url).split("/");
  return decodeURIComponent(parts.at(-1) || "");
}

async function projectSummary(record) {
  const project = await readProject(record.id);
  const duration = project.shots.reduce((sum, shot) => sum + Number(shot.duration || 0), 0);
  const cover = project.shots.find((shot) => shot.storyboardUrl)?.storyboardUrl || "";
  return {
    ...record,
    shotCount: project.shots.length,
    duration,
    coverUrl: cover,
    hasDesign: project.hasDesign
  };
}

function assetSearchTerms(asset) {
  return uniqueStrings([
    asset.name,
    asset.personName,
    ...asset.aliases,
    ...asset.tags
  ]);
}

function autoReferencedAssetIds(shot, assets) {
  const prompt = `${shot.visualPrompt} ${shot.notes}`.toLocaleLowerCase();
  if (!prompt.trim()) return [];
  return assets
    .filter((asset) => asset.autoReference)
    .filter((asset) => assetSearchTerms(asset)
      .some((term) => term && prompt.includes(term.toLocaleLowerCase())))
    .map((asset) => asset.id);
}

function stageMediaType(stage) {
  return stage === "video" ? "video" : "image";
}

function stageConfigField(stage) {
  if (stage === "materials") return "materialConfigKey";
  if (stage === "storyboard") return "storyboardConfigKey";
  return "videoConfigKey";
}

function resolveModelConfig(settings, project, shot, stage = "video") {
  const field = stageConfigField(stage);
  const mediaType = stageMediaType(stage);
  const wanted = shot[field] || project[field] || shot.configKey || project.defaultConfigKey ||
    (mediaType === "video" ? settings.defaultVideoConfigKey : settings.defaultImageConfigKey) ||
    settings.defaultConfigKey;
  return settings.modelConfigs.find((config) => config.key === wanted && config.mediaType === mediaType) ||
    settings.modelConfigs.find((config) => config.key === (
      mediaType === "video" ? settings.defaultVideoConfigKey : settings.defaultImageConfigKey
    )) ||
    settings.modelConfigs.find((config) => config.mediaType === mediaType) ||
    settings.modelConfigs[0];
}

function compilePrompt(shot, config) {
  const prompt = shot.visualPrompt.trim();
  const prefix = String(config.prompt || "").trim();
  return prefix ? `${prefix}\n\n${prompt}` : prompt;
}

function stageStatus(shot, stage) {
  if (stage === "materials") return shot.materialStatus;
  if (stage === "storyboard") return shot.storyboardStatus;
  return shot.videoStatus;
}

function stageTaskId(shot, stage) {
  if (stage === "materials") return shot.materialTaskId;
  if (stage === "storyboard") return shot.storyboardTaskId;
  return shot.videoTaskId;
}

function stageError(shot, stage) {
  if (stage === "materials") return shot.materialError;
  if (stage === "storyboard") return shot.storyboardError;
  return shot.videoError;
}

function setStagePending(shot, stage) {
  const now = new Date().toISOString();
  if (stage === "materials") {
    shot.materialTaskId = createTaskId();
    shot.materialStatus = "pending";
    shot.materialError = "";
    shot.materialRequestedAt = now;
    shot.materialStartedAt = null;
    shot.materialCompletedAt = null;
    return;
  }
  if (stage === "storyboard") {
    shot.storyboardTaskId = createTaskId();
    shot.storyboardStatus = "pending";
    shot.storyboardError = "";
    shot.storyboardRequestedAt = now;
    shot.storyboardStartedAt = null;
    shot.storyboardCompletedAt = null;
    return;
  }
  shot.videoTaskId = createTaskId();
  shot.generationTaskId = shot.videoTaskId;
  shot.videoStatus = "pending";
  shot.generationStatus = "pending";
  shot.videoError = "";
  shot.generationError = "";
  shot.videoRequestedAt = now;
  shot.generationRequestedAt = now;
  shot.videoStartedAt = null;
  shot.generationStartedAt = null;
  shot.videoCompletedAt = null;
  shot.generationCompletedAt = null;
  shot.videoConfirmedAt = now;
}

function buildStagePrompt(shot, config, stage) {
  const base = compilePrompt(shot, config);
  if (stage === "materials") {
    const extra = shot.materialPrompt.trim() || "分析画面内容需要的人物与场景参考图，生成缺失的关键物料图片，物料图应干净、主体明确、方便后续作为视频参考。";
    return `${extra}\n\n分镜内容：\n${base}`;
  }
  if (stage === "storyboard") {
    const extra = shot.storyboardPrompt.trim() || "基于已有人物、场景物料生成故事板关键镜头图，画面应覆盖剧情关键瞬间、构图明确、可直接作为视频生成参考。";
    return `${extra}\n\n分镜内容：\n${base}`;
  }
  return base;
}

function buildGeneratorConfig(shot, config, project, inputAssets = [], stage = "video") {
  if (config.provider === "image-gen" && stage !== "video") {
    return {
      provider: "image-generation",
      aspectRatio: project.aspectRatio
    };
  }
  const imageInputs = inputAssets.filter((asset) => asset.type === "image");
  return {
    provider: "jimeng-cli",
    imageCommand: imageInputs.length > 0 && stage !== "materials" ? "image2image" : "text2image",
    videoCommand: "multimodal2video",
    modelVersion: stage === "video"
      ? config.jimeng.videoModel
      : config.jimeng.imageModel,
    resolution: stage === "video"
      ? config.jimeng.videoResolution
      : config.jimeng.imageResolution,
    pollSeconds: config.jimeng.pollSeconds,
    newSession: true
  };
}

function projectMediaPathFromUrl(project, url) {
  if (!url) return null;
  const fileName = basename(mediaFileNameFromUrl(url));
  return resolve(projectMediaDir(project.id), fileName);
}

async function generationTask(project, shot, stage = "video") {
  const settings = await readSettings();
  const modelConfig = resolveModelConfig(settings, project, shot, stage);
  const library = await readAssetLibrary();
  const automaticRefs = autoReferencedAssetIds(shot, library.assets);
  const inputAssetIds = uniqueStrings([
    ...shot.inputAssetRefs,
    ...shot.materialAssetRefs,
    ...automaticRefs
  ]);
  const inputAssets = inputAssetIds
    .map((assetId) => library.assets.find((asset) => asset.id === assetId))
    .filter(Boolean)
    .map((asset) => ({
      id: asset.id,
      type: asset.type,
      name: asset.name,
      url: asset.url,
      path: resolve(assetFilesDir, asset.fileName),
      mimeType: asset.mimeType,
      usage: asset.usage,
      autoReferenced: automaticRefs.includes(asset.id) && !shot.inputAssetRefs.includes(asset.id)
    }));
  if (stage === "video") {
    if (shot.storyboardAssetRef) {
      const storyboardAsset = library.assets.find((asset) => asset.id === shot.storyboardAssetRef);
      if (storyboardAsset) {
        inputAssets.push({
          id: storyboardAsset.id,
          type: storyboardAsset.type,
          name: storyboardAsset.name || "故事板图",
          url: storyboardAsset.url,
          path: resolve(assetFilesDir, storyboardAsset.fileName),
          mimeType: storyboardAsset.mimeType,
          usage: "storyboard",
          autoReferenced: false
        });
      }
    } else if (shot.storyboardUrl) {
      inputAssets.push({
        id: `${shot.id}-storyboard`,
        type: "image",
        name: "故事板图",
        url: shot.storyboardUrl,
        path: projectMediaPathFromUrl(project, shot.storyboardUrl),
        mimeType: "image/*",
        usage: "storyboard",
        autoReferenced: false
      });
    }
  }
  const dimensions = aspectRatios[project.aspectRatio];
  const taskId = stageTaskId(shot, stage);
  const taskOutputDir = resolve(rootDir, "generation", project.id, taskId);
  return {
    taskId,
    stage,
    stageLabel: {
      materials: "物料图",
      storyboard: "故事板图",
      video: "视频"
    }[stage],
    projectId: project.id,
    projectTitle: project.title,
    aspectRatio: project.aspectRatio,
    width: dimensions.width,
    height: dimensions.height,
    hasDesign: project.hasDesign,
    designPath: project.hasDesign ? resolve(projectDesignFile(project.id)) : null,
    outputDir: taskOutputDir,
    shotId: shot.id,
    shotIndex: project.shots.findIndex((item) => item.id === shot.id) + 1,
    status: stageStatus(shot, stage),
    generator: stage === "video" ? "jimeng-cli" : modelConfig.provider,
    mediaType: stage === "video" ? "video" : "image",
    duration: shot.duration,
    configKey: modelConfig.key,
    configName: modelConfig.name,
    visualPrompt: shot.visualPrompt,
    compiledPrompt: buildStagePrompt(shot, modelConfig, stage),
    promptTemplates: {
      fixedPrefix: modelConfig.prompt,
      referenceTemplate: modelConfig.referenceTemplate
    },
    inputAssets,
    inputAssetRefs: shot.inputAssetRefs,
    materialAssetRefs: shot.materialAssetRefs,
    storyboardUrl: shot.storyboardUrl,
    storyboardAssetRef: shot.storyboardAssetRef,
    autoAssetRefs: automaticRefs,
    generatorConfig: buildGeneratorConfig(shot, modelConfig, project, inputAssets, stage),
    videoConfirmedAt: shot.videoConfirmedAt,
    jimengSubmitId: shot.jimengSubmitId,
    notes: shot.notes,
    requestedAt: stage === "materials" ? shot.materialRequestedAt : stage === "storyboard" ? shot.storyboardRequestedAt : shot.videoRequestedAt,
    startedAt: stage === "materials" ? shot.materialStartedAt : stage === "storyboard" ? shot.storyboardStartedAt : shot.videoStartedAt,
    completedAt: stage === "materials" ? shot.materialCompletedAt : stage === "storyboard" ? shot.storyboardCompletedAt : shot.videoCompletedAt,
    error: stageError(shot, stage)
  };
}

function isVideoExtension(extension) {
  return [".mp4", ".webm", ".mov"].includes(extension);
}

async function attachMedia(project, shot, sourcePath) {
  const resolvedSource = resolve(String(sourcePath));
  await stat(resolvedSource);
  const extension = extname(resolvedSource).toLowerCase();
  if (!isVideoExtension(extension)) throw new Error("最终产物只支持视频文件");
  const fileName = `${shot.id}-${Date.now()}${extension}`;
  await copyFile(resolvedSource, join(projectMediaDir(project.id), fileName));
  const url = mediaUrl(project.id, fileName);
  shot.mediaUrl = url;
  shot.mediaUrls = uniqueStrings([url, ...(shot.mediaUrls || [])]);
  shot.mediaType = "video";
  shot.generationStatus = "ready";
  shot.generationError = "";
  shot.generationCompletedAt = new Date().toISOString();
  shot.videoStatus = "ready";
  shot.videoError = "";
  shot.videoCompletedAt = shot.generationCompletedAt;
}

async function copyGeneratedAssetToLibrary(sourcePath, shot, body = {}) {
  const resolvedSource = resolve(String(sourcePath));
  await stat(resolvedSource);
  const extension = extname(resolvedSource).toLowerCase();
  const id = createId("asset");
  const fileName = `${id}${extension}`;
  await copyFile(resolvedSource, join(assetFilesDir, fileName));
  const asset = normalizeAsset({
    id,
    type: "image",
    name: body.assetName || body.name || `${shot.id} 物料图`,
    fileName,
    url: assetUrl(fileName),
    mimeType: contentTypes[extension] || "image/*",
    personName: body.personName || "",
    aliases: uniqueStrings(body.aliases),
    tags: uniqueStrings(body.tags),
    usage: body.usage || "shot-material",
    autoReference: body.autoReference !== false
  });
  const library = await readAssetLibrary();
  library.assets.unshift(asset);
  await saveAssetLibrary(library);
  shot.materialAssetRefs = uniqueStrings([...shot.materialAssetRefs, asset.id]);
  return asset;
}

async function attachStoryboard(project, shot, sourcePath) {
  const resolvedSource = resolve(String(sourcePath));
  await stat(resolvedSource);
  const extension = extname(resolvedSource).toLowerCase();
  const fileName = `${shot.id}-storyboard-${Date.now()}${extension}`;
  await copyFile(resolvedSource, join(projectMediaDir(project.id), fileName));
  const url = mediaUrl(project.id, fileName);
  shot.storyboardUrl = url;
  shot.storyboardUrls = uniqueStrings([url, ...(shot.storyboardUrls || [])]);
  shot.storyboardAssetRef = "";
  shot.storyboardStatus = "ready";
  shot.storyboardError = "";
  shot.storyboardCompletedAt = new Date().toISOString();
}

function parseMultipart(buffer, contentType) {
  const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!boundaryMatch) throw new Error("缺少上传边界");
  const boundary = Buffer.from(`--${boundaryMatch[1] || boundaryMatch[2]}`);
  const headerSeparator = Buffer.from("\r\n\r\n");
  let cursor = 0;
  const fields = {};
  let file = null;

  while (cursor < buffer.length) {
    const boundaryStart = buffer.indexOf(boundary, cursor);
    if (boundaryStart < 0) break;
    const partStart = boundaryStart + boundary.length + 2;
    const headerEnd = buffer.indexOf(headerSeparator, partStart);
    if (headerEnd < 0) break;
    const headers = buffer.subarray(partStart, headerEnd).toString("utf8");
    const nextBoundary = buffer.indexOf(boundary, headerEnd + headerSeparator.length);
    if (nextBoundary < 0) break;
    const content = buffer.subarray(headerEnd + headerSeparator.length, nextBoundary - 2);
    const name = headers.match(/name="([^"]+)"/i)?.[1];
    const filename = headers.match(/filename="([^"]*)"/i)?.[1];
    const mimeType = headers.match(/content-type:\s*([^\r\n]+)/i)?.[1]?.trim();
    if (name === "file" && filename) {
      file = { filename, mimeType, content };
    } else if (name) {
      fields[name] = content.toString("utf8");
    }
    cursor = nextBoundary;
  }
  if (!file) throw new Error("没有找到上传文件");
  return { file, fields };
}

async function saveUploadedStageMedia(project, shot, stage, request) {
  const contentType = request.headers["content-type"] || "";
  if (!contentType.startsWith("multipart/form-data")) throw new Error("需要 multipart/form-data");
  const { file, fields } = parseMultipart(await readBodyBuffer(request), contentType);
  const extension = allowedUploads.get(file.mimeType);
  if (!extension) throw new Error("仅支持 PNG、JPEG、WebP、GIF、MP4、WebM 和 MOV");

  if (stage === "video" && !file.mimeType.startsWith("video/")) throw new Error("最终产物只支持视频文件");
  if (stage !== "video" && !file.mimeType.startsWith("image/")) throw new Error("物料图和故事板只支持图片文件");
  const fileName = `${shot.id}-${Date.now()}${extension}`;
  await writeFile(join(projectMediaDir(project.id), fileName), file.content);
  const sourcePath = join(projectMediaDir(project.id), fileName);
  if (stage === "materials") {
    const asset = await copyGeneratedAssetToLibrary(sourcePath, shot, {
      assetName: fields.name || file.filename.replace(/\.[^.]+$/, ""),
      usage: "shot-material",
      autoReference: false
    });
    await rm(sourcePath, { force: true });
    shot.materialStatus = "ready";
    shot.materialTaskId = "";
    shot.materialError = "";
    shot.materialCompletedAt = new Date().toISOString();
    return asset;
  }
  if (stage === "storyboard") {
    const url = mediaUrl(project.id, fileName);
    shot.storyboardUrl = url;
    shot.storyboardUrls = uniqueStrings([url, ...(shot.storyboardUrls || [])]);
    shot.storyboardAssetRef = "";
    shot.storyboardStatus = "ready";
    shot.storyboardTaskId = "";
    shot.storyboardError = "";
    shot.storyboardCompletedAt = new Date().toISOString();
    return null;
  }
  const url = mediaUrl(project.id, fileName);
  shot.mediaUrl = url;
  shot.mediaUrls = uniqueStrings([url, ...(shot.mediaUrls || [])]);
  shot.mediaType = "video";
  shot.generationStatus = "ready";
  shot.generationTaskId = "";
  shot.generationError = "";
  shot.generationCompletedAt = new Date().toISOString();
  shot.videoStatus = "ready";
  shot.videoTaskId = "";
  shot.videoError = "";
  shot.videoCompletedAt = shot.generationCompletedAt;
  return null;
}

async function saveUploadedDesign(project, request) {
  const contentType = request.headers["content-type"] || "";
  if (!contentType.startsWith("multipart/form-data")) throw new Error("需要 multipart/form-data");
  const { file } = parseMultipart(await readBodyBuffer(request, 2 * 1024 * 1024), contentType);
  if (extname(file.filename).toLowerCase() !== ".md") throw new Error("仅支持 Markdown 文件");

  const content = file.content.toString("utf8").replace(/^\uFEFF/, "");
  if (!content.trim()) throw new Error("DESIGN.md 不能为空");
  if (content.includes("\u0000")) throw new Error("DESIGN.md 必须是 UTF-8 文本");

  await writeFile(projectDesignFile(project.id), content, "utf8");
  project.hasDesign = true;
}

async function saveUploadedAsset(request) {
  const contentType = request.headers["content-type"] || "";
  if (!contentType.startsWith("multipart/form-data")) throw new Error("需要 multipart/form-data");
  const { file, fields } = parseMultipart(await readBodyBuffer(request), contentType);
  const extension = allowedAssetUploads.get(file.mimeType);
  if (!extension) throw new Error("物料库仅支持 PNG、JPEG、WebP、GIF、MP3、WAV、M4A 和 AAC");

  const id = createId("asset");
  const fileName = `${id}${extension}`;
  await writeFile(join(assetFilesDir, fileName), file.content);
  const asset = normalizeAsset({
    id,
    type: file.mimeType.startsWith("audio/") ? "audio" : "image",
    name: fields.name || file.filename.replace(/\.[^.]+$/, ""),
    fileName,
    url: assetUrl(fileName),
    mimeType: file.mimeType,
    personName: fields.personName || "",
    aliases: String(fields.aliases || "").split(","),
    tags: String(fields.tags || "").split(","),
    usage: fields.usage || "",
    autoReference: fields.autoReference !== "false"
  });
  const library = await readAssetLibrary();
  library.assets.unshift(asset);
  await saveAssetLibrary(library);
  return asset;
}

async function deleteMaterialAssetFromShot(shot, assetId) {
  const library = await readAssetLibrary();
  const asset = library.assets.find((item) => item.id === assetId);
  shot.materialAssetRefs = shot.materialAssetRefs.filter((id) => id !== assetId);
  shot.inputAssetRefs = shot.inputAssetRefs.filter((id) => id !== assetId);
  if (shot.materialAssetRefs.length === 0) {
    shot.materialStatus = "idle";
    shot.materialTaskId = "";
    shot.materialError = "";
    shot.materialRequestedAt = null;
    shot.materialStartedAt = null;
    shot.materialCompletedAt = null;
  }
  if (asset?.usage === "shot-material") {
    library.assets = library.assets.filter((item) => item.id !== assetId);
    if (asset.fileName) await rm(join(assetFilesDir, asset.fileName), { force: true });
    await saveAssetLibrary(library);
  }
}

async function deleteStageMedia(project, shot, stage, assetId = "") {
  if (stage === "materials") {
    if (shot.materialStatus === "processing") throw Object.assign(new Error("生成中的物料图暂时无法删除"), { status: 409 });
    const targetIds = assetId ? [assetId] : [...shot.materialAssetRefs];
    for (const id of targetIds) await deleteMaterialAssetFromShot(shot, id);
    return;
  }
  if (stage === "storyboard") {
    if (shot.storyboardStatus === "processing") throw Object.assign(new Error("生成中的故事板暂时无法删除"), { status: 409 });
    if (assetId && assetId === shot.storyboardAssetRef) {
      shot.storyboardAssetRef = "";
    }
    const currentUrls = uniqueStrings([shot.storyboardUrl, ...(shot.storyboardUrls || [])]);
    const targetUrls = assetId && currentUrls.includes(assetId) ? [assetId] : (assetId ? [] : currentUrls);
    for (const url of targetUrls) {
      const fileName = basename(mediaFileNameFromUrl(url));
      await rm(join(projectMediaDir(project.id), fileName), { force: true });
    }
    shot.storyboardUrls = assetId ? removeString(currentUrls, assetId) : [];
    shot.storyboardUrl = shot.storyboardUrls[0] || "";
    if (!assetId) shot.storyboardAssetRef = "";
    shot.storyboardStatus = shot.storyboardUrl || shot.storyboardAssetRef ? "ready" : "idle";
    shot.storyboardTaskId = "";
    shot.storyboardError = "";
    if (shot.storyboardStatus === "idle") {
      shot.storyboardRequestedAt = null;
      shot.storyboardStartedAt = null;
      shot.storyboardCompletedAt = null;
    }
    return;
  }
  if (shot.videoStatus === "processing" || shot.generationStatus === "processing") {
    throw Object.assign(new Error("生成中的视频暂时无法删除"), { status: 409 });
  }
  const currentUrls = uniqueStrings([shot.mediaUrl, ...(shot.mediaUrls || [])]);
  const targetUrls = assetId && currentUrls.includes(assetId) ? [assetId] : (assetId ? [] : currentUrls);
  for (const url of targetUrls) {
    const fileName = basename(mediaFileNameFromUrl(url));
    await rm(join(projectMediaDir(project.id), fileName), { force: true });
  }
  shot.mediaUrls = assetId ? removeString(currentUrls, assetId) : [];
  shot.mediaUrl = shot.mediaUrls[0] || "";
  shot.mediaType = "video";
  shot.videoStatus = shot.mediaUrl ? "ready" : "idle";
  shot.generationStatus = "idle";
  shot.videoTaskId = "";
  shot.generationTaskId = "";
  shot.videoError = "";
  shot.generationError = "";
  shot.generationStatus = shot.videoStatus;
  if (!shot.mediaUrl) {
    shot.videoRequestedAt = null;
    shot.generationRequestedAt = null;
    shot.videoStartedAt = null;
    shot.generationStartedAt = null;
    shot.videoCompletedAt = null;
    shot.generationCompletedAt = null;
  }
}

async function findTask(taskId) {
  const index = await readProjectsIndex();
  for (const record of index.projects) {
    const project = await readProject(record.id);
    for (const shot of project.shots) {
      if (shot.materialTaskId === taskId) return { project, shot, stage: "materials" };
      if (shot.storyboardTaskId === taskId) return { project, shot, stage: "storyboard" };
      if (shot.videoTaskId === taskId || shot.generationTaskId === taskId) {
        return { project, shot, stage: "video" };
      }
    }
  }
  return null;
}

function mutateGenerationTask(callback) {
  const mutation = generationMutationQueue.then(callback, callback);
  generationMutationQueue = mutation.catch(() => {});
  return mutation;
}

async function migrateLegacyProject() {
  if (await exists(projectsFile)) return;
  if (!(await exists(legacyDataFile))) {
    await saveProjectsIndex({ projects: [] });
    return;
  }

  const now = new Date().toISOString();
  const projectId = "project-codex-storyboard";
  let project = normalizeProject({
    id: projectId,
    title: "Codex 分镜台",
    aspectRatio: "16:9",
    shots: [],
    createdAt: now,
    updatedAt: now
  });

  const legacy = JSON.parse(await readFile(legacyDataFile, "utf8"));
  project = normalizeProject({
    ...legacy,
    id: projectId,
    title: legacy.title || "Codex 分镜台",
    aspectRatio: "16:9",
    createdAt: now
  });

  await mkdir(projectMediaDir(projectId), { recursive: true });
  if (await exists(legacyMediaDir)) {
    for (const fileName of await readdir(legacyMediaDir)) {
      await copyFile(join(legacyMediaDir, fileName), join(projectMediaDir(projectId), fileName));
    }
  }
  for (const shot of project.shots) {
    if (shot.mediaUrl) shot.mediaUrl = mediaUrl(projectId, mediaFileNameFromUrl(shot.mediaUrl));
  }

  await writeFile(projectFile(projectId), `${JSON.stringify(project, null, 2)}\n`, "utf8");
  await saveProjectsIndex({
    projects: [{
      id: project.id,
      title: project.title,
      aspectRatio: project.aspectRatio,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt
    }]
  });
}

async function serveFile(response, filePath, allowedRoots = [publicDir]) {
  const normalized = resolve(filePath);
  const allowed = allowedRoots.some((base) => {
    const normalizedBase = resolve(base);
    const relativePath = relative(normalizedBase, normalized);
    return relativePath === "" ||
      (!isAbsolute(relativePath) && relativePath !== ".." && !relativePath.startsWith(`..${sep}`));
  });
  if (!allowed) return sendError(response, 403, "Forbidden");

  try {
    const file = await readFile(normalized);
    response.writeHead(200, {
      "content-type": contentTypes[extname(normalized).toLowerCase()] || "application/octet-stream",
      "cache-control": "no-store"
    });
    response.end(file);
  } catch (error) {
    if (error.code === "ENOENT") return sendError(response, 404, "Not found");
    throw error;
  }
}

async function handleProjectsApi(request, response, url) {
  if (request.method === "GET" && url.pathname === "/api/projects") {
    const index = await readProjectsIndex();
    const projects = await Promise.all(index.projects.map(projectSummary));
    return sendJson(response, 200, { projects });
  }

  if (request.method === "POST" && url.pathname === "/api/projects") {
    const body = await readBody(request);
    const project = normalizeProject({
      id: createId("project"),
      title: body.title,
      aspectRatio: body.aspectRatio,
      defaultConfigKey: body.defaultConfigKey,
      materialConfigKey: body.materialConfigKey,
      storyboardConfigKey: body.storyboardConfigKey,
      videoConfigKey: body.videoConfigKey,
      shots: []
    });
    return sendJson(response, 201, await saveProject(project));
  }

  const designMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/design$/);
  if (designMatch) {
    const projectId = decodeURIComponent(designMatch[1]);
    const project = await readProject(projectId);

    if (request.method === "GET") {
      if (!project.hasDesign) return sendError(response, 404, "当前项目没有 DESIGN.md");
      return sendJson(response, 200, {
        hasDesign: true,
        content: await readFile(projectDesignFile(projectId), "utf8")
      });
    }

    if (request.method === "POST") {
      await saveUploadedDesign(project, request);
      return sendJson(response, 200, await saveProject(project));
    }

    if (request.method === "DELETE") {
      await rm(projectDesignFile(projectId), { force: true });
      project.hasDesign = false;
      return sendJson(response, 200, await saveProject(project));
    }

    return false;
  }

  const projectMatch = url.pathname.match(/^\/api\/projects\/([^/]+)$/);
  if (!projectMatch) return false;
  const projectId = decodeURIComponent(projectMatch[1]);

  if (request.method === "GET") {
    return sendJson(response, 200, await readProject(projectId));
  }

  if (request.method === "PUT") {
    const current = await readProject(projectId);
    const body = await readBody(request);
    return sendJson(response, 200, await saveProject({
      ...current,
      title: body.title,
      aspectRatio: body.aspectRatio,
      defaultConfigKey: body.defaultConfigKey,
      materialConfigKey: body.materialConfigKey,
      storyboardConfigKey: body.storyboardConfigKey,
      videoConfigKey: body.videoConfigKey,
      shots: body.shots
    }));
  }

  if (request.method === "PATCH") {
    const project = await readProject(projectId);
    const body = await readBody(request);
    if (body.title !== undefined) project.title = String(body.title).trim() || project.title;
    if (body.aspectRatio !== undefined) project.aspectRatio = normalizeAspectRatio(body.aspectRatio);
    if (body.defaultConfigKey !== undefined) project.defaultConfigKey = String(body.defaultConfigKey || "");
    if (body.materialConfigKey !== undefined) project.materialConfigKey = String(body.materialConfigKey || "");
    if (body.storyboardConfigKey !== undefined) project.storyboardConfigKey = String(body.storyboardConfigKey || "");
    if (body.videoConfigKey !== undefined) project.videoConfigKey = String(body.videoConfigKey || "");
    return sendJson(response, 200, await saveProject(project));
  }

  if (request.method === "DELETE") {
    const project = await readProject(projectId);
    await rm(projectDir(projectId), { recursive: true, force: false });
    const index = await readProjectsIndex();
    index.projects = index.projects.filter((item) => item.id !== projectId);
    await saveProjectsIndex(index);
    return sendJson(response, 200, { deleted: project.id });
  }

  return false;
}

async function handleShotsApi(request, response, url) {
  const collectionMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/shots$/);
  if (collectionMatch && request.method === "POST") {
    const project = await readProject(decodeURIComponent(collectionMatch[1]));
    const body = await readBody(request);
    const incoming = Array.isArray(body.shots) ? body.shots : [body.shot || body];
    project.shots.push(...incoming.map(normalizeShot));
    return sendJson(response, 201, await saveProject(project));
  }

  const shotMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/shots\/([^/]+)$/);
  if (shotMatch) {
    const project = await readProject(decodeURIComponent(shotMatch[1]));
    const shotId = decodeURIComponent(shotMatch[2]);
    const index = project.shots.findIndex((shot) => shot.id === shotId);
    if (index < 0) return sendError(response, 404, "Shot not found");

    if (request.method === "PATCH") {
      const body = await readBody(request);
      project.shots[index] = normalizeShot({ ...project.shots[index], ...body, id: shotId });
      return sendJson(response, 200, await saveProject(project));
    }

    if (request.method === "DELETE") {
      project.shots.splice(index, 1);
      return sendJson(response, 200, await saveProject(project));
    }
  }

  const stageItemMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/shots\/([^/]+)\/(materials|storyboard|video)\/([^/]+)$/);
  if (stageItemMatch) {
    const project = await readProject(decodeURIComponent(stageItemMatch[1]));
    const shot = project.shots.find((item) => item.id === decodeURIComponent(stageItemMatch[2]));
    const stage = stageItemMatch[3];
    if (!shot) return sendError(response, 404, "Shot not found");
    if (request.method === "DELETE") {
      try {
        await deleteStageMedia(project, shot, stage, decodeURIComponent(stageItemMatch[4]));
      } catch (error) {
        return sendError(response, error.status || 500, error.message);
      }
      return sendJson(response, 200, await saveProject(project));
    }
  }

  const stageMediaMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/shots\/([^/]+)\/(materials|storyboard|video)$/);
  if (stageMediaMatch) {
    const project = await readProject(decodeURIComponent(stageMediaMatch[1]));
    const shot = project.shots.find((item) => item.id === decodeURIComponent(stageMediaMatch[2]));
    const stage = stageMediaMatch[3];
    if (!shot) return sendError(response, 404, "Shot not found");

    if (request.method === "POST") {
      if ((request.headers["content-type"] || "").startsWith("multipart/form-data")) {
        await saveUploadedStageMedia(project, shot, stage, request);
      } else {
        const body = await readBody(request);
        if (!body.sourcePath) return sendError(response, 400, "sourcePath is required");
        if (stage === "materials") {
          await copyGeneratedAssetToLibrary(body.sourcePath, shot, body);
          shot.materialStatus = "ready";
          shot.materialTaskId = "";
          shot.materialError = "";
          shot.materialCompletedAt = new Date().toISOString();
        } else if (stage === "storyboard") {
          await attachStoryboard(project, shot, body.sourcePath);
          shot.storyboardTaskId = "";
        } else {
          await attachMedia(project, shot, body.sourcePath);
          shot.videoTaskId = "";
          shot.generationTaskId = "";
        }
      }
      return sendJson(response, 200, await saveProject(project));
    }

    if (request.method === "DELETE") {
      try {
        await deleteStageMedia(project, shot, stage);
      } catch (error) {
        return sendError(response, error.status || 500, error.message);
      }
      return sendJson(response, 200, await saveProject(project));
    }
  }

  const mediaMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/shots\/([^/]+)\/media$/);
  if (mediaMatch) {
    const project = await readProject(decodeURIComponent(mediaMatch[1]));
    const shot = project.shots.find((item) => item.id === decodeURIComponent(mediaMatch[2]));
    if (!shot) return sendError(response, 404, "Shot not found");

    if (request.method === "POST") {
      if ((request.headers["content-type"] || "").startsWith("multipart/form-data")) {
        await saveUploadedStageMedia(project, shot, "video", request);
      } else {
        const body = await readBody(request);
        if (!body.sourcePath) return sendError(response, 400, "sourcePath is required");
        await attachMedia(project, shot, body.sourcePath);
      }
      return sendJson(response, 200, await saveProject(project));
    }

    if (request.method === "DELETE") {
      try {
        await deleteStageMedia(project, shot, "video");
      } catch (error) {
        return sendError(response, error.status || 500, error.message);
      }
      return sendJson(response, 200, await saveProject(project));
    }
  }

  return false;
}

async function handleSettingsApi(request, response, url) {
  if (url.pathname !== "/api/settings") return false;

  if (request.method === "GET") {
    return sendJson(response, 200, await readSettings());
  }

  if (request.method === "PUT") {
    const body = await readBody(request);
    return sendJson(response, 200, await saveSettings(body));
  }

  return false;
}

async function handleAssetsApi(request, response, url) {
  if (request.method === "GET" && url.pathname === "/api/assets") {
    return sendJson(response, 200, await readAssetLibrary());
  }

  if (request.method === "POST" && url.pathname === "/api/assets") {
    const asset = await saveUploadedAsset(request);
    return sendJson(response, 201, { asset, ...(await readAssetLibrary()) });
  }

  const assetMatch = url.pathname.match(/^\/api\/assets\/([^/]+)$/);
  if (!assetMatch) return false;
  const assetId = decodeURIComponent(assetMatch[1]);
  const library = await readAssetLibrary();
  const index = library.assets.findIndex((asset) => asset.id === assetId);
  if (index < 0) return sendError(response, 404, "Asset not found");

  if (request.method === "PATCH") {
    const body = await readBody(request);
    library.assets[index] = normalizeAsset({
      ...library.assets[index],
      name: body.name ?? library.assets[index].name,
      personName: body.personName ?? library.assets[index].personName,
      aliases: body.aliases ?? library.assets[index].aliases,
      tags: body.tags ?? library.assets[index].tags,
      usage: body.usage ?? library.assets[index].usage,
      autoReference: body.autoReference ?? library.assets[index].autoReference,
      updatedAt: new Date().toISOString()
    });
    return sendJson(response, 200, await saveAssetLibrary(library));
  }

  if (request.method === "DELETE") {
    const [asset] = library.assets.splice(index, 1);
    if (asset.fileName) await rm(join(assetFilesDir, asset.fileName), { force: true });
    const projectsIndex = await readProjectsIndex();
    for (const record of projectsIndex.projects) {
      const project = await readProject(record.id);
      let changed = false;
      for (const shot of project.shots) {
        const refs = shot.inputAssetRefs.filter((id) => id !== asset.id);
        if (refs.length !== shot.inputAssetRefs.length) {
          shot.inputAssetRefs = refs;
          changed = true;
        }
        const materialRefs = shot.materialAssetRefs.filter((id) => id !== asset.id);
        if (materialRefs.length !== shot.materialAssetRefs.length) {
          shot.materialAssetRefs = materialRefs;
          shot.materialStatus = materialRefs.length > 0 ? shot.materialStatus : "idle";
          changed = true;
        }
        if (shot.storyboardAssetRef === asset.id) {
          shot.storyboardAssetRef = "";
          shot.storyboardStatus = shot.storyboardUrl ? shot.storyboardStatus : "idle";
          changed = true;
        }
      }
      if (changed) await saveProject(project);
    }
    return sendJson(response, 200, await saveAssetLibrary(library));
  }

  return false;
}

async function handleGenerationApi(request, response, url) {
  if (request.method === "GET" && url.pathname === "/api/generation/tasks") {
    const index = await readProjectsIndex();
    const statuses = (url.searchParams.get("status") || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    const tasks = [];
    for (const record of index.projects) {
      const project = await readProject(record.id);
      const staged = [];
      for (const shot of project.shots) {
        for (const stage of generationStages) {
          if (!stageTaskId(shot, stage)) continue;
          if (statuses.length > 0 && !statuses.includes(stageStatus(shot, stage))) continue;
          staged.push(generationTask(project, shot, stage));
        }
      }
      const projectTasks = await Promise.all(staged);
      tasks.push(...projectTasks);
    }
    return sendJson(response, 200, { tasks });
  }

  if (request.method === "POST" && url.pathname === "/api/generation/tasks") {
    const body = await readBody(request);
    if (!body.projectId) return sendError(response, 400, "projectId is required");
    const stage = generationStages.includes(body.stage) ? body.stage : "video";
    const project = await readProject(String(body.projectId));
    const requestedIds = Array.isArray(body.shotIds) ? new Set(body.shotIds.map(String)) : null;
    const requestedShots = project.shots.filter((shot) => !requestedIds || requestedIds.has(shot.id));
    if (stage === "video") {
      if (requestedShots.length !== 1) return sendError(response, 400, "视频生成只能单个提交，不能批量提交");
      if (body.videoConfirmed !== true) {
        return sendError(response, 400, "视频生成需要用户手动确认");
      }
    }
    const force = body.force === true;
    const queued = [];
    const skipped = [];

    for (const shot of project.shots) {
      if (requestedIds && !requestedIds.has(shot.id)) continue;
      if (!shot.visualPrompt.trim()) {
        skipped.push({ shotId: shot.id, reason: "missing-prompt" });
        continue;
      }
      if (["pending", "processing"].includes(stageStatus(shot, stage))) {
        skipped.push({ shotId: shot.id, reason: stageStatus(shot, stage) });
        continue;
      }
      if (!force && stageStatus(shot, stage) === "ready") {
        skipped.push({ shotId: shot.id, reason: "ready" });
        continue;
      }

      setStagePending(shot, stage);
      queued.push(await generationTask(project, shot, stage));
    }

    const saved = await saveProject(project);
    return sendJson(response, 201, { project: saved, queued, skipped });
  }

  const taskMatch = url.pathname.match(
    /^\/api\/generation\/tasks\/([^/]+)\/(claim|complete|fail|cancel|update)$/
  );
  if (taskMatch && request.method === "POST") {
    return mutateGenerationTask(async () => {
      const [, taskId, action] = taskMatch;
      const found = await findTask(decodeURIComponent(taskId));
      if (!found) return sendError(response, 404, "Generation task not found");
      const { project, shot, stage } = found;
      const body = await readBody(request);

      if (action === "claim") {
        if (stageStatus(shot, stage) !== "pending") {
          return sendError(response, 409, `Task is ${stageStatus(shot, stage)}`);
        }
        if (stage === "materials") {
          shot.materialStatus = "processing";
          shot.materialStartedAt = new Date().toISOString();
        } else if (stage === "storyboard") {
          shot.storyboardStatus = "processing";
          shot.storyboardStartedAt = new Date().toISOString();
        } else {
          shot.videoStatus = "processing";
          shot.generationStatus = "processing";
          shot.videoStartedAt = new Date().toISOString();
          shot.generationStartedAt = shot.videoStartedAt;
        }
      }

      if (action === "complete") {
        if (!body.sourcePath) return sendError(response, 400, "sourcePath is required");
        if (body.jimengSubmitId) shot.jimengSubmitId = String(body.jimengSubmitId);
        if (stage === "materials") {
          await copyGeneratedAssetToLibrary(body.sourcePath, shot, body);
          shot.materialStatus = "ready";
          shot.materialError = "";
          shot.materialCompletedAt = new Date().toISOString();
        } else if (stage === "storyboard") {
          await attachStoryboard(project, shot, body.sourcePath);
        } else {
          await attachMedia(project, shot, body.sourcePath);
          shot.videoStatus = shot.generationStatus;
          shot.videoError = shot.generationError;
          shot.videoCompletedAt = shot.generationCompletedAt;
        }
      }

      if (action === "fail") {
        if (body.jimengSubmitId) shot.jimengSubmitId = String(body.jimengSubmitId);
        if (stage === "materials") {
          shot.materialStatus = "failed";
          shot.materialError = String(body.error || "生成失败");
          shot.materialCompletedAt = new Date().toISOString();
        } else if (stage === "storyboard") {
          shot.storyboardStatus = "failed";
          shot.storyboardError = String(body.error || "生成失败");
          shot.storyboardCompletedAt = new Date().toISOString();
        } else {
          shot.videoStatus = "failed";
          shot.generationStatus = "failed";
          shot.videoError = String(body.error || "生成失败");
          shot.generationError = shot.videoError;
          shot.videoCompletedAt = new Date().toISOString();
          shot.generationCompletedAt = shot.videoCompletedAt;
        }
      }

      if (action === "update") {
        if (body.jimengSubmitId) shot.jimengSubmitId = String(body.jimengSubmitId);
        if (body.error !== undefined) {
          if (stage === "materials") shot.materialError = String(body.error || "");
          else if (stage === "storyboard") shot.storyboardError = String(body.error || "");
          else {
            shot.videoError = String(body.error || "");
            shot.generationError = shot.videoError;
          }
        }
      }

      if (action === "cancel") {
        if (stageStatus(shot, stage) !== "pending") {
          return sendError(response, 409, `Task is ${stageStatus(shot, stage)}`);
        }
        if (stage === "materials") {
          shot.materialStatus = shot.materialAssetRefs.length > 0 ? "ready" : "idle";
          shot.materialTaskId = "";
          shot.materialError = "";
          shot.materialRequestedAt = null;
          shot.materialStartedAt = null;
          shot.materialCompletedAt = shot.materialAssetRefs.length > 0 ? shot.materialCompletedAt : null;
        } else if (stage === "storyboard") {
          shot.storyboardStatus = shot.storyboardUrl ? "ready" : "idle";
          shot.storyboardTaskId = "";
          shot.storyboardError = "";
          shot.storyboardRequestedAt = null;
          shot.storyboardStartedAt = null;
          shot.storyboardCompletedAt = shot.storyboardUrl ? shot.storyboardCompletedAt : null;
        } else {
          shot.videoStatus = shot.mediaUrl ? "ready" : "idle";
          shot.generationStatus = shot.videoStatus;
          shot.videoTaskId = "";
          shot.generationTaskId = "";
          shot.videoError = "";
          shot.generationError = "";
          shot.videoRequestedAt = null;
          shot.generationRequestedAt = null;
          shot.videoStartedAt = null;
          shot.generationStartedAt = null;
          shot.videoCompletedAt = shot.mediaUrl ? shot.videoCompletedAt : null;
          shot.generationCompletedAt = shot.videoCompletedAt;
        }
      }

      const saved = await saveProject(project);
      const savedShot = saved.shots.find((item) => item.id === shot.id);
      return sendJson(response, 200, {
        project: saved,
        task: savedShot ? await generationTask(saved, savedShot, stage) : null
      });
    });
  }

  return false;
}

async function handleApi(request, response, url) {
  if (await handleSettingsApi(request, response, url)) return;
  if (await handleAssetsApi(request, response, url)) return;
  if (await handleProjectsApi(request, response, url)) return;
  if (await handleShotsApi(request, response, url)) return;
  if (await handleGenerationApi(request, response, url)) return;
  return sendError(response, 404, "API not found");
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
    if (url.pathname.startsWith("/api/")) return await handleApi(request, response, url);

    const mediaMatch = url.pathname.match(/^\/media\/([^/]+)\/([^/]+)$/);
    if (mediaMatch) {
      const projectId = decodeURIComponent(mediaMatch[1]);
      const fileName = basename(decodeURIComponent(mediaMatch[2]));
      if (!safeId(projectId)) return sendError(response, 404, "Not found");
      return await serveFile(
        response,
        join(projectMediaDir(projectId), fileName),
        [projectMediaDir(projectId)]
      );
    }

    const assetMatch = url.pathname.match(/^\/assets\/([^/]+)$/);
    if (assetMatch) {
      const fileName = basename(decodeURIComponent(assetMatch[1]));
      return await serveFile(response, join(assetFilesDir, fileName), [assetFilesDir]);
    }

    if (url.pathname === "/" || url.pathname.match(/^\/project\/[^/]+\/?$/)) {
      return await serveFile(response, join(publicDir, "index.html"));
    }
    return await serveFile(response, join(publicDir, decodeURIComponent(url.pathname.slice(1))));
  } catch (error) {
    const status = error.status || 500;
    if (status >= 500) console.error(error);
    return sendError(response, status, error.message || "Internal server error");
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Codex 分镜台已启动：http://127.0.0.1:${port}`);
});
