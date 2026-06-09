import Foundation

/// Actor that coordinates validation of installed workspace skills and Codex prompts.
/// Ensures validations are serialized to avoid concurrent file writes.
actor MCPPromptValidationService {
    static let shared = MCPPromptValidationService()

    private init() {}

    // MARK: - Workspace Skills (Per-Workspace)

    /// Validates workspace skills for the given workspace root folders.
    /// Only updates skills if they were previously installed (files exist or stored version exists).
    /// - Parameter workspaceRoots: Array of workspace root folder paths
    /// - Returns: Number of skills successfully validated/updated
    @discardableResult
    func validateWorkspaceSkills(forRoots workspaceRoots: [String]) async -> Int {
        guard !workspaceRoots.isEmpty else { return 0 }

        var totalUpdated = 0

        for root in workspaceRoots {
            // Validate both MCP and CLI variants if installed
            totalUpdated += await validateWorkspaceSkillsIfInstalled(workspacePath: root, useCLIVariant: false)
            totalUpdated += await validateWorkspaceSkillsIfInstalled(workspacePath: root, useCLIVariant: true)
        }

        return totalUpdated
    }

    /// Validates workspace skills for a single workspace path if previously installed.
    /// Uses updateExistingOnly mode to only update files that exist and are managed by RepoPrompt.
    /// This prevents re-adding skills that users have intentionally removed.
    private func validateWorkspaceSkillsIfInstalled(workspacePath: String, useCLIVariant: Bool) async -> Int {
        // Check if any managed skills exist
        guard MCPIntegrationHelper.workspaceSkillsInstalled(workspacePath: workspacePath, useCLIVariant: useCLIVariant) else {
            return 0
        }

        // Validate/update only existing managed files - never recreate deleted ones
        return MCPIntegrationHelper.installWorkspaceSkills(
            workspacePath: workspacePath,
            useCLIVariant: useCLIVariant,
            mode: .updateExistingOnly
        )
    }

    // MARK: - Codex Prompts (Global)

    /// Validates Codex prompts on app launch.
    /// Only updates prompts if they were previously installed (files exist or stored version exists).
    /// - Returns: Number of prompts successfully validated/updated
    @discardableResult
    func validateCodexPromptsOnLaunch() async -> Int {
        var totalUpdated = 0

        // Validate both MCP and CLI variants if installed
        totalUpdated += await validateCodexCommandsIfInstalled(useCLIVariant: false)
        totalUpdated += await validateCodexCommandsIfInstalled(useCLIVariant: true)

        return totalUpdated
    }

    /// Validates Codex commands if previously installed.
    /// Uses updateExistingOnly mode to only update files that exist and are managed by RepoPrompt.
    /// This prevents re-adding commands that users have intentionally removed.
    private func validateCodexCommandsIfInstalled(useCLIVariant: Bool) async -> Int {
        // Check if any managed commands exist
        guard MCPIntegrationHelper.codexCommandsInstalled(useCLIVariant: useCLIVariant) else {
            return 0
        }

        // Validate/update only existing managed files - never recreate deleted ones
        return MCPIntegrationHelper.installCodexCommands(
            useCLIVariant: useCLIVariant,
            mode: .updateExistingOnly
        )
    }
}
