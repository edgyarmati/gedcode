import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import { createHash } from "node:crypto";

import {
  CANONICAL_PROJECT_CONTEXT_PATHS,
  classifyProjectContextContent,
  makeProjectContextSnapshot,
  MAX_PROJECT_CONTEXT_FILE_BYTES,
  normalizeProjectContextContent,
  type ProjectContextFile,
  type ProjectContextOwnershipFile,
} from "../ProjectContext.ts";
import { GED_MANIFEST_PATH } from "../GedManifest.ts";
import {
  ProjectContextScanner,
  ProjectContextScannerError,
  type ProjectContextScannerShape,
} from "../Services/ProjectContextScanner.ts";
import { WorkspacePaths } from "../../workspace/Services/WorkspacePaths.ts";

const ADR_DIRECTORY = "docs/adr";
const isMarkdownFileName = (name: string): boolean =>
  name.endsWith(".md") && !name.includes("/") && !name.includes("\\");

const scannerError = (workspaceRoot: string, operation: string, detail: string) =>
  new ProjectContextScannerError({ workspaceRoot, operation, detail });

const containsRuntimeDirectory = (value: string): boolean =>
  value.split(/[\\/]+/).some((segment) => segment === ".gedcode");

export const makeProjectContextScanner = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const workspacePaths = yield* WorkspacePaths;

  const isInside = (root: string, candidate: string): boolean => {
    const relative = path.relative(root, candidate).replaceAll("\\", "/");
    return (
      relative === "" ||
      (!relative.startsWith("../") && relative !== ".." && !path.isAbsolute(relative))
    );
  };

  const resolveInsideRoot = Effect.fn("ProjectContextScanner.resolveInsideRoot")(function* (
    workspaceRoot: string,
    realWorkspaceRoot: string,
    relativePath: string,
  ) {
    const resolved = yield* workspacePaths
      .resolveRelativePathWithinRoot({ workspaceRoot, relativePath })
      .pipe(Effect.mapError((error) => scannerError(workspaceRoot, "resolve", error.message)));
    if (!isInside(workspaceRoot, resolved.absolutePath)) {
      return yield* scannerError(
        workspaceRoot,
        "resolve",
        `Path escapes workspace root: ${relativePath}`,
      );
    }
    return resolved.absolutePath;
  });

  const readRegularUtf8File = Effect.fn("ProjectContextScanner.readRegularUtf8File")(function* (
    workspaceRoot: string,
    realWorkspaceRoot: string,
    relativePath: string,
  ): Effect.fn.Return<
    { readonly file: ProjectContextFile; readonly ownership: ProjectContextOwnershipFile } | null,
    ProjectContextScannerError
  > {
    const absolutePath = yield* resolveInsideRoot(workspaceRoot, realWorkspaceRoot, relativePath);
    if (
      !(yield* fileSystem
        .exists(absolutePath)
        .pipe(
          Effect.mapError(() =>
            scannerError(workspaceRoot, "exists", `Cannot inspect ${relativePath}`),
          ),
        ))
    ) {
      return null;
    }

    const info = yield* fileSystem
      .stat(absolutePath)
      .pipe(
        Effect.mapError(() =>
          scannerError(workspaceRoot, "stat", `Cannot inspect ${relativePath}`),
        ),
      );
    if (info.type !== "File") {
      return yield* scannerError(
        workspaceRoot,
        "stat",
        `Project context path is not a regular file: ${relativePath}`,
      );
    }
    if (info.size > BigInt(MAX_PROJECT_CONTEXT_FILE_BYTES)) {
      return yield* scannerError(
        workspaceRoot,
        "read",
        `Project context file exceeds ${MAX_PROJECT_CONTEXT_FILE_BYTES} bytes: ${relativePath}`,
      );
    }

    const realFilePath = yield* fileSystem
      .realPath(absolutePath)
      .pipe(
        Effect.mapError(() =>
          scannerError(workspaceRoot, "realPath", `Cannot resolve ${relativePath}`),
        ),
      );
    if (!isInside(realWorkspaceRoot, realFilePath)) {
      return yield* scannerError(
        workspaceRoot,
        "realPath",
        `Project context path escapes workspace root: ${relativePath}`,
      );
    }

    const bytes = yield* fileSystem
      .readFile(absolutePath)
      .pipe(
        Effect.mapError(() => scannerError(workspaceRoot, "read", `Cannot read ${relativePath}`)),
      );
    if (bytes.byteLength > MAX_PROJECT_CONTEXT_FILE_BYTES) {
      return yield* scannerError(
        workspaceRoot,
        "read",
        `Project context file exceeds ${MAX_PROJECT_CONTEXT_FILE_BYTES} bytes: ${relativePath}`,
      );
    }
    const content = yield* Effect.try({
      try: () => new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      catch: () =>
        scannerError(workspaceRoot, "decode", `Project context file is not UTF-8: ${relativePath}`),
    });

    return {
      file: {
        relativePath,
        classification: classifyProjectContextContent(content),
        normalizedContent: normalizeProjectContextContent(content),
      },
      ownership: {
        relativePath,
        state: {
          presence: "present",
          digest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
          size: bytes.byteLength,
          content,
        },
      },
    };
  });

  const scan: ProjectContextScannerShape["scan"] = Effect.fn("ProjectContextScanner.scan")(
    function* (
      requestedWorkspaceRoot,
    ): Effect.fn.Return<ReturnType<typeof makeProjectContextSnapshot>, ProjectContextScannerError> {
      const workspaceRoot = yield* workspacePaths
        .normalizeWorkspaceRoot(requestedWorkspaceRoot)
        .pipe(
          Effect.mapError((error) =>
            scannerError(requestedWorkspaceRoot, "workspaceRoot", error.message),
          ),
        );
      const realWorkspaceRoot = yield* fileSystem
        .realPath(workspaceRoot)
        .pipe(
          Effect.mapError(() =>
            scannerError(workspaceRoot, "realPath", "Cannot resolve workspace root"),
          ),
        );
      if (containsRuntimeDirectory(realWorkspaceRoot)) {
        return yield* scannerError(
          workspaceRoot,
          "workspaceRoot",
          "Project context scanner refuses .gedcode runtime directories",
        );
      }

      const files: ProjectContextFile[] = [];
      const ownershipFiles: ProjectContextOwnershipFile[] = [];
      for (const relativePath of CANONICAL_PROJECT_CONTEXT_PATHS) {
        const result = yield* readRegularUtf8File(workspaceRoot, realWorkspaceRoot, relativePath);
        files.push(
          result?.file ?? {
            relativePath,
            classification: "missing",
            normalizedContent: "",
          },
        );
        ownershipFiles.push(
          result?.ownership ?? {
            relativePath,
            state: { presence: "absent", digest: null, size: 0, content: null },
          },
        );
      }

      const manifest = yield* readRegularUtf8File(
        workspaceRoot,
        realWorkspaceRoot,
        GED_MANIFEST_PATH,
      );
      ownershipFiles.push(
        manifest?.ownership ?? {
          relativePath: GED_MANIFEST_PATH,
          state: { presence: "absent", digest: null, size: 0, content: null },
        },
      );

      const adrDirectoryPath = yield* resolveInsideRoot(
        workspaceRoot,
        realWorkspaceRoot,
        ADR_DIRECTORY,
      );
      if (
        yield* fileSystem
          .exists(adrDirectoryPath)
          .pipe(
            Effect.mapError(() =>
              scannerError(workspaceRoot, "exists", `Cannot inspect ${ADR_DIRECTORY}`),
            ),
          )
      ) {
        const directoryInfo = yield* fileSystem
          .stat(adrDirectoryPath)
          .pipe(
            Effect.mapError(() =>
              scannerError(workspaceRoot, "stat", `Cannot inspect ${ADR_DIRECTORY}`),
            ),
          );
        if (directoryInfo.type !== "Directory") {
          return yield* scannerError(
            workspaceRoot,
            "stat",
            `ADR path is not a directory: ${ADR_DIRECTORY}`,
          );
        }
        const realAdrDirectoryPath = yield* fileSystem
          .realPath(adrDirectoryPath)
          .pipe(
            Effect.mapError(() =>
              scannerError(workspaceRoot, "realPath", `Cannot resolve ${ADR_DIRECTORY}`),
            ),
          );
        if (!isInside(realWorkspaceRoot, realAdrDirectoryPath)) {
          return yield* scannerError(
            workspaceRoot,
            "realPath",
            `ADR path escapes workspace root: ${ADR_DIRECTORY}`,
          );
        }

        const entries = yield* fileSystem
          .readDirectory(adrDirectoryPath)
          .pipe(
            Effect.mapError(() =>
              scannerError(workspaceRoot, "readDirectory", `Cannot list ${ADR_DIRECTORY}`),
            ),
          );
        for (const entry of entries.filter(isMarkdownFileName).toSorted()) {
          const result = yield* readRegularUtf8File(
            workspaceRoot,
            realWorkspaceRoot,
            `${ADR_DIRECTORY}/${entry}`,
          );
          if (result !== null) {
            files.push(result.file);
            ownershipFiles.push(result.ownership);
          }
        }
      }

      return makeProjectContextSnapshot({
        files,
        ownershipBaseline: { files: ownershipFiles },
      });
    },
  );

  return { scan } satisfies ProjectContextScannerShape;
});

export const ProjectContextScannerLive = Layer.effect(
  ProjectContextScanner,
  makeProjectContextScanner,
);
