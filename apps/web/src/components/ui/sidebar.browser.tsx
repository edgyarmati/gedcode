import "../../index.css";

import { afterEach, beforeEach, expect, it } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";

import { cn } from "../../lib/utils";
import {
  readPersistedSidebarOpen,
  sidebarTitlebarLeftInsetClass,
  Sidebar,
  SidebarProvider,
  SidebarTrigger,
} from "./sidebar";

function SidebarHarness({ defaultOpen = true }: { defaultOpen?: boolean }) {
  return (
    <SidebarProvider defaultOpen={defaultOpen}>
      <Sidebar collapsible="offcanvas">
        <div>Projects</div>
      </Sidebar>
      <main>
        <SidebarTrigger />
      </main>
    </SidebarProvider>
  );
}

beforeEach(async () => {
  document.cookie = "sidebar_state=; Max-Age=0; Path=/";
  await page.viewport(1280, 800);
});

afterEach(async () => {
  document.cookie = "sidebar_state=; Max-Age=0; Path=/";
  await page.viewport(1280, 800);
});

it("keeps the compact viewport trigger scoped to the mobile sheet", async () => {
  await page.viewport(390, 800);
  const screen = await render(<SidebarHarness />);
  const trigger = page.getByRole("button", { name: "Toggle Sidebar" });

  await expect.element(trigger).toHaveAttribute("aria-expanded", "false");
  await trigger.click();
  await expect.element(page.getByText("Projects")).toBeVisible();
  expect(document.cookie).not.toContain("sidebar_state=");

  await screen.unmount();
});

it("collapses and reopens the desktop sidebar from the persistent content control", async () => {
  const screen = await render(<SidebarHarness />);
  const trigger = page.getByRole("button", { name: "Toggle Sidebar" });

  await expect.element(trigger).toHaveAttribute("aria-expanded", "true");
  await trigger.click();
  await expect.element(trigger).toHaveAttribute("aria-expanded", "false");
  await trigger.click();
  await expect.element(trigger).toHaveAttribute("aria-expanded", "true");

  await screen.unmount();
});

it("restores the collapsed choice after remount", async () => {
  const first = await render(<SidebarHarness />);
  const firstTrigger = page.getByRole("button", { name: "Toggle Sidebar" });
  await firstTrigger.click();
  await expect.element(firstTrigger).toHaveAttribute("aria-expanded", "false");
  await expect.poll(() => readPersistedSidebarOpen()).toBe(false);
  await first.unmount();

  const second = await render(<SidebarHarness defaultOpen={readPersistedSidebarOpen()} />);
  await expect
    .element(page.getByRole("button", { name: "Toggle Sidebar" }))
    .toHaveAttribute("aria-expanded", "false");
  await second.unmount();
});

it("keeps the macOS titlebar inset ahead of responsive header padding", async () => {
  const screen = await render(
    <div
      className={cn(
        "px-3 sm:px-5",
        sidebarTitlebarLeftInsetClass({ isElectron: true, sidebarOpen: false }),
      )}
      data-testid="electron-titlebar"
    />,
  );

  expect(getComputedStyle(page.getByTestId("electron-titlebar").element()).paddingLeft).toBe(
    "90px",
  );
  await screen.unmount();
});
