#include "lease-state-machine.hpp"

#include "secure-zero.hpp"

namespace soar::credential {
namespace {

constexpr std::chrono::milliseconds kMaximumLeaseTtl{30'000};

bool IsBoundedField(std::string_view value) noexcept {
  return !value.empty() && value.size() <= 256;
}

}  // namespace

LeaseResult LeaseStateMachine::Acquire(const LeaseRequest& request,
                                       Clock::time_point now) {
  std::lock_guard<std::mutex> lock(mutex_);
  ExpireIfNeeded(now);
  if (record_.has_value() && record_->state == LeaseState::kActive) {
    return {LeaseResultCode::kAlreadyActive, LeaseState::kActive};
  }
  if (!IsBoundedField(request.handle) || !IsBoundedField(request.purpose) ||
      !IsBoundedField(request.generation) || !IsBoundedField(request.nonce) ||
      request.ttl.count() <= 0 || request.ttl > kMaximumLeaseTtl) {
    return {LeaseResultCode::kInvalidRequest, LeaseState::kAbandoned};
  }

  record_ = Record{
      .handle = request.handle,
      .purpose = request.purpose,
      .generation = request.generation,
      .nonce = request.nonce,
      .expires_at = now + request.ttl,
      .state = LeaseState::kAcquiring,
  };
  record_->state = LeaseState::kActive;
  return {LeaseResultCode::kOk, LeaseState::kActive};
}

LeaseResult LeaseStateMachine::Consume(
    std::string_view handle,
    std::string_view expected_purpose,
    std::string_view expected_generation,
    std::string_view nonce,
    Clock::time_point now,
    const Consumer& consumer) {
  std::lock_guard<std::mutex> lock(mutex_);
  ExpireIfNeeded(now);
  if (!record_.has_value() || record_->state != LeaseState::kActive) {
    return {record_.has_value() && record_->state == LeaseState::kExpired
                ? LeaseResultCode::kExpired
                : LeaseResultCode::kNotActive,
            record_.has_value() ? record_->state : LeaseState::kAbandoned};
  }
  if (record_->handle != handle) {
    return {LeaseResultCode::kHandleMismatch, record_->state};
  }
  if (record_->purpose != expected_purpose) {
    return {LeaseResultCode::kPurposeMismatch, record_->state};
  }
  if (record_->generation != expected_generation) {
    return {LeaseResultCode::kGenerationMismatch, record_->state};
  }
  if (!IsBoundedField(nonce)) {
    return {LeaseResultCode::kInvalidRequest, record_->state};
  }
  if (record_->nonce != nonce) {
    return {LeaseResultCode::kNonceMismatch, record_->state};
  }

  // Consumption is terminal before the consumer runs. A failure cannot make
  // the opaque handle reusable.
  record_->state = LeaseState::kConsumed;
  ClearNonce();
  return {consumer(nonce) ? LeaseResultCode::kOk
                          : LeaseResultCode::kConsumerFailed,
          LeaseState::kConsumed};
}

LeaseResult LeaseStateMachine::Release(std::string_view handle,
                                       Clock::time_point now) {
  std::lock_guard<std::mutex> lock(mutex_);
  ExpireIfNeeded(now);
  if (!record_.has_value() || record_->state != LeaseState::kActive) {
    return {LeaseResultCode::kNotActive,
            record_.has_value() ? record_->state : LeaseState::kAbandoned};
  }
  if (record_->handle != handle) {
    return {LeaseResultCode::kHandleMismatch, record_->state};
  }
  record_->state = LeaseState::kReleased;
  ClearNonce();
  return {LeaseResultCode::kOk, LeaseState::kReleased};
}

LeaseResult LeaseStateMachine::AbandonGeneration(std::string_view generation,
                                                 Clock::time_point now) {
  std::lock_guard<std::mutex> lock(mutex_);
  ExpireIfNeeded(now);
  if (!record_.has_value() || record_->state != LeaseState::kActive) {
    return {LeaseResultCode::kNotActive,
            record_.has_value() ? record_->state : LeaseState::kAbandoned};
  }
  if (record_->generation != generation) {
    return {LeaseResultCode::kGenerationMismatch, record_->state};
  }
  record_->state = LeaseState::kAbandoned;
  ClearNonce();
  return {LeaseResultCode::kOk, LeaseState::kAbandoned};
}

LeaseState LeaseStateMachine::State(Clock::time_point now) {
  std::lock_guard<std::mutex> lock(mutex_);
  ExpireIfNeeded(now);
  return record_.has_value() ? record_->state : LeaseState::kAbandoned;
}

#if defined(SOAR_CREDENTIAL_NATIVE_CORE_TEST)
bool LeaseStateMachine::RetainsNonceForTest(Clock::time_point now) {
  std::lock_guard<std::mutex> lock(mutex_);
  ExpireIfNeeded(now);
  return record_.has_value() && !record_->nonce.empty();
}
#endif

void LeaseStateMachine::ExpireIfNeeded(Clock::time_point now) {
  if (record_.has_value() && record_->state == LeaseState::kActive &&
      now >= record_->expires_at) {
    record_->state = LeaseState::kExpired;
    ClearNonce();
  }
}

void LeaseStateMachine::ClearNonce() {
  if (!record_.has_value() || record_->nonce.empty()) return;
  SecureZero(record_->nonce.data(), record_->nonce.size());
  record_->nonce.clear();
}

}  // namespace soar::credential
