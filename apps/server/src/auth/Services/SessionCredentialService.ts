import type {
  AuthClientMetadata,
  AuthClientSession,
  AuthSessionId,
  ServerAuthSessionMethod,
} from "@t3tools/contracts";
import * as Data from "effect/Data";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as PubSub from "effect/PubSub";
import type * as Scope from "effect/Scope";
import type * as Stream from "effect/Stream";

export type SessionRole = "owner" | "client";

export interface IssuedSession {
  readonly sessionId: AuthSessionId;
  readonly token: string;
  readonly method: ServerAuthSessionMethod;
  readonly client: AuthClientMetadata;
  readonly expiresAt: DateTime.DateTime;
  readonly role: SessionRole;
}

export interface VerifiedSession {
  readonly sessionId: AuthSessionId;
  readonly token: string;
  readonly method: ServerAuthSessionMethod;
  readonly client: AuthClientMetadata;
  readonly expiresAt?: DateTime.DateTime;
  readonly subject: string;
  readonly role: SessionRole;
}

export type SessionCredentialChange =
  | {
      readonly type: "clientUpserted";
      readonly clientSession: AuthClientSession;
    }
  | {
      readonly type: "clientRemoved";
      readonly sessionId: AuthSessionId;
    };

export class SessionCredentialError extends Data.TaggedError("SessionCredentialError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export interface SessionCredentialServiceShape {
  readonly cookieName: string;
  readonly issue: (input?: {
    readonly ttl?: Duration.Duration;
    readonly subject?: string;
    readonly method?: ServerAuthSessionMethod;
    readonly role?: SessionRole;
    readonly client?: AuthClientMetadata;
  }) => Effect.Effect<IssuedSession, SessionCredentialError>;
  readonly verify: (token: string) => Effect.Effect<VerifiedSession, SessionCredentialError>;
  readonly issueWebSocketToken: (
    sessionId: AuthSessionId,
    input?: {
      readonly ttl?: Duration.Duration;
    },
  ) => Effect.Effect<
    {
      readonly token: string;
      readonly expiresAt: DateTime.DateTime;
    },
    SessionCredentialError
  >;
  readonly verifyWebSocketToken: (
    token: string,
  ) => Effect.Effect<VerifiedSession, SessionCredentialError>;
  readonly listActive: () => Effect.Effect<
    ReadonlyArray<AuthClientSession>,
    SessionCredentialError
  >;
  readonly streamChanges: Stream.Stream<SessionCredentialChange>;
  /**
   * Acquire the bounded change subscription before loading an auth-access snapshot.
   * Publishers backpressure when the subscriber falls 256 changes behind.
   */
  readonly subscribeChanges: Effect.Effect<
    PubSub.Subscription<SessionCredentialChange>,
    never,
    Scope.Scope
  >;
  readonly revoke: (sessionId: AuthSessionId) => Effect.Effect<boolean, SessionCredentialError>;
  readonly revokeAllExcept: (
    sessionId: AuthSessionId,
  ) => Effect.Effect<number, SessionCredentialError>;
  /**
   * Completes when the persisted session is revoked, missing, or expired.
   * Consumers use this to bind long-lived resources to session validity.
   */
  readonly awaitInvalidation: (sessionId: AuthSessionId) => Effect.Effect<void, never>;
  readonly markConnected: (sessionId: AuthSessionId) => Effect.Effect<void, never>;
  readonly markDisconnected: (sessionId: AuthSessionId) => Effect.Effect<void, never>;
}

export class SessionCredentialService extends Context.Service<
  SessionCredentialService,
  SessionCredentialServiceShape
>()("gedcode/auth/Services/SessionCredentialService") {}
