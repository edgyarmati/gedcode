/**
 * What every agent connected to GedCode's MCP server is told about Ged. The
 * server's instructions are the same for every project, so this covers both a
 * project with `.ged/` and one without.
 */
export const GED_MCP_INSTRUCTIONS = `GedCode project memory (Ged).

If ged_memory_list succeeds, this project uses Ged: before non-trivial work, read the 'lead'
playbook with ged_playbook and follow it. It asks you to clarify intent with the user first
('grilling') when you cannot yet state the acceptance criteria, and says how to delegate and verify.
Nothing lands without a verdict; check ged_land_check before proposing a merge.

If ged_memory_list reports no memory tree, Ged is not set up here. Do not bring it up; if the user
asks for it, ged_init previews and adds the starter files.`;
