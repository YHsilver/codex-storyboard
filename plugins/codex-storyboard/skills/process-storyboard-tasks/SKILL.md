---
name: process-storyboard-tasks
description: Process pending Codex Storyboard image and video generation tasks. Use when the user asks to generate storyboard assets, process the storyboard queue, generate all shots, generate a specific storyboard row, or return Image Generation or Jimeng CLI outputs to the local storyboard.
---

# Process Codex Storyboard Tasks

Process the local storyboard queue at `http://127.0.0.1:43218`.

## Workflow

1. Call `list_storyboard_generation_tasks` with status `pending`.
2. Verify the capability required by each pending task before claiming it:

   - `image-gen` requires the built-in `imagegen` skill and image generation tool.
   - `jimeng-cli` requires the local `dreamina` command. Run `dreamina -h` and `dreamina user_credit` before claiming Jimeng tasks.

   If a required capability is unavailable, do not claim affected tasks. Report the missing capability and continue with tasks whose generators are available.

3. Prefer stage order when multiple stages are pending for the same project: `materials`, then `storyboard`, then `video`. Stages are not hard dependencies; process a later stage if it is queued even when prior outputs are absent.
4. Material, storyboard image, and video tasks can be queued in batches from the storyboard UI, but process claimed tasks one at a time.
5. Before generating, call `claim_storyboard_generation_task`.
6. If the claimed task has `hasDesign: true`, read the complete Markdown file at the exact absolute `designPath` before generating anything.
7. Build the prompt from `compiledPrompt`. The task already resolved the shot/project/global model configuration into `configKey`, `configName`, `compiledPrompt`, and `generatorConfig`. Treat `promptTemplates.referenceTemplate` as guidance only; do not append it unless it clearly improves the specific generation.
8. Route by `stage`, `generator`, and `mediaType`:

   - `materials`: generate missing character or scene reference images described by `compiledPrompt`; subject images and manual references are already included in `inputAssets` when available. Complete with `mediaType: "image"` and provide useful `assetName`, `personName`, `tags`, or `aliases` when obvious; completion adds the output to the material library and references it on the shot.
   - `storyboard`: generate the key storyboard frame for the shot using `compiledPrompt`; subject images, manual references, and material images are already included in `inputAssets` when available. Complete with `mediaType: "image"`; completion stores it as the shot storyboard image.
   - `video`: always use `dreamina multimodal2video`, regardless of input asset count or type. Pass available subject image/audio, manual references, material images, storyboard images, `--prompt`, `--model_version`, `--duration`, `--video_resolution`, and `--poll` values from the task. Complete with `mediaType: "video"`; completion stores it as the final video output.
   - For non-video `image-gen` tasks, use the built-in image generation tool, honor `aspectRatio`, and use `inputAssets` as image references when the tool supports references.
   - For non-video `jimeng-cli` tasks without image inputs, use `dreamina text2image --prompt=... --ratio=... --resolution_type=... --model_version=... --poll=...`.
   - For non-video `jimeng-cli` tasks with image inputs, use `dreamina image2image --images=a.png,b.png --prompt=... --ratio=... --resolution_type=... --model_version=... --poll=...`.

9. If Jimeng returns a finished local file, verify it and call `complete_storyboard_generation_task`.
10. If Jimeng returns `querying` with `submit_id`, call `update_storyboard_generation_task` with that `jimengSubmitId`, then later run `dreamina query_result --submit_id=... --download_dir=<outputDir>` and complete the task after the downloaded file is verified.
11. If generation or verification fails, call `fail_storyboard_generation_task` with a concise cause.
12. Continue until no processable pending tasks remain.

## Output locations

Use the exact absolute `outputDir` supplied by the task. Put downloaded Jimeng outputs and any temporary prompt files in that directory. The MCP completion tool copies the final image or video into the storyboard media directory.

## Guardrails

- Do not mark a task complete until the exact local file has been visually or technically verified.
- Video tasks may be batch-confirmed by the storyboard app; process each queued video task individually after it appears in the queue.
- Preserve `projectId`, `aspectRatio`, `width`, `height`, and requested video `duration`.
- Never guess, truncate, or partially read `DESIGN.md` when `hasDesign` is true.
- Do not apply a DESIGN.md from the active workspace or another project.
- When reporting Jimeng failures, include the command that was run, the error summary, the CLI version if available, and mention logs under `~/.dreamina_cli/logs/`.
- Prefer updating Jimeng CLI with `curl -fsSL https://jimeng.jianying.com/cli | bash` before retrying version-related or unexplained CLI failures.
