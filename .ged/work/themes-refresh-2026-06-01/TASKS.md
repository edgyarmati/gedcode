# TASKS: Theme Refresh

1. Theme model and migration
   - Add/centralize theme IDs, labels, validation, resolved color scheme, active concrete theme, and desktop mapping.
   - Implement v2 storage fallback/migration from legacy `t3code:theme`.

2. Theme application hook
   - Update `apps/web/src/hooks/useTheme.ts`.
   - Apply `data-theme` plus `.dark`.
   - Sync browser chrome after theme changes.
   - Map web-specific themes to unchanged desktop native theme values.

3. Settings UI
   - Update `apps/web/src/components/settings/SettingsPanels.tsx` to use the expanded theme options.
   - Keep reset/default behavior as `system`.

4. CSS palettes
   - Update `apps/web/src/index.css`.
   - Move current palettes to Gruvbox Light/Dark selectors.
   - Add clean Light, clean Dark, Midnight, and Dracula variables.

5. No-flash boot path
   - Update `apps/web/index.html` to mirror theme resolution/migration for first paint.

6. Terminal and diff adaptation
   - Confirm terminal colors react to `data-theme` changes.
   - Leave diff rendering scheme-based unless a code issue is found.

7. Review hardening
   - Implement explicit `t3code:theme:v2` precedence and invalid-value behavior.
   - Ensure `html[data-theme]` is always the active concrete palette, not `system`.
   - Ensure terminal theme recomputation observes `data-theme` changes, not only `.dark` changes.
   - Keep desktop IPC type boundaries narrow by mapping before bridge calls.
