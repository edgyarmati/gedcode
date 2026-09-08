import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

import type { AuthPairingLinkRepositoryError } from "../Errors.ts";

export const AuthPairingLinkRecord = Schema.Struct({
  id: Schema.String,
  method: Schema.Literals(["desktop-bootstrap", "one-time-token"]),
  role: Schema.Literals(["owner", "client"]),
  subject: Schema.String,
  label: Schema.NullOr(Schema.String),
  createdAt: Schema.DateTimeUtcFromString,
  expiresAt: Schema.DateTimeUtcFromString,
  consumedAt: Schema.NullOr(Schema.DateTimeUtcFromString),
  revokedAt: Schema.NullOr(Schema.DateTimeUtcFromString),
});
export type AuthPairingLinkRecord = typeof AuthPairingLinkRecord.Type;

export const CreateAuthPairingLinkInput = Schema.Struct({
  id: Schema.String,
  credentialDigest: Schema.String,
  method: Schema.Literals(["desktop-bootstrap", "one-time-token"]),
  role: Schema.Literals(["owner", "client"]),
  subject: Schema.String,
  label: Schema.NullOr(Schema.String),
  createdAt: Schema.DateTimeUtcFromString,
  expiresAt: Schema.DateTimeUtcFromString,
});
export type CreateAuthPairingLinkInput = typeof CreateAuthPairingLinkInput.Type;

export const ConsumeAuthPairingLinkInput = Schema.Struct({
  credentialDigest: Schema.String,
  consumedAt: Schema.DateTimeUtcFromString,
  now: Schema.DateTimeUtcFromString,
});
export type ConsumeAuthPairingLinkInput = typeof ConsumeAuthPairingLinkInput.Type;

export const ListActiveAuthPairingLinksInput = Schema.Struct({
  now: Schema.DateTimeUtcFromString,
});
export type ListActiveAuthPairingLinksInput = typeof ListActiveAuthPairingLinksInput.Type;

export const RevokeAuthPairingLinkInput = Schema.Struct({
  id: Schema.String,
  revokedAt: Schema.DateTimeUtcFromString,
});
export type RevokeAuthPairingLinkInput = typeof RevokeAuthPairingLinkInput.Type;

export const GetAuthPairingLinkByCredentialDigestInput = Schema.Struct({
  credentialDigest: Schema.String,
});
export type GetAuthPairingLinkByCredentialDigestInput =
  typeof GetAuthPairingLinkByCredentialDigestInput.Type;

export interface AuthPairingLinkRepositoryShape {
  readonly create: (
    input: CreateAuthPairingLinkInput,
  ) => Effect.Effect<void, AuthPairingLinkRepositoryError>;
  readonly consumeAvailable: (
    input: ConsumeAuthPairingLinkInput,
  ) => Effect.Effect<Option.Option<AuthPairingLinkRecord>, AuthPairingLinkRepositoryError>;
  readonly listActive: (
    input: ListActiveAuthPairingLinksInput,
  ) => Effect.Effect<ReadonlyArray<AuthPairingLinkRecord>, AuthPairingLinkRepositoryError>;
  readonly revoke: (
    input: RevokeAuthPairingLinkInput,
  ) => Effect.Effect<boolean, AuthPairingLinkRepositoryError>;
  readonly getByCredentialDigest: (
    input: GetAuthPairingLinkByCredentialDigestInput,
  ) => Effect.Effect<Option.Option<AuthPairingLinkRecord>, AuthPairingLinkRepositoryError>;
}

export class AuthPairingLinkRepository extends Context.Service<
  AuthPairingLinkRepository,
  AuthPairingLinkRepositoryShape
>()("gedcode/persistence/Services/AuthPairingLinks/AuthPairingLinkRepository") {}
