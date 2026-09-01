#ifndef SOAR_MACOS_CREDENTIAL_IDENTITY_POLICY_HPP_
#define SOAR_MACOS_CREDENTIAL_IDENTITY_POLICY_HPP_

#include <string_view>

namespace soar::credential {

enum class IdentityEligibility {
  kEligible,
  kIneligible,
  kUnavailable,
};

enum class IdentityReason {
  kIdentityPolicySatisfied,
  kSignedBuildRequired,
  kWrongBundleIdentifier,
  kWrongTeamIdentifier,
  kHardenedRuntimeMissing,
  kLibraryValidationDisabled,
  kForbiddenEntitlement,
  kProfileAuthorizationMissing,
  kModuleIdentityMismatch,
  kModulePathMismatch,
  kIdentityCheckUnavailable,
};

struct IdentityPolicyInput {
  bool identity_check_available = false;
  bool signed_build = false;
  bool bundle_identifier_matches = false;
  bool team_identifier_matches = false;
  bool hardened_runtime = false;
  bool library_validation = false;
  bool forbidden_entitlement_absent = false;
  bool profile_authorized = false;
  bool module_identity_matches = false;
  bool module_path_matches = false;
};

struct IdentityPolicyResult {
  IdentityEligibility eligibility;
  IdentityReason reason;
};

struct LegacyStatusPolicyInput {
  bool identity_check_available = false;
  bool host_valid = false;
  bool bundle_identifier_matches = false;
  bool module_valid = false;
  bool module_path_matches = false;
  bool both_ad_hoc = false;
  bool matching_identified_signer = false;
  bool forbidden_entitlement_absent = false;
};

IdentityPolicyResult EvaluateIdentityPolicy(
    const IdentityPolicyInput& input) noexcept;
bool EvaluateLegacyStatusPolicy(
    const LegacyStatusPolicyInput& input) noexcept;
bool ExactBundleRelativePath(std::string_view canonical_bundle_root,
                             std::string_view canonical_module_path,
                             std::string_view expected_relative_path) noexcept;
std::string_view EligibilityName(IdentityEligibility eligibility) noexcept;
std::string_view IdentityReasonName(IdentityReason reason) noexcept;

}  // namespace soar::credential

#endif  // SOAR_MACOS_CREDENTIAL_IDENTITY_POLICY_HPP_
