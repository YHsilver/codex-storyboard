---
name: process-storyboard-tasks
description: Process pending or resumable Codex Storyboard image and video generation tasks. Use when the user asks to generate storyboard assets, process the storyboard queue, generate all shots, generate a specific storyboard row, resume interrupted generation, or return Image Generation or Jimeng CLI outputs to the local storyboard.
---

# Process Codex Storyboard Tasks

Process the local storyboard queue at `http://127.0.0.1:43218`.

## Required References

- When any task uses `jimeng-cli`, read `references/dreamina-cli.md` before building or running Dreamina commands.

## Workflow

1. Call `list_storyboard_generation_tasks` with `status: "processing,pending"` and `includePrompt: false`.
2. Resume processing tasks first when `canResume: true` and `jimengSubmitId` is present. Query the current submit ID and complete the task only from the current downloaded local file.
3. Then process pending tasks in stage order: `materials`, `storyboard`, `video`. Stages are not hard dependencies; process a later stage if it is queued.
4. Verify the capability required by each task before claiming it:

   - `image-gen` requires the built-in Image Generation tool.
   - `jimeng-cli` requires the local `dreamina` command. `dreamina -h`, `dreamina version`, and `dreamina user_credit` may be used for capability checks.

5. Before running any Dreamina command that submits, polls, downloads, changes account state, or spends credits, ask the user to manually confirm the exact command. This includes `dreamina text2image`, `image2image`, `multimodal2video`, and `query_result`.
6. For tasks selected for a batch, call `list_storyboard_generation_tasks` again with `taskId`, `includePrompt: true`, and the current status before claim/resume so the complete prompt payload is available.
7. Process up to 5 concurrent tasks per batch. Start a new batch only after every task in the current batch has completed, failed, or has been recorded as async processing with `jimengSubmitId`.
8. Before generating a pending task, call `claim_storyboard_generation_task` with a `workerId` and a practical `leaseSeconds`. If claim fails, skip only that task.
9. If a claimed task has `hasDesign: true`, read the complete Markdown file at the exact absolute `designPath` before generating anything.
10. Build the final API prompt from `compiledPrompt`, `promptPrefix`, `referenceTemplate`, `inputAssets`, `subjectPairs`, `commandPlan`, and DESIGN.md when present:

   - `compiledPrompt` is an instruction packet for this skill, not necessarily the exact text to send to the image or video API.
   - If `promptPrefix` or `promptTemplates.fixedPrefix` is present, copy it verbatim to the beginning of the final API prompt.
   - Treat `referenceTemplate` as a strong recommended format. For video tasks, preserve its structure, section order, style requirements, and negative controls as much as possible.
   - Refer to images and audio only with labels such as `@图片1` and `@音频1`, matching `inputAssets` order exactly.
   - Use `subjectPairs` to bind subject images and audio. Do not attach audio to a different subject just because it appears nearby in `inputAssets`.
   - Include a storyboard or `【分镜】` section only when a current-shot storyboard image is present in `inputAssets`.
   - Do not read image/audio file contents to understand references. Use file names, asset names, usage, labels, shot text, subject notes, and DESIGN.md.

11. Route by `stage`, `generator`, and `mediaType`:

   - `materials`: generate only missing material references for the current shot. If subject/person references already exist in `inputAssets` or the stage goal says a subject exists, do not generate any character/person/subject image. If the stage goal says the scene/background is missing, generate a clean empty establishing scene/background image with no people, no subjects, no text, and no watermark. Complete with `mediaType: "image"` and useful `assetName`, `tags`, or `aliases`.
   - `storyboard`: generate the key storyboard frame for the current shot only. Complete with `mediaType: "image"`.
   - `video`: always use `dreamina multimodal2video`, pass the current task's image/audio inputs, final prompt, model version, duration, ratio, video resolution, poll value, and output directory. The `--ratio` value must match `aspectRatio`.
   - For non-video `image-gen` tasks, use Image Generation, honor `aspectRatio`, and use `inputAssets` as references when supported.
   - For non-video `jimeng-cli` tasks, use `text2image` with no image inputs and `image2image` with image inputs.

12. If Jimeng returns a finished local file, verify it and call `complete_storyboard_generation_task`.
13. If Jimeng returns async/querying with `submit_id`, call `update_storyboard_generation_task` with `jimengSubmitId`; later resume by querying that same submit ID and completing from the downloaded local file.
14. If generation or verification fails, call `fail_storyboard_generation_task` with a concise cause.
15. Continue until no processable pending or resumable processing tasks remain.

## Output Locations

Use the exact absolute `outputDir` supplied by the task. Put downloaded Jimeng outputs and temporary prompt files in that directory. The MCP completion tool copies the final image or video into the storyboard media directory.

## Guardrails

- Do not mark a task complete until the exact local file has been visually or technically verified.
- Do not complete a video task from an existing project video, previous `mediaUrl`, previous `mediaUrls`, or a stale `jimengSubmitId`.
- Preserve `projectId`, `aspectRatio`, `width`, `height`, and requested video `duration`.
- Never guess, truncate, or partially read `DESIGN.md` when `hasDesign` is true.
- Do not apply a DESIGN.md from the active workspace or another project.
- When reporting Jimeng failures, include the confirmed command, error summary, CLI version if available, and mention logs under `~/.dreamina_cli/logs/`.
