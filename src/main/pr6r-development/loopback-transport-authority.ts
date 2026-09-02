import {
  CloudApplicationRequestV1Schema,
  canonicalPr6rCloudApplicationRequestSha256,
  canonicalPr6rJsonV1,
  type CloudApplicationRequestV1,
} from "../../shared/pr6r-development-contracts";
import {
  readPr6rFixtureListenerBinding,
  type Pr6rFixtureListenerCapability,
  type Pr6rLoopbackHost,
} from "./fixture-server";
import {
  consumePr6rCloudSlotDispatchArm,
  readPr6rConsumedOsDispatchAuthorityBinding,
  type Pr6rCloudSlotDispatchArm,
  type Pr6rConsumedOsDispatchAuthority,
} from "./authority-ledger";
import {
  assertPr6rDevelopmentRuntimeAuthority,
  type Pr6rDevelopmentRuntimeAuthority,
} from "./runtime-authority";
import {
  consumePr6rSqliteDispatchAuthority,
  type Pr6rSqliteDispatchChain,
  type Pr6rSqliteDispatchAuthority,
} from "./sqlite-attempt-authority";

export interface Pr6rLoopbackDispatchGrant {
  readonly status: "ready";
  readonly requestId: string;
  readonly slotId: "cloud_synthesis" | "hybrid_cloud_if_selected";
  readonly applicationRequestSha256: string;
  readonly reservationId: string;
}

export interface Pr6rConsumedLoopbackDispatch {
  readonly applicationRequest: CloudApplicationRequestV1;
  readonly reservationId: string;
  readonly host: Pr6rLoopbackHost;
  readonly port: number;
  readonly sqliteDispatchChain: Pr6rSqliteDispatchChain;
}

interface DispatchGrantPrivateState {
  readonly applicationRequest: CloudApplicationRequestV1;
  readonly listenerCapability: Pr6rFixtureListenerCapability;
  readonly host: Pr6rLoopbackHost;
  readonly port: number;
  readonly osDispatchAuthority: Pr6rConsumedOsDispatchAuthority;
  readonly sqliteDispatchChain: Pr6rSqliteDispatchChain;
  consumed: boolean;
}

const grantPrivateState = new WeakMap<
  Pr6rLoopbackDispatchGrant,
  DispatchGrantPrivateState
>();

export class Pr6rLoopbackTransportAuthorityError extends Error {
  constructor(
    readonly code:
      | "loopback_authority_invalid"
      | "loopback_authority_mismatch"
      | "loopback_authority_consumed",
  ) {
    super(code);
    this.name = "Pr6rLoopbackTransportAuthorityError";
  }
}

function authorityError(
  code: Pr6rLoopbackTransportAuthorityError["code"],
): Pr6rLoopbackTransportAuthorityError {
  return new Pr6rLoopbackTransportAuthorityError(code);
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  for (const nested of Object.values(value as Record<string, unknown>)) {
    deepFreeze(nested);
  }
  return Object.isFrozen(value) ? value : Object.freeze(value);
}

function parseRequest(value: unknown): CloudApplicationRequestV1 {
  const result = CloudApplicationRequestV1Schema.safeParse(value);
  if (!result.success) throw authorityError("loopback_authority_invalid");
  return deepFreeze(result.data);
}

function exactRequestMatches(
  left: CloudApplicationRequestV1,
  right: CloudApplicationRequestV1,
): boolean {
  return canonicalPr6rJsonV1(left) === canonicalPr6rJsonV1(right);
}

function exactBindingMatches(
  binding: {
    readonly slotId: string;
    readonly requestId: string;
    readonly origin: string;
    readonly applicationRequestSha256: string;
    readonly canonicalBodySha256: string;
    readonly commonCheckpointSha256: string;
    readonly synthesisSessionId: string;
    readonly attemptId: string;
    readonly reservationId: string;
  },
  request: CloudApplicationRequestV1,
  reservationId: string,
): boolean {
  return (
    binding.slotId === request.slotId &&
    binding.requestId === request.requestId &&
    binding.origin === request.origin &&
    binding.applicationRequestSha256 ===
      canonicalPr6rCloudApplicationRequestSha256(request) &&
    binding.canonicalBodySha256 === request.canonicalBodySha256 &&
    binding.commonCheckpointSha256 === request.commonCheckpointSha256 &&
    binding.synthesisSessionId === request.synthesisSessionId &&
    binding.attemptId === request.attemptId &&
    binding.reservationId === reservationId
  );
}

/**
 * Mint one transport grant only after live OS and genuine committed-SQLite
 * authority agree on every sealed request, attempt, and reservation binding.
 */
