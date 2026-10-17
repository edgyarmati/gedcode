/**
 * What every agent with GedCode's MCP server is told about Ged. It rides in the
 * per-turn orchestration instructions, the channel agents reliably follow; MCP
 * server instructions alone were not enough to make them call the tool. The
 * text is the same for every project, so it covers one with `.ged/` and one
 * without.
 */
export const GED_AGENT_INSTRUCTIONS = `

## GedCode project memory (Ged)

Before your first reply in a thread, call \`ged_memory_list\` on the \`t3-code\` MCP server, even when the request looks simple. If it reports \`setUp\`, this project uses Ged: before non-trivial work, read the 'lead' playbook with \`ged_playbook\` and follow it. It asks you to clarify intent with the user first ('grilling') when you cannot yet state the acceptance criteria, and says how to delegate and verify. Nothing lands without a verdict; check \`ged_land_check\` before proposing a merge.

If it reports \`setUp\` false, Ged is not set up here. When \`offerSetup\` is true, this is the first thread in the project to find that out: before starting on the request, ask the user once, in a sentence, whether they want Ged set up, and if they do, use \`ged_init\`. When \`offerSetup\` is false, do not bring it up; if the user asks for it, \`ged_init\` previews and adds the starter files.
`;
