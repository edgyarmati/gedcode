# TASKS

1. Version + stable branding cleanup
   - Bump `apps/web` and `packages/contracts` versions to `0.1.0`.
   - Change desktop stable `productName` to `GedCode`.
   - Remove current stable `Alpha` display from desktop environment, web title, and branding fallback.
   - Make sidebar stage badge conditional so stable can be unlabeled.
   - Update related tests.

2. Update UX exposure
   - Audit existing Settings/sidebar update UI.
   - Ensure desktop settings exposes update status, check/download/install action, and update channel selector.
   - Ensure sidebar/footer surfaces actionable update states without hiding them behind unrelated warnings.
   - Add/adjust focused tests.

3. Icon asset refresh
   - Create cleaner padded icon source/assets.
   - Generate and commit required prod/dev/nightly desktop and web icon assets.
   - Prefer a reproducible script if practical.
   - Verify asset dimensions and padding.

4. Cleanup/audit
   - Search for unintended `GedCode (Alpha)` / user-facing Alpha references.
   - Keep intentional legacy migration fallback strings only.

## Plan review safeguards

- Validate product-name change keeps `appId` and updater feed identity stable; do not change appId/update repository/channel semantics.
- Make stable stage label explicitly nullable/hidden through contracts, desktop IPC, and web branding rather than replacing Alpha with another visible stable badge.
- Include `bun.lock` version updates if package versions are changed.
- Icon acceptance is measurable: required PNG/favicon dimensions must match expected sizes, and the visible mark should be inset within a safe-zone rather than filling the whole canvas.
- Reuse existing update query/logic/components; do not add a divergent updater state path.
- Do not delegate implementation to workers unless a slice is isolated; main agent owns cross-file reconciliation.
