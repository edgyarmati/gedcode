import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { digestPairingCredential } from "../../auth/pairingCredentialDigest.ts";

interface PlaintextPairingLinkRow {
  readonly id: string;
  readonly credential: string;
  readonly method: string;
  readonly role: string;
  readonly subject: string;
  readonly label: string | null;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly consumedAt: string | null;
  readonly revokedAt: string | null;
}

/** Replace recoverable pairing credentials with deterministic SHA-256 lookup digests. */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const rows = yield* sql<PlaintextPairingLinkRow>`
    SELECT
      id,
      credential,
      method,
      role,
      subject,
      label,
      created_at AS "createdAt",
      expires_at AS "expiresAt",
      consumed_at AS "consumedAt",
      revoked_at AS "revokedAt"
    FROM auth_pairing_links
  `;

  yield* sql`PRAGMA secure_delete = ON`;
  yield* sql`
    CREATE TABLE auth_pairing_links_hashed (
      id TEXT PRIMARY KEY,
      credential_digest TEXT NOT NULL UNIQUE,
      method TEXT NOT NULL,
      role TEXT NOT NULL,
      subject TEXT NOT NULL,
      label TEXT,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      consumed_at TEXT,
      revoked_at TEXT
    )
  `;

  for (const row of rows) {
    yield* sql`
      INSERT INTO auth_pairing_links_hashed (
        id,
        credential_digest,
        method,
        role,
        subject,
        label,
        created_at,
        expires_at,
        consumed_at,
        revoked_at
      ) VALUES (
        ${row.id},
        ${digestPairingCredential(row.credential)},
        ${row.method},
        ${row.role},
        ${row.subject},
        ${row.label},
        ${row.createdAt},
        ${row.expiresAt},
        ${row.consumedAt},
        ${row.revokedAt}
      )
    `;
  }

  yield* sql`DROP TABLE auth_pairing_links`;
  yield* sql`ALTER TABLE auth_pairing_links_hashed RENAME TO auth_pairing_links`;
  yield* sql`
    CREATE INDEX idx_auth_pairing_links_active
    ON auth_pairing_links(revoked_at, consumed_at, expires_at)
  `;
});
