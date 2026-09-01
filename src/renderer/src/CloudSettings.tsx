import {
  ArrowLeft,
  CheckCircle,
  Cloud,
  Key,
  LockKey,
  WarningCircle,
} from "@phosphor-icons/react";
import React from "react";
import { useEffect, useRef } from "react";

import type {
  CloudCredentialStatus,
  CredentialOperationKind,
} from "../../shared/cloud-setup-contracts";

export interface CloudSettingsProps {
  status: CloudCredentialStatus | null;
  lastSourceProvenLegacyStatus?: Extract<
    CloudCredentialStatus["legacyStagedItem"],
    { state: "present" | "not_observed" }
  > | null;
  loading: boolean;
  loadFailed: boolean;
  onRetry: () => void;
  onDone: () => void;
}

function buildCopy(status: CloudCredentialStatus): {
  headline: string;
  detail: string;
} {
  switch (status.build.state) {
    case "unsigned_or_adhoc":
      return {
        headline: "Signed setup is not available in this build",
        detail:
          "This build cannot activate protected credential setup. Local tasks remain available.",
      };
    case "eligible":
      return {
        headline: "Real credential setup is still locked",
        detail:
          "This build passed its identity policy, but real setup remains disabled until the later signed continuity and activation gates pass.",
      };
    case "ineligible":
      return {
        headline: "Signed setup is not available in this build",
        detail:
          "The signed host does not satisfy SOAR's credential identity policy. No protected action is available.",
      };
    case "eligibility_unknown":
      return {
        headline: "This build's credential identity could not be confirmed",
        detail:
          "SOAR could not establish native credential eligibility. No protected action is available.",
      };
  }
}

function legacyCopy(
  status: CloudCredentialStatus,
  lastSourceProvenLegacyStatus: CloudSettingsProps["lastSourceProvenLegacyStatus"],
): {
  headline: string;
  detail: string;
  tone: string;
} {
  switch (status.legacyStagedItem.state) {
    case "present":
      return {
        headline: "Older setup item present",
        detail:
          "SOAR found metadata for the older setup item. It was not read, changed, or removed.",
        tone: "state-unvalidated",
      };
    case "not_observed":
      return {
        headline: "No older setup item found",
        detail:
          "The metadata-only check did not observe the older setup item. This does not enable protected setup.",
        tone: "state-not_configured",
      };
    case "unknown":
      const retainedState =
        lastSourceProvenLegacyStatus?.state === "present"
          ? " The last completed metadata check observed the older setup item; this unavailable refresh did not replace that source-proven state."
          : lastSourceProvenLegacyStatus?.state === "not_observed"
            ? " The last completed metadata check did not observe the older setup item; this unavailable refresh did not replace that source-proven state."
            : "";
      return {
        headline:
          status.legacyStagedItem.reasonCode === "keychain_locked"
            ? "Unlock your Mac Keychain to continue"
            : status.legacyStagedItem.reasonCode === "keychain_access_denied"
              ? "Keychain access was denied"
              : "Local credential status unavailable",
        detail:
          status.legacyStagedItem.reasonCode === "keychain_locked"
            ? `The noninteractive metadata check could not continue while the Keychain was locked. SOAR did not show an authentication prompt or read a credential.${retainedState}`
            : `SOAR could not establish the older item's metadata without interaction. It did not prompt for or read a credential.${retainedState}`,
        tone: "state-local_storage_error",
      };
  }
}

function protectedCopy(status: CloudCredentialStatus): {
  headline: string;
  detail: string;
  tone: string;
} {
  switch (status.protectedItem.state) {
    case "present":
      return {
        headline: "Protected credential present",
        detail:
          "Protected-item metadata is present. This status does not validate the credential or unlock cloud requests.",
        tone: "state-stored_unvalidated",
      };
    case "not_observed":
      return {
        headline: "No protected credential found",
        detail:
          "The native metadata source did not observe a protected item. No credential value was requested.",
        tone: "state-not_configured",
      };
    case "unknown":
      return {
        headline: "Protected credential not inspected",
        detail:
          status.protectedItem.reasonCode === "activation_locked"
            ? "The production protected-item namespace is absent and locked in this phase."
            : "SOAR could not establish protected-item metadata without weakening its identity boundary.",
        tone: "state-locked",
      };
  }
}

