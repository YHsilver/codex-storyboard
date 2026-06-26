---
name: process-storyboard-tasks
description: Process pending Codex Storyboard image and video generation tasks. Use when the user asks to generate storyboard assets, process the storyboard queue, generate all shots, generate a specific storyboard row, or return Image Generation or Jimeng CLI outputs to the local storyboard.
---

# Process Codex Storyboard Tasks

Process the local storyboard queue at `http://127.0.0.1:43218`.

## Workflow
> all command execute in local machine (not in sandbox)

1. Call `list_storyboard_generation_tasks` with status `pending`.
2. Verify the capability required by each pending task before claiming it:

   - `image-gen` requires the built-in `imagegen` skill and image generation tool.
   - `jimeng-cli` requires the local `dreamina` command. Run `dreamina -h` and `dreamina user_credit` before claiming Jimeng tasks.

   If a required capability is unavailable, do not claim affected tasks. Report the missing capability and continue with tasks whose generators are available.

3. Before running any Dreamina video generation command (`dreamina multimodal2video`, `image2video`, `text2video`, `frames2video`, or similar), show the user the final submission parameters in the current chat turn and wait for explicit confirmation. Include the final prompt, model version, duration, aspect ratio, video resolution, poll interval, image inputs, audio inputs, output directory, and the exact command shape you will run. This confirmation is required even if command approval, auto-approval, or "approve for me" mode is enabled. Do not treat the storyboard app's queue confirmation as permission to run Dreamina from Codex; it only permits queue creation. Querying an existing `jimengSubmitId` with `dreamina query_result` does not require this extra confirmation.
4. Prefer stage order when multiple stages are pending for the same project: `materials`, then `storyboard`, then `video`. Stages are not hard dependencies; process a later stage if it is queued even when prior outputs are absent.
5. Process generation tasks in batches of up to 5 concurrent tasks. Start a new batch only after every task in the current batch has completed, failed, or been recorded as async `querying`.
6. Before generating each task in a batch, call `claim_storyboard_generation_task` for that task. If a claim fails, skip only that task and continue with other tasks in the batch.
7. If the claimed task has `hasDesign: true`, read the complete Markdown file at the exact absolute `designPath` before generating anything.
8. Build the final API prompt yourself from `compiledPrompt`. The task already resolved the shot/project/global model configuration into `configKey`, `configName`, `compiledPrompt`, `promptPrefix`, `referenceTemplate`, `inputAssets`, and `generatorConfig`.

   - `compiledPrompt` is an instruction packet for Codex/this skill, not necessarily the exact text to send to the image or video API.
   - If `promptPrefix` or `promptTemplates.fixedPrefix` is present, copy it verbatim to the very beginning of the final API prompt.
   - Treat `referenceTemplate` / `promptTemplates.referenceTemplate` as a strong recommended format. Rewrite it for the current shot, fill or remove placeholders, add concrete scene details, and delete sections that do not apply.
   - For `video` tasks, treat `referenceTemplate` as a strong format constraint: preserve its structure, section order, style requirements, and negative controls as much as possible, and mainly fill in shot-specific story, camera/action details, and `[图1]` references.
   - Refer to images only with labels such as `[图1]`, `[图2]`, matching `inputAssets[].imageLabel` and input order exactly.
   - For `video` tasks with subject audio, bind each subject's audio to the subject the first time that subject is introduced with an image label. Use a compact form such as `主体A：[图1]，声音/台词参考：@音频1` or `主体A：[图1]，音色参考：@音频1`, matching the audio input order you will pass to Dreamina. If the same subject appears again later in the prompt, keep using the subject name and image label only; do not repeat the audio reference.
   - When multiple subjects have separate image/audio references, explicitly pair each first subject mention with its corresponding image label and audio label so Dreamina does not confuse voices between subjects. Do not attach an audio label to a different subject just because it appears nearby in `inputAssets`; infer pairings from asset names, aliases, `usage`, shot text, and project design only.
   - For `video` tasks, include a storyboard/`【分镜】` section only when a current-shot storyboard image is present in `inputAssets`. If no storyboard image is available, remove the entire storyboard/`【分镜】` module from the final API prompt instead of leaving an empty heading or generic text.
   - Do not read image/audio file contents to understand references. Use only file names, asset names, `usage`, `imageLabel`, shot text, and DESIGN.md when present.
