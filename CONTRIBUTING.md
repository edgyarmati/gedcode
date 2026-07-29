# Contributing to GedCode

Thanks for taking an interest in GedCode. The project is early, opinionated, and changing quickly,
but focused contributions are welcome. Before starting substantial work, please open an issue or
discussion so we can agree on the problem and the shape of a solution.

## What to work on

The most useful contributions are:

- focused bug fixes and reliability improvements;
- performance improvements backed by a reproducible case;
- provider integrations and recovery behavior that preserve predictable session state;
- documentation improvements and focused tests;
- small, well-scoped UX improvements that fit the existing Orchestrator workflow.

Please avoid drive-by rewrites, broad dependency upgrades, or large features without prior
discussion. GedCode is a fork with a deliberately different product direction, so upstream
changes are useful references but are not automatically a good fit here.

## Development setup

GedCode uses Bun and Node.js. The supported versions are recorded in the root `package.json` and can
also be installed with mise:

```sh
mise install
bun install
```

At least one supported coding-agent provider must be installed and authenticated to exercise the
full application. See the provider guides in [`docs/providers/`](docs/providers/).

## Development workflow

1. Create a focused branch from `main`.
2. Read the relevant architecture and provider documentation before changing behavior.
3. Make the smallest coherent change, keeping shared logic in `packages/` when it is used by both
   the server and web app.
4. Add or update focused tests for behavior that changed.
5. Update `CHANGELOG.md` under `## Unreleased` when the change affects users, operators, or release
   notes.
6. Run the required checks before opening a pull request:

   ```sh
   bun fmt
   bun lint
   bun typecheck
   bun run test --filter <relevant-package>
   ```

   Use the narrowest relevant package typecheck and focused test command for the area you changed.
   The repository uses Vitest through `bun run test`; do not use `bun test`.

## Pull requests

Keep each pull request focused and explain:

- what problem it solves;
- why the chosen approach fits GedCode;
- how the change was tested;
- any compatibility, migration, or provider-version considerations.

For UI changes, include before-and-after screenshots. For changes involving timing, animation, or
interaction, include a short recording when it makes the behavior easier to review. Call out known
limitations and follow-up work instead of hiding them in unrelated refactors.

Maintainers may ask for a pull request to be split, narrowed, or redesigned. Opening a pull request
does not guarantee acceptance, but clear context and a small diff make review substantially easier.

## Reporting issues

Please include the GedCode version, operating system, provider and provider version, reproduction
steps, relevant logs, and whether the issue survives a restart. Remove API keys, pairing tokens, and
other secrets before sharing logs or screenshots.

Security issues should not be reported publicly. Contact the maintainer privately through the
contact method listed on the repository profile.

## License and provenance

GedCode is distributed under the MIT License. It began as a fork of [T3 Code](https://github.com/pingdotgg/t3code),
and the repository retains the required upstream attribution. See [`LICENSE`](LICENSE) and
[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) for the project and third-party notices.