const pendingOperationCopy: Readonly<Record<CredentialOperationKind, string>> = {
  store_protected: "Storing credential in Keychain…",
  replace_protected: "Replacing credential in Keychain…",
  remove_protected: "Removing protected credential…",
  remove_legacy_staged: "Removing older setup item…",
};

const unknownOperationCopy: Readonly<Record<CredentialOperationKind, string>> = {
  store_protected: "The previous credential storage has not been confirmed.",
  replace_protected:
    "The previous credential replacement has not been confirmed.",
  remove_protected:
    "The previous protected credential removal has not been confirmed.",
  remove_legacy_staged:
    "The previous older setup item removal has not been confirmed.",
};

function CredentialOperationStatus({
  operation,
}: {
  operation: CloudCredentialStatus["latestOperation"];
}) {
  if (operation.state === "none") return null;

  if (operation.state === "outcome_unknown") {
    return (
      <div className="cloud-operation-error" role="alert">
        <WarningCircle weight="fill" aria-hidden="true" />
        <span>
          <strong>{unknownOperationCopy[operation.kind]}</strong>
          {operation.recoveryCode === "await_native_completion"
            ? " SOAR is still reconciling the original operation; duplicate changes remain locked."
            : " Duplicate changes remain locked until the defined manual recovery is completed."}
        </span>
      </div>
    );
  }

  const message = nonErrorOperationCopy(operation);

  return <div className="cloud-operation-status">{message}</div>;
}

function nonErrorOperationCopy(
  operation: Exclude<
    CloudCredentialStatus["latestOperation"],
    { state: "none" } | { state: "outcome_unknown" }
  >,
): string {
  return operation.state === "pending"
    ? pendingOperationCopy[operation.kind]
    : operation.state === "confirmed"
      ? "The credential operation was confirmed."
      : "The earlier credential operation was superseded.";
}

