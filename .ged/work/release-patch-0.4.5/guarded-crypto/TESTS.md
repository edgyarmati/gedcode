# Verification plan

GC-01: real Oxlint integration fixtures, valid inventories, path/module/operation/placement mutations,
namespace escapes, computed/escaped/require/dynamic/type/reexport forms, broader diagnostics and
suppression changes. Compiler probes must see Effect and verify formatted multiline placement.
GC-02: existing store tests plus deterministic mock fs deferred write/reread paths: lengths 0, 1,
31, 33, 64; exact requested lengths including non-32; missing reread; permissions/read/open/write/
sync/chmod/RNG errors. Valid existing reads must avoid RNG/create; failed rereads never overwrite.
GC-03: RFC HMAC, byte offset/Unicode and signature decoding comparisons; fixed SHA/durable command
and SSH NUL-separated vectors. Actual workspace tsc versions and packaged native binary identity.
GC-04: all requested local release gates, logs with exact commands/versions/exits, three cold full
checks deleting only generated tsbuildinfo; clean isolated snapshot install/repeat-install, no
credentials. CI prepared but NOT dispatched. Baseline byte checks except explicitly extended
project/changelog/toolchain tests; previous pending runtime/application/dependency edits preserved.

Outcomes: see `.ged/runtime/release-patch-0.4.5/guarded-crypto/commands.jsonl`, STATE.md and
SESSION-SUMMARY.md. Failures must stay visible; no passing baseline suite is migration-equivalence
proof and no local result establishes remote platform success.

## Final local outcomes after timeout recovery

GC-04 verified locally: fmt/fmt:check/lint/full typecheck/full Vitest (462 files, 4239 passed,
one existing skipped)/versions/smoke/audit/Chromium install+browser (23 files, 240 tests)/forced
three-task desktop build pass. Existing three cold full checks retained, not restressed. Both
original and recovery clean/repeat installations pass. Recovery uses a private empty Bun cache,
hashed 1663-file source snapshot, 14 actual compiler fixtures twice, 55 guard fixtures and full
11-task typecheck; snapshot/cache removed and cwd compiler/install metadata byte-preserved.
Recovery made zero implementation/test/dependency edits. See runtime recovery/ for exact commands,
logs, source hashes and final validator; ../TESTS.md and runtime SESSION-SUMMARY.md for full totals,
residual audit/warning/crash-availability risks and required security/aggregate review.
