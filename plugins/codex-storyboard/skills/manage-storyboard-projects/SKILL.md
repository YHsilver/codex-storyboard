---
name: manage-storyboard-projects
description: Create, find, inspect, update, or delete Codex Storyboard projects directly through MCP. Use when the user asks Codex to write a new video script or storyboard into the local storyboard app, add or revise shots, rename a project, change its aspect ratio, find an existing project, or delete one without browser automation.
---

# Manage Storyboard Projects

Use the Codex Storyboard MCP project tools. Never control the browser and never edit `data/` files directly.

## Create a project

1. Turn the user's request into a complete shot list before calling the tool.
2. Call `create_storyboard_project` once with the project title, aspect ratio, all shots, and optional absolute `designPath`.
3. Do not create shots one at a time.
4. Return the created project ID and tell the user to refresh or open the storyboard.

Each shot should include:

- `rollType`: `A-ROLL` for primary presentation or spoken footage; `B-ROLL` for supporting visuals.
- `mediaType`: `image` or `video`.
- `duration`: seconds.
- `dialogue`: spoken line for the shot.
- `visualPrompt`: concrete visual description used for asset generation.
- `generator`: `manual`, `image-gen`, `hyperframes`, or `remotion`.
- `notes`: editing, pacing, transition, or production notes.

Choose `generator` deliberately:

- `manual`: recorded presenter footage, screen recordings, or existing local material.
- `image-gen`: a static generated visual.
- `hyperframes`: designed motion graphics or interface animation.
- `remotion`: programmatic React-based video composition.

## Find and inspect

- Use `list_storyboard_projects` first when the project ID is unknown. Pass `query` when the user gives a title.
- Use `get_storyboard_project` only when complete shot content is needed.
- Do not fetch every full project merely to find one title.

## Update

Use one `update_storyboard_project` call:

- `title` or `aspectRatio` for project metadata.
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
