import Foundation

enum SelectedGitDiffArtifactPolicy {
    case includeBeforeGitInclusion
    case respectGitInclusion
}

struct PromptContextPreAssemblyRequest {
    let cfg: PromptContextResolved
    let selection: StoredSelection
    let store: WorkspaceFileContextStore
    let lookupContext: WorkspaceLookupContext
    let filePathDisplay: FilePathDisplay
    let onlyIncludeRootsWithSelectedFiles: Bool
    let includeFileTreeLegend: Bool
    let showCodeMapMarkers: Bool
    let codeMapUsage: CodeMapUsage
    let entryResolutionProfile: PathLocateProfile
    let selectedGitDiffFolderPolicy: SelectedGitDiffFolderPolicy
    let selectedGitDiffLookupProfile: PathLocateProfile
    let includeLocalDefinitionsInFileTree: Bool
    let selectedGitDiffArtifactPolicy: SelectedGitDiffArtifactPolicy
    let selectedGitDiffProvider: ([String]) async -> String?
    let completeGitDiffProvider: () async -> String?

    init(
        cfg: PromptContextResolved,
        selection: StoredSelection,
        store: WorkspaceFileContextStore,
        lookupContext: WorkspaceLookupContext,
        filePathDisplay: FilePathDisplay,
        onlyIncludeRootsWithSelectedFiles: Bool,
        includeFileTreeLegend: Bool = true,
        showCodeMapMarkers: Bool,
        codeMapUsage: CodeMapUsage? = nil,
        entryResolutionProfile: PathLocateProfile = .uiAssisted,
        selectedGitDiffFolderPolicy: SelectedGitDiffFolderPolicy,
        selectedGitDiffLookupProfile: PathLocateProfile? = nil,
        includeLocalDefinitionsInFileTree: Bool = false,
        selectedGitDiffArtifactPolicy: SelectedGitDiffArtifactPolicy = .includeBeforeGitInclusion,
        selectedGitDiffProvider: @escaping ([String]) async -> String?,
        completeGitDiffProvider: @escaping () async -> String?
    ) {
        self.cfg = cfg
        self.selection = selection
        self.store = store
        self.lookupContext = lookupContext
        self.filePathDisplay = filePathDisplay
        self.onlyIncludeRootsWithSelectedFiles = onlyIncludeRootsWithSelectedFiles
        self.includeFileTreeLegend = includeFileTreeLegend
        self.showCodeMapMarkers = showCodeMapMarkers
        self.codeMapUsage = codeMapUsage ?? cfg.codeMapUsage
        self.entryResolutionProfile = entryResolutionProfile
        self.selectedGitDiffFolderPolicy = selectedGitDiffFolderPolicy
        self.selectedGitDiffLookupProfile = selectedGitDiffLookupProfile ?? entryResolutionProfile
        self.includeLocalDefinitionsInFileTree = includeLocalDefinitionsInFileTree
        self.selectedGitDiffArtifactPolicy = selectedGitDiffArtifactPolicy
        self.selectedGitDiffProvider = selectedGitDiffProvider
        self.completeGitDiffProvider = completeGitDiffProvider
    }
}

struct PromptContextPreAssemblyResult {
    let physicalSelection: StoredSelection
    let entries: [ResolvedPromptFileEntry]
    let missingPaths: [String]
    let invalidPaths: [String]
    let codemapSnapshots: [UUID: WorkspaceCodemapSnapshot]
    let fileTreeContent: String?
    let gitDiff: String?
    let lookupContext: WorkspaceLookupContext
    let filePathDisplay: FilePathDisplay

    func displayPath(for entry: ResolvedPromptFileEntry) -> String? {
        lookupContext.bindingProjection?.projectedLogicalDisplayPath(
            forPhysicalPath: entry.file.standardizedFullPath,
            display: filePathDisplay
        )
    }
}

enum PromptContextPreAssemblyService {
    static func resolve(_ request: PromptContextPreAssemblyRequest) async -> PromptContextPreAssemblyResult {
        let physicalSelection = request.lookupContext.physicalizeSelection(request.selection)
        let accountingService = PromptContextAccountingService()
        let resolution = await accountingService.resolveEntries(
            selection: physicalSelection,
            store: request.store,
            rootScope: request.lookupContext.rootScope,
            profile: request.entryResolutionProfile,
            codeMapUsage: request.codeMapUsage
        )
        let codemapSnapshots = await request.store.codemapSnapshotDictionary()
        let fileTreeContent = await resolveFileTreeContent(
            request: request,
            physicalSelection: physicalSelection,
            entries: resolution.entries,
            codemapSnapshots: codemapSnapshots
        )
        let gitDiff = await resolveGitDiff(request: request, physicalSelection: physicalSelection, entries: resolution.entries)
        let packagingEntries = entriesForPackaging(request: request, entries: resolution.entries)

        return PromptContextPreAssemblyResult(
            physicalSelection: physicalSelection,
            entries: packagingEntries,
            missingPaths: resolution.missingPaths,
            invalidPaths: resolution.invalidPaths,
            codemapSnapshots: codemapSnapshots,
            fileTreeContent: fileTreeContent,
            gitDiff: gitDiff,
            lookupContext: request.lookupContext,
            filePathDisplay: request.filePathDisplay
        )
    }

