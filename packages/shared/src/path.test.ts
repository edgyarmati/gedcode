import { describe, expect, it } from "vitest";
import {
  isExplicitRelativePath,
  isPathInsideDotDirectory,
  isUncPath,
  isWindowsAbsolutePath,
  isWindowsDrivePath,
} from "./path.ts";

describe("path helpers", () => {
  it("detects windows drive paths", () => {
    expect(isWindowsDrivePath("C:\\repo")).toBe(true);
    expect(isWindowsDrivePath("D:/repo")).toBe(true);
    expect(isWindowsDrivePath("/repo")).toBe(false);
  });

  it("detects UNC paths", () => {
    expect(isUncPath("\\\\server\\share\\repo")).toBe(true);
    expect(isUncPath("C:\\repo")).toBe(false);
  });

  it("detects windows absolute paths", () => {
    expect(isWindowsAbsolutePath("C:\\repo")).toBe(true);
    expect(isWindowsAbsolutePath("\\\\server\\share\\repo")).toBe(true);
    expect(isWindowsAbsolutePath("./repo")).toBe(false);
  });

  it("detects explicit relative paths", () => {
    expect(isExplicitRelativePath(".")).toBe(true);
    expect(isExplicitRelativePath("..")).toBe(true);
    expect(isExplicitRelativePath("./repo")).toBe(true);
    expect(isExplicitRelativePath("..\\repo")).toBe(true);
    expect(isExplicitRelativePath("~/repo")).toBe(false);
  });

  it("detects paths inside dot directories", () => {
    expect(isPathInsideDotDirectory(".ged/runtime/root/checkpoints.json")).toBe(true);
    expect(isPathInsideDotDirectory(".git/index")).toBe(true);
    expect(isPathInsideDotDirectory("src/.cache/state.json")).toBe(true);
    expect(isPathInsideDotDirectory("C:\\repo\\.ged\\runtime\\root\\checkpoints.json")).toBe(true);
    expect(isPathInsideDotDirectory("./.ged/file")).toBe(true);
    expect(isPathInsideDotDirectory("../.ged/file")).toBe(true);
    expect(isPathInsideDotDirectory(".ged/")).toBe(true);

    expect(isPathInsideDotDirectory("src/app.ts")).toBe(false);
    expect(isPathInsideDotDirectory(".env")).toBe(false);
    expect(isPathInsideDotDirectory(".gitignore")).toBe(false);
    expect(isPathInsideDotDirectory("src/.env")).toBe(false);
  });
});
