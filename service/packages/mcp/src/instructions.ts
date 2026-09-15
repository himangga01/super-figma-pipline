/**
 * The `instructions` string returned with `initialize`, which clients may fold into the model's
 * system prompt.
 *
 * Claude Code users get this guidance from the skills in `skills/`. Every other client — Cursor,
 * Codex, Windsurf — gets nothing, and the prompts that were meant to be the cross-client twin of
 * those skills only help once someone deliberately invokes one. This is the only channel that is
 * always present, so it carries the part of the workflow the tool descriptions structurally cannot:
 * which tool to reach for first, and why.
 *
 * It is deliberately short. Clients may put it in the system prompt of every session, so anything
 * here is paid for on every turn — it earns its place only by describing order and intent, never by
 * restating what a tool's own description already says.
 */
export const SERVER_INSTRUCTIONS = `Super Figma Pipeline reads Figma through a paired Desktop plugin without requiring built-in MCP or Dev Mode. File access and plugin permission are required. Use \`ping\` for connection health and \`get_selection\` or \`get_metadata\` for document access.

Before coding, run \`analyze_project\` and \`scan_components\` on the registered target workspace. Read existing pages and components with the coding client's file tools to follow routing, import aliases, component APIs, styling, themes, state/data access, accessibility and tests. Scans are evidence, not a complete learned architecture. Use \`component_map\`, \`token_map\` and \`icon_map\` to reuse existing code and tokens; inspect each proposed match and flag uncertainty.

Ground every section with \`get_design_context\`: structure, layout, colours, fonts, variables and component properties come from its data. Preserve the tree's nesting and each frame's layout, padding and gap; never infer measurements from screenshots or replace layout with arbitrary coordinates. Follow a sectionPlan at full detail when a tree is too large. Export real assets with \`save_image_fills\` or \`save_screenshots\`.

Inspect \`get_reactions\`, annotations, variants and motion for interactions; flag missing or inferred behavior. Implement in the project's conventions, run its checks, and compare the rendered UI with \`get_screenshot\` at relevant viewports and states.

For code-to-Figma work, \`get_variable_defs\`, \`get_local_components\` and \`get_styles\` inspect Figma. \`scan_components\` inspects source code. Figma component discovery is scoped to a selection or subtree, not all remote libraries. Reuse components and bind variables that match the intent.`;
