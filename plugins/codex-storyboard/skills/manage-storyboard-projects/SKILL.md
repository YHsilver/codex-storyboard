---
name: manage-storyboard-projects
description: Create, find, inspect, update, or delete Codex Storyboard projects directly through MCP. Use when the user asks Codex to write a new video script or storyboard into the local storyboard app, add or revise shots, rename a project, change its aspect ratio, find an existing project, or delete one without browser automation.
---

# Manage Storyboard Projects

Use the Codex Storyboard MCP project tools. Never control the browser and never edit `data/` files directly.

## Create a project

1. Turn the user's request into a complete shot list before calling the tool.
2. When the project should use specific model configurations, set `materialConfigKey`, `storyboardConfigKey`, and/or `videoConfigKey`; use per-shot stage keys only when a shot intentionally differs.
3. Call `create_storyboard_project` once with the project title, aspect ratio, all shots, and optional absolute `designPath`.
4. Do not create shots one at a time.
5. Return the created project ID and tell the user to refresh or open the storyboard.

Each shot should include:

- `rollType`: `A-ROLL` for primary presentation or spoken footage; `B-ROLL` for supporting visuals.
- `duration`: seconds.
- `visualPrompt`: concrete visual description used for asset generation, including dialogue, sound, subtitles, and motion notes when relevant.
- `materialConfigKey`: optional image model override for the material-image stage.
- `storyboardConfigKey`: optional image model override for the storyboard-image stage.
- `videoConfigKey`: optional video model override for the final video stage.
- `inputAssetRefs`: optional material library asset IDs to use as references.
- `subjectAssetRefs`: optional subject material IDs for recurring people; subject images may be used for material/storyboard generation, and subject images/audio should be used for video generation.
- `materialAssetRefs`: optional image material library asset IDs to show as material-image outputs.
- `storyboardAssetRef`: optional image material library asset ID to use as the storyboard output.
- `notes`: editing, pacing, transition, or production notes.

Final shot output is always video. Material images and storyboard images are independent stage outputs; if they exist or are selected from the material library, the server automatically carries them into later generation tasks.

When a project should use recurring characters, scenes, or style references, call `list_storyboard_assets` first and set matching `inputAssetRefs` on the relevant shots. The storyboard server also auto-references library assets by name, person name, alias, and tag when generation tasks are queued.

## Find and inspect

- Use `list_storyboard_projects` first when the project ID is unknown. Pass `query` when the user gives a title.
- Use `get_storyboard_project` only when complete shot content is needed.
- Do not fetch every full project merely to find one title.

## Update

Use one `update_storyboard_project` call:

- `title` or `aspectRatio` for project metadata.
- `materialConfigKey`, `storyboardConfigKey`, or `videoConfigKey` for project stage defaults.
- `appendShots` for new shots.
- `shotUpdates` for specific existing shots.
- `deleteShotIds` for removed shots.
- `designPath` to import or replace DESIGN.md.
- `removeDesign: true` to remove it.

Fetch the complete project first only when shot IDs or existing content are required.

## Delete

Project deletion permanently removes the project and its local media. Ask for explicit confirmation immediately before calling `delete_storyboard_project`.

## Token discipline

- Create the complete project with one MCP call.
- Prefer project summaries over full project reads.
- Return concise results instead of repeating the full script after it has been written.
