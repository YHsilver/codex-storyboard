# Dreamina CLI Reference

Use this reference only after the user manually confirms the exact `dreamina` command that will run.

## Capability Checks

These checks do not submit generation jobs:

```bash
dreamina -h
dreamina version
dreamina user_credit
```

## Async Results

Use the current task's `jimengSubmitId` only:

```bash
dreamina query_result --submit_id=<submit_id> --download_dir=<output_dir>
```

If a generation command returns `querying` or another async state with `submit_id`, record it with `update_storyboard_generation_task` and resume later by querying the same ID.

## Image Generation

Use `text2image` when there are no image inputs:

```bash
dreamina text2image \
  --prompt="<final prompt>" \
  --ratio=<aspectRatio> \
  --resolution_type=<resolutionType> \
  --model_version=<modelVersion> \
  --poll=<pollSeconds>
```

Use `image2image` when image inputs exist:

```bash
dreamina image2image \
  --images=<image1>,<image2> \
  --prompt="<final prompt>" \
  --ratio=<aspectRatio> \
  --resolution_type=<resolutionType> \
  --model_version=<modelVersion> \
  --poll=<pollSeconds>
```

Limits:

- `image2image` supports 1 to 10 images.
- `--ratio` must match the task `aspectRatio`.
- Use the task `outputDir` for downloaded outputs.

## Video Generation

Storyboard video tasks always use `multimodal2video`:

```bash
dreamina multimodal2video \
  --image <image1> \
  --image <image2> \
  --audio <audio1> \
  --prompt="<final prompt>" \
  --model_version=<modelVersion> \
  --video_resolution=<videoResolution> \
  --duration=<duration> \
  --ratio=<aspectRatio> \
  --poll=<pollSeconds>
```

Rules:

- Pass image inputs as repeated `--image` arguments in `inputAssets` order.
- Pass subject audio inputs as repeated `--audio` arguments in `inputAssets` order.
- Input limits: images up to 9, videos up to 3, audio up to 3.
- `--ratio` must match the task `aspectRatio`; do not rely on Dreamina defaults.
- Common Seedance model values include `seedance2.0`, `seedance2.0fast`, `seedance2.0_vip`, `seedance2.0fast_vip`, and `seedance2.0mini`.
- `seedance2.0_vip` supports `720p` or `1080p`; other Seedance 2.0 models generally support `720p`.
- Video duration is typically 4 to 15 seconds.

## Failure Notes

- `post-TNS check did not pass` usually means video moderation rejected the prompt; revise the prompt and retry only after user direction.
- For version-related or unexplained CLI failures, report the CLI version and logs under `~/.dreamina_cli/logs/`.
