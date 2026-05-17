# Spec

## Goal

Replace the legacy T3/blueprint branding assets with a GedCode `GC` monogram that feels like a single nested glyph: the `C` sits inside the `G` opening and shares the same curved geometry.

## Visual Direction

- Use a Gruvbox dark base: `#282828`.
- Use Gruvbox orange `#d65d0e` as the primary production accent.
- Use Gruvbox aqua `#689d6a` as the secondary/nightly accent.
- Keep icon geometry high-contrast and legible down to 16px favicons.
- Prefer generated raster assets plus a checked-in SVG source for maintainability.

## Scope

- Update source brand assets under `assets/prod`, `assets/nightly`, and `assets/dev`.
- Update app runtime/public copies in `apps/web/public`, `apps/marketing/public`, and `apps/desktop/resources`.
- Add the monogram to the marketing nav/footer where the current brand is text-only or uses the old icon.
- Preserve existing build path contracts in `scripts/lib/brand-assets.ts` unless a stronger reason appears.
- Do not touch unrelated existing edits in `apps/server/src/server.ts` or untracked server workflow files.

## Non-Goals

- Rename packages, env vars, bundle IDs, or user data directories.
- Redesign screenshots, provider icons, social avatars, or harness/platform icons.
- Add new runtime dependencies.