9. Route by `stage`, `generator`, and `mediaType`:

   - `materials`: generate only missing material references for the current shot. If subject/person references already exist in `inputAssets` or the stage goal says a subject exists, do not generate any character/person/subject image. If the stage goal says the scene/background is missing, generate a clean empty establishing scene/background image with no people, no subjects, no text, and no watermark. Complete with `mediaType: "image"` and provide useful `assetName`, `tags`, or `aliases`; completion adds the output to the material library and references it on the shot.
   - `storyboard`: generate the key storyboard frame for the current shot only; subject images, manual references, and current-shot material images are already included in `inputAssets` when available. Complete with `mediaType: "image"`; completion stores it as the shot storyboard image.
   - `video`: always use `dreamina multimodal2video`, regardless of input asset count or type. Build the final prompt with strong adherence to the model config `referenceTemplate`, then pass available current-shot subject images with repeated `--image`, available subject audio with repeated `--audio`, manual references, material images, storyboard images, final `--prompt`, `--model_version`, `--duration`, `--ratio`, `--video_resolution`, and `--poll` values from the task. The `--ratio` value must match the task/project `aspectRatio` such as `9:16`; do not rely on Dreamina defaults. Do not complete a newly queued video task from an existing project video, previous `mediaUrl`, previous `mediaUrls`, or a stale `jimengSubmitId`; only complete it from the local file returned by the current Dreamina submission or by querying the task's current `jimengSubmitId`. Complete with `mediaType: "video"`; completion stores it as the final video output.
   - For non-video `image-gen` tasks, use the built-in image generation tool, honor `aspectRatio`, and use `inputAssets` as image references when the tool supports references.
   - For non-video `jimeng-cli` tasks without image inputs, use `dreamina text2image --prompt=... --ratio=... --resolution_type=... --model_version=... --poll=...`.
   - For non-video `jimeng-cli` tasks with image inputs, use `dreamina image2image --images=a.png,b.png --prompt=... --ratio=... --resolution_type=... --model_version=... --poll=...`.

10. If Jimeng returns a finished local file, verify it and call `complete_storyboard_generation_task`.
11. If Jimeng returns `querying` with `submit_id`, call `update_storyboard_generation_task` with that `jimengSubmitId`, then later run `dreamina query_result --submit_id=... --download_dir=<outputDir>` and complete the task after the downloaded file is verified.
12. If generation or verification fails, call `fail_storyboard_generation_task` with a concise cause.
13. Continue in batches of up to 5 until no processable pending tasks remain.

## Output locations

Use the exact absolute `outputDir` supplied by the task. Put downloaded Jimeng outputs and any temporary prompt files in that directory. The MCP completion tool copies the final image or video into the storyboard media directory.

## Guardrails

- Do not mark a task complete until the exact local file has been visually or technically verified.
- Video tasks may be batch-confirmed by the storyboard app; process queued video tasks in batches of up to 5 after they appear in the queue.
- Preserve `projectId`, `aspectRatio`, `width`, `height`, and requested video `duration`.
- Never guess, truncate, or partially read `DESIGN.md` when `hasDesign` is true.
- Do not apply a DESIGN.md from the active workspace or another project.
- When reporting Jimeng failures, include the command that was run, the error summary, the CLI version if available, and mention logs under `~/.dreamina_cli/logs/`.
- Prefer updating Jimeng CLI with `curl -fsSL https://jimeng.jianying.com/cli | bash` before retrying version-related or unexplained CLI failures.
