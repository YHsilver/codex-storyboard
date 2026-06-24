import readline from "node:readline";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";

const SERVER_NAME = "Codex Storyboard MCP";
const SERVER_VERSION = "0.4.0";
const DEFAULT_URL = "http://127.0.0.1:43218";
const ASPECT_RATIOS = ["9:16", "16:9", "3:4", "4:3", "1:1"];

const JsonRpcError = {
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602
};

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function sendResult(id, result) {
  send({ jsonrpc: "2.0", id, result });
}

function sendError(id, code, message) {
  send({ jsonrpc: "2.0", id, error: { code, message } });
}

function storyboardUrl(args = {}) {
  return String(args.storyboardUrl || process.env.CODEX_STORYBOARD_URL || DEFAULT_URL).replace(/\/+$/, "");
}

async function requestJson(path, options = {}, args = {}) {
  const response = await fetch(`${storyboardUrl(args)}${path}`, options);
  const text = await response.text();
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : {};
}

function jsonOptions(body, method = "POST") {
  return {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  };
}

function shotSchema({ requireId = false } = {}) {
  return {
    type: "object",
    properties: {
      ...(requireId ? { shotId: { type: "string" } } : {}),
      rollType: { type: "string", enum: ["A-ROLL", "B-ROLL"] },
      mediaType: { type: "string", enum: ["image", "video"] },
      duration: { type: "number", minimum: 0 },
      dialogue: { type: "string" },
      visualPrompt: { type: "string" },
      generator: {
        type: "string",
        enum: ["manual", "image-gen", "hyperframes", "remotion"]
      },
      notes: { type: "string" }
    },
    ...(requireId ? { required: ["shotId"] } : {}),
    additionalProperties: false
  };
}

function projectSummary(project) {
  return {
    id: project.id,
    title: project.title,
    aspectRatio: project.aspectRatio,
    shotCount: Array.isArray(project.shots) ? project.shots.length : Number(project.shotCount || 0),
    hasDesign: Boolean(project.hasDesign),
    duration: project.duration
  };
}

async function uploadDesign(projectId, designPath, args) {
  const content = await readFile(designPath);
  const form = new FormData();
  form.append("file", new Blob([content], { type: "text/markdown" }), basename(designPath));
  return requestJson(
    `/api/projects/${encodeURIComponent(projectId)}/design`,
    { method: "POST", body: form },
    args
  );
}