export function mintPr6rLoopbackDispatchGrant(input: {
  readonly runtimeAuthority: Pr6rDevelopmentRuntimeAuthority;
  readonly listenerCapability: Pr6rFixtureListenerCapability;
  readonly osDispatchArm: Pr6rCloudSlotDispatchArm;
  readonly sqliteDispatchAuthority: Pr6rSqliteDispatchAuthority;
  readonly applicationRequest: unknown;
  readonly reservationId: string;
}): Pr6rLoopbackDispatchGrant {
  try {
    assertPr6rDevelopmentRuntimeAuthority(input.runtimeAuthority);
  } catch {
    throw authorityError("loopback_authority_invalid");
  }
  const request = parseRequest(input.applicationRequest);
  let listener: ReturnType<typeof readPr6rFixtureListenerBinding>;
  try {
    listener = readPr6rFixtureListenerBinding(input.listenerCapability);
  } catch {
    throw authorityError("loopback_authority_invalid");
  }
  if (listener.origin !== request.origin) {
    throw authorityError("loopback_authority_mismatch");
  }
  let osDispatchAuthority: Pr6rConsumedOsDispatchAuthority;
  let osBinding: ReturnType<
    typeof readPr6rConsumedOsDispatchAuthorityBinding
  >;
  try {
    osDispatchAuthority = consumePr6rCloudSlotDispatchArm(input.osDispatchArm);
    osBinding = readPr6rConsumedOsDispatchAuthorityBinding(osDispatchAuthority);
  } catch {
    throw authorityError("loopback_authority_invalid");
  }
  if (!exactBindingMatches(osBinding, request, input.reservationId)) {
    throw authorityError("loopback_authority_mismatch");
  }

  let sqliteBinding: ReturnType<typeof consumePr6rSqliteDispatchAuthority>;
  try {
    sqliteBinding = consumePr6rSqliteDispatchAuthority(
      input.sqliteDispatchAuthority,
      {
        applicationRequest: request,
        reservationId: input.reservationId,
      },
    );
  } catch {
    throw authorityError("loopback_authority_invalid");
  }
  if (!exactBindingMatches(sqliteBinding, request, input.reservationId)) {
    throw authorityError("loopback_authority_mismatch");
  }
  const applicationRequestSha256 =
    canonicalPr6rCloudApplicationRequestSha256(request);
  const grant = Object.freeze({
    status: "ready" as const,
    requestId: request.requestId,
    slotId: request.slotId,
    applicationRequestSha256,
    reservationId: input.reservationId,
  });
  grantPrivateState.set(grant, {
    applicationRequest: request,
    listenerCapability: input.listenerCapability,
    host: listener.host,
    port: listener.port,
    osDispatchAuthority,
    sqliteDispatchChain: sqliteBinding.dispatchChain,
    consumed: false,
  });
  return grant;
}

/** Burn a genuine grant before any socket construction, even on mismatch. */
export function consumePr6rLoopbackDispatchGrant(
  grant: Pr6rLoopbackDispatchGrant,
  applicationRequest: unknown,
): Pr6rConsumedLoopbackDispatch {
  const state = grantPrivateState.get(grant);
  if (state === undefined) {
    throw authorityError("loopback_authority_invalid");
  }
  if (state.consumed) {
    throw authorityError("loopback_authority_consumed");
  }
  state.consumed = true;

  const request = parseRequest(applicationRequest);
  if (!exactRequestMatches(request, state.applicationRequest)) {
    throw authorityError("loopback_authority_mismatch");
  }
  let osBinding: ReturnType<
    typeof readPr6rConsumedOsDispatchAuthorityBinding
  >;
  try {
    osBinding = readPr6rConsumedOsDispatchAuthorityBinding(
      state.osDispatchAuthority,
    );
  } catch {
    throw authorityError("loopback_authority_consumed");
  }
  if (!exactBindingMatches(osBinding, request, grant.reservationId)) {
    throw authorityError("loopback_authority_mismatch");
  }
  let listener: ReturnType<typeof readPr6rFixtureListenerBinding>;
  try {
    listener = readPr6rFixtureListenerBinding(state.listenerCapability);
  } catch {
    throw authorityError("loopback_authority_invalid");
  }
  if (
    listener.origin !== state.applicationRequest.origin ||
    listener.host !== state.host ||
    listener.port !== state.port
  ) {
    throw authorityError("loopback_authority_mismatch");
  }
  return Object.freeze({
    applicationRequest: state.applicationRequest,
    reservationId: grant.reservationId,
    host: state.host,
    port: state.port,
    sqliteDispatchChain: state.sqliteDispatchChain,
  });
}
