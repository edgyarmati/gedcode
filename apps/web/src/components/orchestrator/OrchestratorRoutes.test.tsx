import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { TaskPrLink } from "./TaskPrLink";

describe("TaskPrLink", () => {
  it("renders a clickable PR link when a task has a PR URL", () => {
    const markup = renderToStaticMarkup(
      <TaskPrLink prUrl="https://github.com/acme/project/pull/42" />,
    );

    expect(markup).toContain("View PR");
    expect(markup).toContain('href="https://github.com/acme/project/pull/42"');
    expect(markup).toContain('target="_blank"');
  });
});
