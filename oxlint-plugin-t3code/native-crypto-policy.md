# Reviewed native crypto exceptions (0.4.5)

Run `bun lint` from the repository root. `t3code/native-crypto-boundary` is an **error**, using
Oxlint's ESTree parser, comments, and lexical references. Its exact inventory is
`native-crypto-policy.json`. Changes to this policy require explicit security/aggregate review.
Do not auto-regenerate the inventory to make lint pass.

- 16 new next-line directives: **13 production / three tests**. Native HMAC, constant-time
  comparison, secure randomness, and persistent synchronous hashes retain their current APIs,
  algorithms, encodings and byte preparation. Installed Effect beta.73 cannot replace HMAC or
  timing-safe equality; a release-time crypto refactor is not authorized.
- **23 total crypto imports**: the 16 plus seven previously exempt imports. Those seven are
  attachmentStore, the two MCP helpers, releaseMigrationFixtures.test (server),
  releasePersistenceFixtures.test (web), generate-sparkle-feed and
  generate-release-compatibility-fixtures (scripts). They gain no new diagnostic exemptions.
- **68 pre-existing directives** are explicitly frozen: 67 file-wide directives and the one
  mock-update-server HTTP next-line directive. Their original text/line and static native imports
  are inventoried for both bare builtin and `node:` spellings; no existing broader exception is silently widened or converted in this patch.
  Non-crypto native operation bodies under these historical directives are not redesigned here.

New exceptions must be the exact line comment immediately before the import's **module-specifier
line**. For multiline imports, that means before `} from "node:crypto";`, not before `import {`.
No other import may share that diagnostic-bearing line. The real-compiler suite formats its
multiline fixture with the actual formatter, then proves the exception and neighboring errors.

Crypto imports match exact root-relative path, canonical module spelling and bindings, direct
operation references, and directive placement. Namespace/property computation, binding escape,
re-exports, type/side-effect/dynamic/require crypto imports and known alternate loaders fail.
Dynamic imports and native loaders must specify literal non-crypto modules; createRequire is
tracked through lexical bindings and may not escape. Process loader properties (getBuiltinModule,
binding, \_linkedBinding) remain forbidden, including named imports, default/namespace process
imports, globalThis.process and initializer aliases. Process/module checks distinguish lexical
shadows from native globals and imports; ordinary non-loader process APIs are not newly banned.
This prevents simple syntactic disguises,
not arbitrary hostile JavaScript, self-modifying code, or malicious edits to the lint policy itself.
Repository configuration and the enforcement rule are also frozen by compiler policy tests.

Existing broad directives remain technical debt, not a claim that every native API now has an
Effect counterpart. A future platform abstraction or capability-aware upstream rule is separate
reviewed work. Do not replace native timingSafeEqual with JS equality or WebCrypto verify merely
to satisfy architectural guidance. Do not infer cross-platform compiler reliability from local runs.
