#include <array>
#include <cassert>
#include <chrono>
#include <string>

#include "identity-policy.hpp"
#include "lease-state-machine.hpp"
#include "secure-zero.hpp"

using soar::credential::EvaluateIdentityPolicy;
using soar::credential::ExactBundleRelativePath;
using soar::credential::IdentityEligibility;
using soar::credential::IdentityPolicyInput;
using soar::credential::IdentityReason;
using soar::credential::LegacyStatusPolicyInput;
using soar::credential::LeaseRequest;
using soar::credential::LeaseResultCode;
using soar::credential::LeaseState;
using soar::credential::LeaseStateMachine;
using soar::credential::SecureZero;

namespace {

IdentityPolicyInput EligibleIdentity() {
  return {
      .identity_check_available = true,
      .signed_build = true,
      .bundle_identifier_matches = true,
      .team_identifier_matches = true,
      .hardened_runtime = true,
      .library_validation = true,
      .forbidden_entitlement_absent = true,
      .profile_authorized = true,
      .module_identity_matches = true,
      .module_path_matches = true,
  };
}

void TestIdentityPolicy() {
  const auto eligible = EvaluateIdentityPolicy(EligibleIdentity());
  assert(eligible.eligibility == IdentityEligibility::kEligible);
  assert(eligible.reason == IdentityReason::kIdentityPolicySatisfied);

  auto each = EligibleIdentity();
  each.identity_check_available = false;
  assert(EvaluateIdentityPolicy(each).reason ==
         IdentityReason::kIdentityCheckUnavailable);
  each = EligibleIdentity();
  each.signed_build = false;
  assert(EvaluateIdentityPolicy(each).reason ==
         IdentityReason::kSignedBuildRequired);
  each = EligibleIdentity();
  each.bundle_identifier_matches = false;
  assert(EvaluateIdentityPolicy(each).reason ==
         IdentityReason::kWrongBundleIdentifier);
  each = EligibleIdentity();
  each.team_identifier_matches = false;
  assert(EvaluateIdentityPolicy(each).reason ==
         IdentityReason::kWrongTeamIdentifier);
  each = EligibleIdentity();
  each.hardened_runtime = false;
  assert(EvaluateIdentityPolicy(each).reason ==
         IdentityReason::kHardenedRuntimeMissing);
  each = EligibleIdentity();
  each.library_validation = false;
  assert(EvaluateIdentityPolicy(each).reason ==
         IdentityReason::kLibraryValidationDisabled);
  each = EligibleIdentity();
  each.forbidden_entitlement_absent = false;
  assert(EvaluateIdentityPolicy(each).reason ==
         IdentityReason::kForbiddenEntitlement);
  each = EligibleIdentity();
  each.profile_authorized = false;
  assert(EvaluateIdentityPolicy(each).reason ==
         IdentityReason::kProfileAuthorizationMissing);
  each = EligibleIdentity();
  each.module_identity_matches = false;
  assert(EvaluateIdentityPolicy(each).reason ==
         IdentityReason::kModuleIdentityMismatch);
  each = EligibleIdentity();
  each.module_path_matches = false;
  assert(EvaluateIdentityPolicy(each).reason ==
         IdentityReason::kModulePathMismatch);
}

void TestLegacyStatusPolicy() {
  const LegacyStatusPolicyInput admitted_ad_hoc_layout{
      .identity_check_available = true,
      .host_valid = true,
      .bundle_identifier_matches = true,
      .module_valid = true,
      .module_path_matches = true,
      .both_ad_hoc = true,
      .matching_identified_signer = false,
      .forbidden_entitlement_absent = true,
  };
  assert(soar::credential::EvaluateLegacyStatusPolicy(
      admitted_ad_hoc_layout));

  auto identified_signer = admitted_ad_hoc_layout;
  identified_signer.both_ad_hoc = false;
  identified_signer.matching_identified_signer = true;
  assert(soar::credential::EvaluateLegacyStatusPolicy(identified_signer));

  auto each = admitted_ad_hoc_layout;
  each.identity_check_available = false;
  assert(!soar::credential::EvaluateLegacyStatusPolicy(each));
  each = admitted_ad_hoc_layout;
  each.host_valid = false;
  assert(!soar::credential::EvaluateLegacyStatusPolicy(each));
  each = admitted_ad_hoc_layout;
  each.bundle_identifier_matches = false;
  assert(!soar::credential::EvaluateLegacyStatusPolicy(each));
  each = admitted_ad_hoc_layout;
  each.module_valid = false;
  assert(!soar::credential::EvaluateLegacyStatusPolicy(each));
  each = admitted_ad_hoc_layout;
  each.module_path_matches = false;
  assert(!soar::credential::EvaluateLegacyStatusPolicy(each));
  each = admitted_ad_hoc_layout;
  each.both_ad_hoc = false;
  each.matching_identified_signer = false;
  assert(!soar::credential::EvaluateLegacyStatusPolicy(each));
  each = admitted_ad_hoc_layout;
  each.forbidden_entitlement_absent = false;
  assert(!soar::credential::EvaluateLegacyStatusPolicy(each));
}

void TestExactBundleRelativePath() {
  constexpr std::string_view kRelative =
      "/Contents/Resources/app.asar.unpacked/node_modules/@soar/"
      "macos-credential-lease/build/Release/"
      "soar_macos_credential_lease.node";
  constexpr std::string_view kBundle = "/Applications/SOAR.app";
  constexpr std::string_view kExact =
      "/Applications/SOAR.app/Contents/Resources/app.asar.unpacked/"
      "node_modules/@soar/macos-credential-lease/build/Release/"
      "soar_macos_credential_lease.node";
  constexpr std::string_view kOtherBundleSameSuffix =
      "/tmp/Other.app/Contents/Resources/app.asar.unpacked/node_modules/"
      "@soar/macos-credential-lease/build/Release/"
      "soar_macos_credential_lease.node";

  assert(ExactBundleRelativePath(kBundle, kExact, kRelative));
  assert(!ExactBundleRelativePath(kBundle, kOtherBundleSameSuffix, kRelative));
  assert(!ExactBundleRelativePath("/Applications/SOAR.app/", kExact,
                                  kRelative));
  assert(!ExactBundleRelativePath(kBundle, kExact,
                                  "Contents/Resources/addon.node"));
}

void TestLeaseStateMachine() {
  LeaseStateMachine leases;
  const auto start = LeaseStateMachine::Clock::time_point{};
  const LeaseRequest request{
      .handle = "opaque-handle-a",
      .purpose = "provider-validation",
      .generation = "generation-a",
      .nonce = "nonce-a",
      .ttl = std::chrono::seconds(30),
  };
  assert(leases.Acquire(request, start).code == LeaseResultCode::kOk);
  assert(leases.RetainsNonceForTest(start));
  assert(leases.Acquire(request, start).code ==
         LeaseResultCode::kAlreadyActive);

  int consumption_count = 0;
  const auto wrong_handle = leases.Consume(
      "wrong-handle", request.purpose, request.generation, request.nonce,
      start, [&](std::string_view) {
        ++consumption_count;
        return true;
      });
  assert(wrong_handle.code == LeaseResultCode::kHandleMismatch);
  assert(wrong_handle.state == LeaseState::kActive);
  assert(consumption_count == 0);

  const auto wrong_purpose = leases.Consume(
      request.handle, "wrong", request.generation, request.nonce, start,
      [&](std::string_view) {
        ++consumption_count;
        return true;
      });
  assert(wrong_purpose.code == LeaseResultCode::kPurposeMismatch);
  assert(consumption_count == 0);

  const auto wrong_generation = leases.Consume(
      request.handle, request.purpose, "wrong-generation", request.nonce,
      start, [&](std::string_view) {
        ++consumption_count;
        return true;
      });
  assert(wrong_generation.code == LeaseResultCode::kGenerationMismatch);
  assert(wrong_generation.state == LeaseState::kActive);
  assert(consumption_count == 0);

  const auto wrong_nonce = leases.Consume(
      request.handle, request.purpose, request.generation, "wrong-nonce",
      start, [&](std::string_view) {
        ++consumption_count;
        return true;
      });
  assert(wrong_nonce.code == LeaseResultCode::kNonceMismatch);
  assert(wrong_nonce.state == LeaseState::kActive);
  assert(leases.RetainsNonceForTest(start));
  assert(consumption_count == 0);

  const auto consumed = leases.Consume(
      request.handle, request.purpose, request.generation, request.nonce, start,
      [&](std::string_view nonce) {
        ++consumption_count;
        return nonce == request.nonce;
      });
  assert(consumed.code == LeaseResultCode::kOk);
  assert(consumed.state == LeaseState::kConsumed);
  assert(!leases.RetainsNonceForTest(start));
  assert(consumption_count == 1);
  assert(leases
             .Consume(request.handle, request.purpose, request.generation,
                      request.nonce, start, [&](std::string_view) {
                        ++consumption_count;
                        return true;
                      })
             .code == LeaseResultCode::kNotActive);
  assert(consumption_count == 1);

  LeaseStateMachine invalid_ttl;
  auto overlong = request;
  overlong.ttl = std::chrono::milliseconds(30'001);
  assert(invalid_ttl.Acquire(overlong, start).code ==
         LeaseResultCode::kInvalidRequest);
  auto zero_ttl = request;
  zero_ttl.ttl = std::chrono::milliseconds(0);
  assert(invalid_ttl.Acquire(zero_ttl, start).code ==
         LeaseResultCode::kInvalidRequest);

  LeaseStateMachine expiring;
  assert(expiring.Acquire(request, start).code == LeaseResultCode::kOk);
  assert(expiring.State(start + std::chrono::seconds(30)) ==
         LeaseState::kExpired);
  assert(!expiring.RetainsNonceForTest(start + std::chrono::seconds(30)));
  assert(expiring
             .Consume(request.handle, request.purpose, request.generation,
                      request.nonce, start + std::chrono::seconds(30),
                      [](std::string_view) { return true; })
             .code == LeaseResultCode::kExpired);

  LeaseStateMachine invalidated;
  assert(invalidated.Acquire(request, start).code == LeaseResultCode::kOk);
  assert(invalidated.AbandonGeneration("wrong-generation", start).code ==
         LeaseResultCode::kGenerationMismatch);
  assert(invalidated.State(start) == LeaseState::kActive);
  assert(invalidated.AbandonGeneration(request.generation, start).state ==
         LeaseState::kAbandoned);
  assert(!invalidated.RetainsNonceForTest(start));
  assert(invalidated
             .Consume(request.handle, request.purpose, request.generation,
                      request.nonce, start,
                      [](std::string_view) { return true; })
             .code == LeaseResultCode::kNotActive);

  LeaseStateMachine released;
  assert(released.Acquire(request, start).code == LeaseResultCode::kOk);
  assert(released.Release("wrong-handle", start).code ==
         LeaseResultCode::kHandleMismatch);
  assert(released.Release(request.handle, start).state ==
         LeaseState::kReleased);
  assert(!released.RetainsNonceForTest(start));
  assert(released.Release(request.handle, start).code ==
         LeaseResultCode::kNotActive);
  assert(released
             .Consume(request.handle, request.purpose, request.generation,
                      request.nonce, start,
                      [](std::string_view) { return true; })
             .code == LeaseResultCode::kNotActive);

  LeaseStateMachine failed_consumer;
  assert(failed_consumer.Acquire(request, start).code ==
         LeaseResultCode::kOk);
  int failed_consumer_count = 0;
  assert(failed_consumer
             .Consume(request.handle, request.purpose, request.generation,
                      request.nonce, start, [&](std::string_view) {
                        ++failed_consumer_count;
                        return false;
                      })
             .code == LeaseResultCode::kConsumerFailed);
  assert(failed_consumer.State(start) == LeaseState::kConsumed);
  assert(!failed_consumer.RetainsNonceForTest(start));
  assert(failed_consumer
             .Consume(request.handle, request.purpose, request.generation,
                      request.nonce, start, [&](std::string_view) {
                        ++failed_consumer_count;
                        return true;
                      })
             .code == LeaseResultCode::kNotActive);
  assert(failed_consumer_count == 1);
}

void TestControlledZeroization() {
  std::array<unsigned char, 32> controlled{};
  controlled.fill(0xA5);
  SecureZero(controlled.data(), controlled.size());
  for (const auto value : controlled) assert(value == 0);
}

}  // namespace

int main() {
  TestIdentityPolicy();
  TestLegacyStatusPolicy();
  TestExactBundleRelativePath();
  TestLeaseStateMachine();
  TestControlledZeroization();
  return 0;
}
