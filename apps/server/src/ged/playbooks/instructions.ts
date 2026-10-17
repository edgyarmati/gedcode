import { GED_AGENT_INSTRUCTIONS } from "@t3tools/provider-core/server/orchestrationInstructions";

/**
 * The MCP server's own instructions repeat the Ged guidance agents also get
 * per turn, for harnesses that read only these.
 */
export const GED_MCP_INSTRUCTIONS = GED_AGENT_INSTRUCTIONS.trim();