export function CloudSettings({
  status,
  lastSourceProvenLegacyStatus = null,
  loading,
  loadFailed,
  onRetry,
  onDone,
}: CloudSettingsProps) {
  const titleRef = useRef<HTMLHeadingElement>(null);
  const statusRetryRef = useRef<HTMLButtonElement>(null);
  const restoreStatusFocusRef = useRef(false);

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!restoreStatusFocusRef.current || loading) return;
    restoreStatusFocusRef.current = false;
    if (loadFailed || status === null) {
      statusRetryRef.current?.focus();
      return;
    }
    titleRef.current?.focus();
  }, [loadFailed, loading, status]);

  const retryLocalStatus = (): void => {
    restoreStatusFocusRef.current = true;
    onRetry();
  };

  const build = status === null ? null : buildCopy(status);
  const legacy =
    status === null
      ? null
      : legacyCopy(status, lastSourceProvenLegacyStatus);
  const protectedItem = status === null ? null : protectedCopy(status);
  const operation = status?.latestOperation;
  const liveStatus = loading
    ? "Reading non-secret local credential status…"
    : loadFailed || status === null
      ? ""
      : operation === undefined || operation.state === "none"
        ? "Local credential status loaded. Cloud requests remain locked."
        : operation.state === "outcome_unknown"
          ? ""
          : nonErrorOperationCopy(operation);

  return (
    <section className="cloud-settings" aria-labelledby="cloud-settings-title">
      <div
        className="sr-only"
        data-testid="cloud-credential-live-status"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        aria-busy={loading || operation?.state === "pending"}
      >
        {liveStatus}
      </div>
      <header className="cloud-settings-heading">
        <button type="button" className="cloud-settings-back" onClick={onDone}>
          <ArrowLeft aria-hidden="true" />
          Done
        </button>
        <span className="review-kicker">Settings</span>
        <h1 ref={titleRef} id="cloud-settings-title" tabIndex={-1}>
          Cloud credential
        </h1>
        <p>
          Credential setup remains locked in this phase. This screen exposes
          non-secret local status only; it cannot enter, replace, remove,
          validate, or use a credential.
        </p>
      </header>

      {loading ? (
        <div className="cloud-settings-loading">
          Reading non-secret local credential status…
        </div>
      ) : loadFailed ||
        status === null ||
        build === null ||
        legacy === null ||
        protectedItem === null ? (
        <div className="cloud-settings-load-error" role="alert">
          <WarningCircle weight="fill" aria-hidden="true" />
          <span>
            <strong>Local credential status unavailable</strong>
            SOAR could not read the non-secret local status. No credential value
            or cloud-provider response was requested.
          </span>
          <button
            ref={statusRetryRef}
            type="button"
            className="review-text-button"
            onClick={retryLocalStatus}
          >
            Retry local status
          </button>
        </div>
      ) : (
        <div className="cloud-settings-body">
          <section
            className="cloud-candidate"
            aria-labelledby="cloud-build-title"
          >
            <div className="cloud-candidate-icon">
              <LockKey aria-hidden="true" />
            </div>
            <span>
              <small id="cloud-build-title">Credential authority</small>
              <strong>{build.headline}</strong>
              <span>{build.detail}</span>
            </span>
          </section>

          <div className="cloud-state-grid">
            <section
              className={`cloud-state-card ${legacy.tone}`}
              aria-labelledby="cloud-legacy-state"
              role={
                status.legacyStagedItem.state === "unknown"
                  ? "alert"
                  : undefined
              }
            >
              {status.legacyStagedItem.state === "not_observed" ? (
                <CheckCircle aria-hidden="true" />
              ) : status.legacyStagedItem.state === "present" ? (
                <Key aria-hidden="true" />
              ) : (
                <WarningCircle aria-hidden="true" />
              )}
              <span>
                <small id="cloud-legacy-state">Older setup item</small>
                <strong>{legacy.headline}</strong>
                <span>{legacy.detail}</span>
              </span>
            </section>

            <section
              className={`cloud-state-card ${protectedItem.tone}`}
              aria-labelledby="cloud-protected-state"
            >
              <LockKey aria-hidden="true" />
              <span>
                <small id="cloud-protected-state">Protected credential</small>
                <strong>{protectedItem.headline}</strong>
                <span>{protectedItem.detail}</span>
              </span>
            </section>

            <section
              className="cloud-state-card state-unvalidated"
              aria-labelledby="cloud-provider-check-state"
            >
              <Cloud aria-hidden="true" />
              <span>
                <small id="cloud-provider-check-state">
                  {status.providerCheck.providerLabel} check
                </small>
                <strong>Not run</strong>
                <span>
                  No provider credential, account, model, price, limit, or
                  health check has run.
                </span>
              </span>
            </section>

            <section
              className="cloud-state-card state-locked"
              aria-labelledby="cloud-dispatch-state"
            >
              <LockKey aria-hidden="true" />
              <span>
                <small id="cloud-dispatch-state">Cloud requests</small>
                <strong>Locked</strong>
                <span>{status.dispatch.explanation}</span>
              </span>
            </section>
          </div>

          <CredentialOperationStatus operation={status.latestOperation} />
          {status.legacyStagedItem.state === "unknown" ? (
            <div className="cloud-status-retry">
              <button
                ref={statusRetryRef}
                type="button"
                className="review-text-button"
                onClick={retryLocalStatus}
              >
                Retry local status
              </button>
            </div>
          ) : null}
        </div>
      )}
      <p className="cloud-provider-contact">
        {status?.providerContact.providerLabel ?? "OpenRouter"} was not contacted
        by this credential operation.
      </p>
    </section>
  );
}
