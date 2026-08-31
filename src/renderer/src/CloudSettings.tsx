import {
  ArrowLeft,
  CheckCircle,
  Cloud,
  Key,
  LockKey,
  Trash,
  WarningCircle,
} from "@phosphor-icons/react";
import React from "react";
import { useEffect, useRef, useState, type FormEvent } from "react";

import type {
  CloudSetupErrorCode,
  CloudSetupStatus,
} from "../../shared/cloud-setup-contracts";

const storageErrorCopy: Readonly<Record<CloudSetupErrorCode, string>> = {
  unsupported_platform: "Cloud credentials can only be stored in macOS Keychain.",
  invalid_credential: "Enter one exact, single-line credential.",
  operation_in_progress: "Another credential change is still in progress.",
  keychain_unavailable: "macOS Keychain is unavailable right now.",
  keychain_timeout: "macOS Keychain did not finish in time.",
  keychain_output_limit: "macOS Keychain returned an unexpected result.",
  keychain_status_failed: "SOAR could not read the local credential status.",
  keychain_write_failed: "SOAR could not store the credential in macOS Keychain.",
  keychain_replace_failed: "SOAR could not replace the credential in macOS Keychain.",
  keychain_delete_failed: "SOAR could not remove the credential from macOS Keychain.",
};

export interface CloudSettingsProps {
  status: CloudSetupStatus | null;
  loading: boolean;
  loadFailed: boolean;
  onRetry: () => void;
  onSave: (credential: string) => Promise<CloudSetupStatus>;
  onDelete: () => Promise<CloudSetupStatus>;
  onDone: () => void;
}