function tools() {
  return [
    {
      name: "list_storyboard_projects",
      title: "List Storyboard Projects",
      description: "List local storyboard project summaries, optionally filtered by title.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Optional case-insensitive title search." },
          storyboardUrl: { type: "string", description: `Storyboard URL. Defaults to ${DEFAULT_URL}.` }
        },
        additionalProperties: false
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    {
      name: "get_storyboard_project",
      title: "Get Storyboard Project",
      description: "Get one storyboard project with its complete shot list.",
      inputSchema: {
        type: "object",
        properties: {
          projectId: { type: "string" },
          storyboardUrl: { type: "string" }
        },
        required: ["projectId"],
        additionalProperties: false
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    {
      name: "create_storyboard_project",
      title: "Create Storyboard Project",
      description: "Create a complete storyboard project in one call, including all shots and an optional local DESIGN.md.",
      inputSchema: {
        type: "object",
        properties: {
          title: { type: "string" },
          aspectRatio: { type: "string", enum: ASPECT_RATIOS },
          shots: { type: "array", items: shotSchema() },
          designPath: {
            type: "string",
            description: "Optional absolute path to a local Markdown visual specification."
          },
          storyboardUrl: { type: "string" }
        },
        required: ["title", "aspectRatio", "shots"],
        additionalProperties: false
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false
      }
    },
    {
      name: "update_storyboard_project",
      title: "Update Storyboard Project",
      description: "Update project metadata, append shots, patch specific shots, delete shots, or replace/remove DESIGN.md in one call.",
      inputSchema: {
        type: "object",
        properties: {
          projectId: { type: "string" },
          title: { type: "string" },
          aspectRatio: { type: "string", enum: ASPECT_RATIOS },
          appendShots: { type: "array", items: shotSchema() },
          shotUpdates: { type: "array", items: shotSchema({ requireId: true }) },
          deleteShotIds: { type: "array", items: { type: "string" } },
          designPath: {
            type: "string",
            description: "Optional absolute path to a replacement local DESIGN.md."
          },
          removeDesign: { type: "boolean" },
          storyboardUrl: { type: "string" }
        },
        required: ["projectId"],
        additionalProperties: false
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false
      }
    },
    {
      name: "delete_storyboard_project",
      title: "Delete Storyboard Project",
      description: "Permanently delete a storyboard project and all of its local media.",
      inputSchema: {
        type: "object",
        properties: {
          projectId: { type: "string" },
          storyboardUrl: { type: "string" }
        },
        required: ["projectId"],
        additionalProperties: false
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false
      }
    },
    {
      name: "list_storyboard_generation_tasks",
      title: "List Storyboard Generation Tasks",
      description: "List pending, processing, ready, or failed image/video generation tasks from the local Codex storyboard.",
      inputSchema: {
        type: "object",
        properties: {
          status: {
            type: "string",
            description: "Comma-separated statuses. Defaults to pending. Values: pending,processing,ready,failed."
          },
          storyboardUrl: { type: "string", description: `Storyboard URL. Defaults to ${DEFAULT_URL}.` }
        },
        additionalProperties: false
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    {
      name: "claim_storyboard_generation_task",
      title: "Claim Storyboard Generation Task",
      description: "Mark a pending storyboard task as processing before starting Image Generation, HyperFrames, or Remotion work.",
      inputSchema: {
        type: "object",
        properties: {
          taskId: { type: "string" },
          storyboardUrl: { type: "string" }
        },
        required: ["taskId"],
        additionalProperties: false
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false
      }
    },
    {
      name: "complete_storyboard_generation_task",
      title: "Complete Storyboard Generation Task",
      description: "Copy a generated local image or video into the storyboard media directory and mark the task ready.",
      inputSchema: {
        type: "object",
        properties: {
          taskId: { type: "string" },
          sourcePath: { type: "string", description: "Absolute path to the generated PNG/JPEG/WebP/MP4/WebM/MOV." },
          mediaType: { type: "string", enum: ["image", "video"] },
          storyboardUrl: { type: "string" }
        },
        required: ["taskId", "sourcePath"],
        additionalProperties: false
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false
      }
    },
    {
      name: "fail_storyboard_generation_task",
      title: "Fail Storyboard Generation Task",
      description: "Mark a storyboard generation task failed and return a visible error message to the row.",
      inputSchema: {
        type: "object",
        properties: {
          taskId: { type: "string" },
          error: { type: "string" },
          storyboardUrl: { type: "string" }
        },
        required: ["taskId", "error"],
        additionalProperties: false
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false
      }
    }
  ];
}

async function callTool(id, params) {
  const args = params?.arguments ?? {};

  if (params?.name === "list_storyboard_projects") {
    const result = await requestJson("/api/projects", {}, args);
    const query = String(args.query || "").trim().toLocaleLowerCase();
    const projects = result.projects
      .filter((project) => !query || project.title.toLocaleLowerCase().includes(query))
      .map(projectSummary);
    sendResult(id, {
      content: [{
        type: "text",
        text: projects.length === 0
          ? "No matching storyboard projects."
          : projects.map((project) =>
            `${project.id} | ${project.title} | ${project.aspectRatio} | ${project.shotCount} shots`
          ).join("\n")
      }],
      structuredContent: { projects }
    });
    return;
  }

  if (params?.name === "get_storyboard_project") {
    const project = await requestJson(
      `/api/projects/${encodeURIComponent(args.projectId)}`,
      {},
      args
    );
    sendResult(id, {
      content: [{
        type: "text",
        text: `${project.title} | ${project.aspectRatio} | ${project.shots.length} shots`
      }],
      structuredContent: { project }
    });
    return;
  }

  if (params?.name === "create_storyboard_project") {
    let project;
    try {
      project = await requestJson(
        "/api/projects",
        jsonOptions({ title: args.title, aspectRatio: args.aspectRatio }),
        args
      );
      if (args.shots.length > 0) {
        project = await requestJson(
          `/api/projects/${encodeURIComponent(project.id)}/shots`,
          jsonOptions({ shots: args.shots }),
          args
        );
      }
      if (args.designPath) project = await uploadDesign(project.id, args.designPath, args);
    } catch (error) {
      if (project?.id) {
        await requestJson(
          `/api/projects/${encodeURIComponent(project.id)}`,
          { method: "DELETE" },
          args
        ).catch(() => {});
      }
      throw error;
    }

    const summary = projectSummary(project);
    sendResult(id, {
      content: [{
        type: "text",
        text: `Created ${summary.title} (${summary.aspectRatio}) with ${summary.shotCount} shots. Project ID: ${summary.id}`
      }],
      structuredContent: { project: summary }
    });
    return;
  }

  if (params?.name === "update_storyboard_project") {
    if (args.designPath && args.removeDesign) {
      throw new Error("designPath and removeDesign cannot be used together");
    }
    const project = await requestJson(
      `/api/projects/${encodeURIComponent(args.projectId)}`,
      {},
      args
    );
    if (args.title !== undefined) project.title = args.title;
    if (args.aspectRatio !== undefined) project.aspectRatio = args.aspectRatio;

    const updates = new Map((args.shotUpdates || []).map((shot) => [shot.shotId, shot]));
    for (const shotId of updates.keys()) {
      if (!project.shots.some((shot) => shot.id === shotId)) {
        throw new Error(`Shot not found: ${shotId}`);
      }
    }
    project.shots = project.shots
      .filter((shot) => !(args.deleteShotIds || []).includes(shot.id))
      .map((shot) => {
        const update = updates.get(shot.id);
        if (!update) return shot;
        const { shotId, ...fields } = update;
        return { ...shot, ...fields };
      });
    project.shots.push(...(args.appendShots || []));

    let saved = await requestJson(
      `/api/projects/${encodeURIComponent(project.id)}`,
      jsonOptions({
        title: project.title,
        aspectRatio: project.aspectRatio,
        shots: project.shots
      }, "PUT"),
      args
    );
    if (args.designPath) saved = await uploadDesign(saved.id, args.designPath, args);
    if (args.removeDesign) {
      saved = await requestJson(
        `/api/projects/${encodeURIComponent(saved.id)}/design`,
        { method: "DELETE" },
        args
      );
    }

    const summary = projectSummary(saved);
    sendResult(id, {
      content: [{
        type: "text",
        text: `Updated ${summary.title} (${summary.aspectRatio}); ${summary.shotCount} shots.`
      }],
      structuredContent: { project: summary }
    });
    return;
  }

  if (params?.name === "delete_storyboard_project") {
    const project = await requestJson(
      `/api/projects/${encodeURIComponent(args.projectId)}`,
      {},
      args
    );
    await requestJson(
      `/api/projects/${encodeURIComponent(args.projectId)}`,
      { method: "DELETE" },
      args
    );
    sendResult(id, {
      content: [{ type: "text", text: `Deleted ${project.title} (${project.id}).` }],
      structuredContent: { deleted: { id: project.id, title: project.title } }
    });
    return;
  }

  if (params?.name === "list_storyboard_generation_tasks") {
    const status = encodeURIComponent(args.status || "pending");
    const result = await requestJson(`/api/generation/tasks?status=${status}`, {}, args);
    const summary = result.tasks.length === 0
      ? "No matching storyboard generation tasks."
      : result.tasks
          .map((task) => `${task.taskId} | ${task.projectTitle} (${task.aspectRatio}) | shot ${task.shotIndex} | ${task.generator} | ${task.mediaType} | ${task.status} | design: ${task.hasDesign ? task.designPath : "none"} | output: ${task.outputDir}\n${task.visualPrompt}`)
          .join("\n\n");
    sendResult(id, {
      content: [{ type: "text", text: summary }],
      structuredContent: result
    });
    return;
  }

  if (params?.name === "claim_storyboard_generation_task") {
    const result = await requestJson(
      `/api/generation/tasks/${encodeURIComponent(args.taskId)}/claim`,
      jsonOptions({}),
      args
    );
    sendResult(id, {
      content: [{ type: "text", text: `Claimed ${args.taskId} from ${result.task.projectTitle} (${result.task.aspectRatio}) for ${result.task.generator}.` }],
      structuredContent: result
    });
    return;
  }

  if (params?.name === "complete_storyboard_generation_task") {
    const result = await requestJson(
      `/api/generation/tasks/${encodeURIComponent(args.taskId)}/complete`,
      jsonOptions({ sourcePath: args.sourcePath, mediaType: args.mediaType }),
      args
    );
    sendResult(id, {
      content: [{ type: "text", text: `Completed ${args.taskId}; asset returned to ${result.task.projectTitle}, shot ${result.task.shotIndex}.` }],
      structuredContent: result
    });
    return;
  }

  if (params?.name === "fail_storyboard_generation_task") {
    const result = await requestJson(
      `/api/generation/tasks/${encodeURIComponent(args.taskId)}/fail`,
      jsonOptions({ error: args.error }),
      args
    );
    sendResult(id, {
      content: [{ type: "text", text: `Marked ${args.taskId} failed: ${args.error}` }],
      structuredContent: result
    });
    return;
  }

  sendError(id, JsonRpcError.INVALID_PARAMS, `Unknown tool: ${params?.name ?? ""}`);
}

async function handle(message) {
  const { id, method, params } = message;

  if (method === "initialize") {
    sendResult(id, {
      protocolVersion: params?.protocolVersion ?? "2025-11-25",
      capabilities: { tools: {} },
      serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
      instructions:
        "Use project tools to create and manage storyboard projects directly through the local API. Use generation tools to process queued assets. Never edit data files directly or complete a generation task before verifying its output."
    });
    return;
  }

  if (method === "ping") return sendResult(id, {});
  if (method === "tools/list") return sendResult(id, { tools: tools() });

  if (method === "tools/call") {
    try {
      await callTool(id, params);
    } catch (error) {
      sendError(id, JsonRpcError.INVALID_PARAMS, error instanceof Error ? error.message : String(error));
    }
    return;
  }

  if (id !== undefined) sendError(id, JsonRpcError.METHOD_NOT_FOUND, `Method not found: ${method}`);
}

const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
lines.on("line", (line) => {
  if (!line.trim()) return;
  try {
    const message = JSON.parse(line);
    handle(message).catch((error) => {
      if (message.id !== undefined) sendError(message.id, JsonRpcError.INVALID_PARAMS, String(error));
    });
  } catch {
    // Ignore non-JSON stdout input.
  }
});
