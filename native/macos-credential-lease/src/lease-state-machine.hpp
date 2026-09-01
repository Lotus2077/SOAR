#ifndef SOAR_MACOS_CREDENTIAL_LEASE_STATE_MACHINE_HPP_
#define SOAR_MACOS_CREDENTIAL_LEASE_STATE_MACHINE_HPP_

#include <chrono>
#include <functional>
#include <mutex>
#include <optional>
#include <string>
#include <string_view>

namespace soar::credential {

enum class LeaseState {
  kAcquiring,
  kActive,
  kConsumed,
  kReleased,
  kExpired,
  kAbandoned,
};

enum class LeaseResultCode {
  kOk,
  kAlreadyActive,
  kInvalidRequest,
  kNotActive,
  kHandleMismatch,
  kPurposeMismatch,
  kGenerationMismatch,
  kNonceMismatch,
  kExpired,
  kConsumerFailed,
};

struct LeaseRequest {
  std::string handle;
  std::string purpose;
  std::string generation;
  std::string nonce;
  std::chrono::milliseconds ttl;
};

struct LeaseResult {
  LeaseResultCode code;
  LeaseState state;
};

class LeaseStateMachine final {
 public:
  using Clock = std::chrono::steady_clock;
  using Consumer = std::function<bool(std::string_view nonce)>;

  LeaseStateMachine() = default;
  LeaseStateMachine(const LeaseStateMachine&) = delete;
  LeaseStateMachine& operator=(const LeaseStateMachine&) = delete;

  LeaseResult Acquire(const LeaseRequest& request, Clock::time_point now);
  LeaseResult Consume(std::string_view handle,
                      std::string_view expected_purpose,
                      std::string_view expected_generation,
                      std::string_view nonce,
                      Clock::time_point now,
                      const Consumer& consumer);
  LeaseResult Release(std::string_view handle, Clock::time_point now);
  LeaseResult AbandonGeneration(std::string_view generation,
                                Clock::time_point now);
  LeaseState State(Clock::time_point now);
#if defined(SOAR_CREDENTIAL_NATIVE_CORE_TEST)
  bool RetainsNonceForTest(Clock::time_point now);
#endif

 private:
  struct Record {
    std::string handle;
    std::string purpose;
    std::string generation;
    std::string nonce;
    Clock::time_point expires_at;
    LeaseState state;
  };

  void ExpireIfNeeded(Clock::time_point now);
  void ClearNonce();

  std::mutex mutex_;
  std::optional<Record> record_;
};

}  // namespace soar::credential

#endif  // SOAR_MACOS_CREDENTIAL_LEASE_STATE_MACHINE_HPP_