export function CloudSettings({
  status,
  loading,
  loadFailed,
  onRetry,
  onSave,
  onDelete,
  onDone,
}: CloudSettingsProps) {
  const titleRef = useRef<HTMLHeadingElement>(null);
  const credentialRef = useRef<HTMLInputElement>(null);
  const statusRetryRef = useRef<HTMLButtonElement>(null);
  const deleteTriggerRef = useRef<HTMLButtonElement>(null);
  const deleteConfirmRef = useRef<HTMLButtonElement>(null);
  const restoreDeleteFocusRef = useRef(false);
  const focusCredentialAfterDeleteRef = useRef(false);
  const restoreStatusFocusRef = useRef(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [operationError, setOperationError] = useState<string | null>(null);

  const stored = status?.state === "stored_unvalidated";
  const unavailable = loading || saving || deleting;

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  useEffect(() => {
    if (confirmDelete) {
      deleteConfirmRef.current?.focus();
      return;
    }
    if (focusCredentialAfterDeleteRef.current) {
      focusCredentialAfterDeleteRef.current = false;
      credentialRef.current?.focus();
      return;
    }
    if (restoreDeleteFocusRef.current) {
      restoreDeleteFocusRef.current = false;
      deleteTriggerRef.current?.focus();
    }
  }, [confirmDelete]);

  useEffect(() => {
    if (
      !restoreStatusFocusRef.current ||
      loading ||
      saving ||
      deleting
    ) {
      return;
    }
    restoreStatusFocusRef.current = false;
    if (loadFailed || status?.state === "local_storage_error") {
      statusRetryRef.current?.focus();
      return;
    }
    titleRef.current?.focus();
  }, [deleting, loadFailed, loading, saving, status?.state]);

  const retryLocalStatus = (): void => {
    restoreStatusFocusRef.current = true;
    onRetry();
  };

  const submitCredential = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (unavailable) return;

    const input = credentialRef.current;
    if (!input) return;

    let credential = input.value;
    // Clear the DOM before invoking IPC. The secret is never copied into React
    // state or browser storage, and the response contract cannot echo it.
    input.value = "";
    setOperationError(null);
    setConfirmDelete(false);

    if (credential.length === 0) {
      setOperationError("Enter an OpenRouter credential before saving.");
      return;
    }

    setSaving(true);
    let request: Promise<CloudSetupStatus>;
    try {
      request = onSave(credential);
    } catch {
      credential = "";
      setSaving(false);
      setOperationError(
        stored
          ? "SOAR could not confirm the replacement. Check local status before trying again."
          : "SOAR could not confirm that the credential was stored. Check local status before trying again.",
      );
      return;
    }
    credential = "";
    void request
      .then((result) => {
        if (result.state === "local_storage_error") {
          restoreStatusFocusRef.current = true;
        } else if (result.state !== "stored_unvalidated") {
          setOperationError(
            "SOAR could not confirm that the credential was stored. Check local status before trying again.",
          );
        }
      })
      .catch(() => {
        setOperationError(
          stored
            ? "SOAR could not confirm the replacement. Check local status before trying again."
            : "SOAR could not confirm that the credential was stored. Check local status before trying again.",
        );
      })
      .finally(() => setSaving(false));
  };

  const removeCredential = (): void => {
    if (unavailable) return;
    setOperationError(null);
    setDeleting(true);
    void onDelete()
      .then((result) => {
        if (result.state === "local_storage_error") {
          restoreStatusFocusRef.current = true;
          return;
        }
        if (result.state !== "not_configured") {
          setOperationError(
            "SOAR could not confirm whether the credential was removed. Check local status before trying again.",
          );
          return;
        }
        focusCredentialAfterDeleteRef.current = true;
        setConfirmDelete(false);
      })
      .catch(() => {
        setOperationError(
          "SOAR could not confirm whether the credential was removed. Check local status before trying again.",
        );
      })
      .finally(() => setDeleting(false));
  };

  return (
    <section className="cloud-settings" aria-labelledby="cloud-settings-title">
      <header className="cloud-settings-heading">
        <button
          type="button"
          className="cloud-settings-back"
          onClick={onDone}
          disabled={saving || deleting}
        >
          <ArrowLeft aria-hidden="true" />
          Done
        </button>
        <span className="review-kicker">Settings</span>
        <h1 ref={titleRef} id="cloud-settings-title" tabIndex={-1}>
          Cloud synthesis
        </h1>
        <p>
          Optionally store a dedicated credential in macOS Keychain. Local tasks
          and local review remain available without cloud setup.
        </p>
      </header>

      {loading ? (
        <div className="cloud-settings-loading" role="status">
          Reading local Keychain status…
        </div>
      ) : loadFailed || !status ? (
        <div className="cloud-settings-load-error" role="alert">
          <WarningCircle weight="fill" aria-hidden="true" />
          <span>
            <strong>Local status unavailable</strong>
            SOAR could not read cloud setup status. This check made no cloud-provider request.
          </span>
          <button
            ref={statusRetryRef}
            type="button"
            className="review-text-button"
            onClick={retryLocalStatus}
          >
            Try again
          </button>
        </div>
      ) : (
        <div className="cloud-settings-body">
          <section className="cloud-candidate" aria-labelledby="cloud-candidate-title">
            <div className="cloud-candidate-icon"><Cloud aria-hidden="true" /></div>
            <span>
              <small id="cloud-candidate-title">Cloud candidate</small>
              <strong>{status.candidate.modelLabel}</strong>
              <span>{status.candidate.providerLabel} · Candidate only</span>
            </span>
          </section>

          <div className="cloud-state-grid">
            <section
              className={`cloud-state-card state-${status.state}`}
              aria-labelledby="cloud-storage-state"
              role={status.state === "local_storage_error" ? "alert" : "status"}
              aria-live={status.state === "local_storage_error" ? "assertive" : "polite"}
            >
              {status.state === "stored_unvalidated" ? (
                <CheckCircle weight="fill" aria-hidden="true" />
              ) : status.state === "local_storage_error" ? (
                <WarningCircle weight="fill" aria-hidden="true" />
              ) : (
                <Key aria-hidden="true" />
              )}
              <span>
                <small id="cloud-storage-state">Local credential</small>
                <strong>
                  {status.state === "stored_unvalidated"
                    ? "Stored locally"
                    : status.state === "local_storage_error"
                      ? "Local storage error"
                      : "Not configured"}
                </strong>
                <span>
                  {status.state === "stored_unvalidated"
                    ? "Stored in macOS Keychain. The credential is never shown here."
                    : status.state === "local_storage_error"
                      ? storageErrorCopy[status.errorCode]
                      : "No cloud credential is stored for SOAR."}
                </span>
              </span>
            </section>

            <section className="cloud-state-card state-unvalidated" aria-labelledby="cloud-validation-state">
              <WarningCircle aria-hidden="true" />
              <span>
                <small id="cloud-validation-state">Provider status</small>
                <strong>Not validated</strong>
                <span>No cloud-provider validation has occurred for this candidate.</span>
              </span>
            </section>

            <section className="cloud-state-card state-locked" aria-labelledby="cloud-dispatch-state">
              <LockKey aria-hidden="true" />
              <span>
                <small id="cloud-dispatch-state">Cloud dispatch</small>
                <strong>Hybrid locked</strong>
                <span>{status.dispatch.explanation}</span>
              </span>
            </section>
          </div>

          {status.state === "local_storage_error" ? (
            <div className="cloud-status-retry">
              <button
                ref={statusRetryRef}
                type="button"
                className="review-text-button"
                onClick={retryLocalStatus}
                disabled={unavailable}
              >
                Retry local status
              </button>
            </div>
          ) : (
          <form className="cloud-credential-form" onSubmit={submitCredential}>
            <div className="cloud-credential-heading">
              <span>
                <strong>{stored ? "Replace credential" : "Store credential"}</strong>
                <small>
                  {stored
                    ? "The current value stays stored unless replacement succeeds."
                    : "Saving stores the value locally. It does not validate or enable Hybrid."}
                </small>
              </span>
            </div>
            <label className="cloud-credential-field">
              <span>{stored ? "Replacement OpenRouter credential" : "OpenRouter credential"}</span>
              <input
                ref={credentialRef}
                type="password"
                name="cloud-credential"
                autoComplete="off"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                disabled={unavailable}
                aria-describedby="cloud-credential-privacy"
              />
            </label>
            <p id="cloud-credential-privacy" className="cloud-credential-privacy">
              The field is cleared immediately when submitted. SOAR does not put
              this value in app settings, session history, or browser storage.
            </p>

            {operationError ? (
              <p className="cloud-operation-error" role="alert">
                <WarningCircle weight="fill" aria-hidden="true" />
                {operationError}
              </p>
            ) : null}

            <div className="cloud-credential-actions">
              <button
                type="submit"
                className="review-start-button cloud-save-button"
                disabled={unavailable}
              >
                <Key aria-hidden="true" />
                {saving ? "Saving…" : stored ? "Replace" : "Save"}
              </button>
              {stored && !confirmDelete ? (
                <button
                  ref={deleteTriggerRef}
                  type="button"
                  className="cloud-delete-button"
                  onClick={() => setConfirmDelete(true)}
                  disabled={unavailable}
                >
                  <Trash aria-hidden="true" />
                  Delete
                </button>
              ) : null}
            </div>

            {stored && confirmDelete ? (
              <div className="cloud-delete-confirm" role="group" aria-label="Confirm credential deletion">
                <span>
                  <strong>Remove the stored credential?</strong>
                  <small>Hybrid remains locked, and SOAR will report no stored credential.</small>
                </span>
                <button
                  ref={deleteConfirmRef}
                  type="button"
                  className="cloud-delete-confirm-button"
                  onClick={removeCredential}
                  disabled={unavailable}
                >
                  {deleting ? "Removing…" : "Remove credential"}
                </button>
                <button
                  type="button"
                  className="review-text-button"
                  onClick={() => {
                    restoreDeleteFocusRef.current = true;
                    setConfirmDelete(false);
                  }}
                  disabled={unavailable}
                >
                  Keep credential
                </button>
              </div>
            ) : null}
          </form>
          )}
        </div>
      )}
    </section>
  );
}
