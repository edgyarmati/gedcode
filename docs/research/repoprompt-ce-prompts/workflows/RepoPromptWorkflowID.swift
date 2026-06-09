import Foundation

enum RepoPromptWorkflowID: String, CaseIterable {
    case build
    case investigate
    case deepPlan
    case reminder
    case oracleExport
    case review
    case refactor
    case orchestrate
    case optimize

    var commandName: String {
        switch self {
        case .build: "rp-build"
        case .investigate: "rp-investigate"
        case .deepPlan: "rp-deep-plan"
        case .reminder: "rp-reminder"
        case .oracleExport: "rp-oracle-export"
        case .review: "rp-review"
        case .refactor: "rp-refactor"
        case .orchestrate: "rp-orchestrate"
        case .optimize: "rp-optimize"
        }
    }

    static let mcpPromptOrder: [RepoPromptWorkflowID] = [
        .build,
        .investigate,
        .deepPlan,
        .reminder,
        .oracleExport,
        .review,
        .refactor,
        .orchestrate,
        .optimize
    ]

    static let installOrder: [RepoPromptWorkflowID] = [
        .investigate,
        .build,
        .reminder,
        .oracleExport,
        .review,
        .refactor,
        .orchestrate,
        .optimize,
        .deepPlan
    ]
}
