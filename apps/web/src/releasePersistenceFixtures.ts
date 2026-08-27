/**
 * Browser-persisted state versions shipped by every published GedCode release.
 *
 * This inventory was reconciled against GitHub Releases and the tagged trees
 * on 2026-08-27. A null version means that store did not exist in the release.
 */
export const PUBLISHED_RELEASE_BROWSER_PERSISTENCE_FIXTURES = [
  { tag: "v0.1.0", composer: 6, terminal: 2, helperDismissal: null },
  {
    tag: "v0.1.1-nightly.20260610.1",
    composer: 6,
    terminal: 2,
    helperDismissal: null,
  },
  { tag: "v0.1.1", composer: 6, terminal: 2, helperDismissal: null },
  { tag: "v0.1.2", composer: 6, terminal: 2, helperDismissal: null },
  {
    tag: "v0.1.3-nightly.20260614.1",
    composer: 6,
    terminal: 2,
    helperDismissal: null,
  },
  { tag: "v0.1.3", composer: 6, terminal: 2, helperDismissal: null },
  { tag: "v0.2.0", composer: 6, terminal: 2, helperDismissal: null },
  { tag: "v0.2.1", composer: 6, terminal: 2, helperDismissal: null },
  {
    tag: "v0.2.2-nightly.20260712.1",
    composer: 6,
    terminal: 2,
    helperDismissal: null,
  },
  {
    tag: "v0.3.0-nightly.20260716.1",
    composer: 7,
    terminal: 2,
    helperDismissal: null,
  },
  { tag: "v0.3.0", composer: 7, terminal: 2, helperDismissal: null },
  { tag: "v0.4.0", composer: 7, terminal: 2, helperDismissal: 1 },
  { tag: "v0.4.1", composer: 7, terminal: 2, helperDismissal: 1 },
  { tag: "v0.4.2", composer: 7, terminal: 2, helperDismissal: 1 },
  { tag: "v0.4.3", composer: 7, terminal: 2, helperDismissal: 1 },
] as const;