    private static func resolveFileTreeContent(
        request: PromptContextPreAssemblyRequest,
        physicalSelection: StoredSelection,
        entries: [ResolvedPromptFileEntry],
        codemapSnapshots: [UUID: WorkspaceCodemapSnapshot]
    ) async -> String? {
        guard request.cfg.rendersFileTree else { return nil }

        let rawFileTreeSnapshot = await request.store.makeFileTreeSelectionSnapshot(
            selection: physicalSelection,
            request: WorkspaceFileTreeSnapshotRequest(
                mode: WorkspaceFileTreeSnapshotMode(fileTreeOption: request.cfg.effectiveFileTreeMode),
                filePathDisplay: request.filePathDisplay,
                onlyIncludeRootsWithSelectedFiles: request.onlyIncludeRootsWithSelectedFiles,
                includeLegend: request.includeFileTreeLegend,
                showCodeMapMarkers: request.showCodeMapMarkers,
                rootScope: request.lookupContext.rootScope
            ),
            profile: request.entryResolutionProfile
        )
        let fileTreeSnapshot = request.lookupContext.bindingProjection?.logicalizeFileTreeSnapshot(rawFileTreeSnapshot) ?? rawFileTreeSnapshot
        let tree = CodeMapExtractor.generateFileTree(using: fileTreeSnapshot)
        let localDefinitions = await resolveLocalDefinitionBlock(
            request: request,
            entries: entries,
            codemapSnapshots: codemapSnapshots,
            fileTreeSnapshot: fileTreeSnapshot
        )
        let combined = [tree, localDefinitions].filter { !$0.isEmpty }.joined(separator: "\n\n")
        return combined.isEmpty ? nil : combined
    }

    private static func resolveLocalDefinitionBlock(
        request: PromptContextPreAssemblyRequest,
        entries: [ResolvedPromptFileEntry],
        codemapSnapshots: [UUID: WorkspaceCodemapSnapshot],
        fileTreeSnapshot: FileTreeSelectionSnapshot
    ) async -> String {
        guard request.includeLocalDefinitionsInFileTree else { return "" }
        let (_, codeEntries) = PromptPackagingService.partitionPromptEntriesForGitDiff(entries)
        let hasCodemapEntries = codeEntries.contains { $0.isCodemap && codemapSnapshots[$0.file.id]?.fileAPI != nil }
        guard !hasCodemapEntries else { return "" }

        let rootInfos = fileTreeSnapshot.roots.map {
            CodeMapExtractor.RootInfo(
                standardizedRootFullPath: $0.standardizedRootPath,
                displayName: $0.name
            )
        }
        let allFileAPIs = await request.store.allCodemapFileAPIs()
        return CodeMapExtractor.buildLocalDefinitionBlockIfNeeded(
            codeMapUsage: request.codeMapUsage,
            selectedFiles: codeEntries.filter { !$0.isCodemap }.map(\.file),
            allFileAPIs: allFileAPIs,
            filePathDisplay: request.filePathDisplay,
            roots: rootInfos
        ).text
    }

    private static func entriesForPackaging(
        request: PromptContextPreAssemblyRequest,
        entries: [ResolvedPromptFileEntry]
    ) -> [ResolvedPromptFileEntry] {
        guard request.selectedGitDiffArtifactPolicy == .respectGitInclusion,
              request.cfg.gitInclusion == .none
        else { return entries }
        let (_, codeEntries) = PromptPackagingService.partitionPromptEntriesForGitDiff(entries)
        return codeEntries
    }

    private static func resolveGitDiff(
        request: PromptContextPreAssemblyRequest,
        physicalSelection: StoredSelection,
        entries: [ResolvedPromptFileEntry]
    ) async -> String? {
        let (diffEntries, _) = PromptPackagingService.partitionPromptEntriesForGitDiff(entries)
        if request.selectedGitDiffArtifactPolicy == .respectGitInclusion,
           request.cfg.gitInclusion == .none
        {
            return nil
        }

        return await PromptPackagingService.resolveGitDiff(fromDiffEntries: diffEntries) {
            switch request.cfg.gitInclusion {
            case .none:
                return nil
            case .selected:
                let selectedPaths = await WorkspaceGitDiffSelectionResolver.selectedGitDiffPaths(
                    for: physicalSelection,
                    store: request.store,
                    rootScope: request.lookupContext.rootScope,
                    folderPolicy: request.selectedGitDiffFolderPolicy,
                    profile: request.selectedGitDiffLookupProfile,
                    allowFilesystemFallback: request.lookupContext.rootScope.allowsSelectedGitDiffFilesystemFallback
                )
                return await request.selectedGitDiffProvider(selectedPaths)
            case .complete:
                if request.lookupContext.bindingProjection != nil {
                    return PromptContextGitDiffPolicy.deferredCompleteWorktreeGitDiffMessage
                }
                return await request.completeGitDiffProvider()
            }
        }
    }
}
