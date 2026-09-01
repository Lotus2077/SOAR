#include "identity-policy.hpp"

namespace soar::credential {

IdentityPolicyResult EvaluateIdentityPolicy(
    const IdentityPolicyInput& input) noexcept {
  if (!input.identity_check_available) {
    return {IdentityEligibility::kUnavailable,
            IdentityReason::kIdentityCheckUnavailable};
  }
  if (!input.signed_build) {
    return {IdentityEligibility::kIneligible,
            IdentityReason::kSignedBuildRequired};
  }
  if (!input.bundle_identifier_matches) {
    return {IdentityEligibility::kIneligible,
            IdentityReason::kWrongBundleIdentifier};
  }
  if (!input.team_identifier_matches) {
    return {IdentityEligibility::kIneligible,
            IdentityReason::kWrongTeamIdentifier};
  }
  if (!input.hardened_runtime) {
    return {IdentityEligibility::kIneligible,
            IdentityReason::kHardenedRuntimeMissing};
  }
  if (!input.library_validation) {
    return {IdentityEligibility::kIneligible,
            IdentityReason::kLibraryValidationDisabled};
  }
  if (!input.forbidden_entitlement_absent) {
    return {IdentityEligibility::kIneligible,
            IdentityReason::kForbiddenEntitlement};
  }
  if (!input.module_identity_matches) {
    return {IdentityEligibility::kIneligible,
            IdentityReason::kModuleIdentityMismatch};
  }
  if (!input.module_path_matches) {
    return {IdentityEligibility::kIneligible,
            IdentityReason::kModulePathMismatch};
  }
  if (!input.profile_authorized) {
    return {IdentityEligibility::kIneligible,
            IdentityReason::kProfileAuthorizationMissing};
  }
  return {IdentityEligibility::kEligible,
          IdentityReason::kIdentityPolicySatisfied};
}

bool EvaluateLegacyStatusPolicy(
    const LegacyStatusPolicyInput& input) noexcept {
  return input.identity_check_available && input.host_valid &&
         input.bundle_identifier_matches && input.module_valid &&
         input.module_path_matches &&
         (input.both_ad_hoc || input.matching_identified_signer) &&
         input.forbidden_entitlement_absent;
}

bool ExactBundleRelativePath(
    std::string_view canonical_bundle_root,
    std::string_view canonical_module_path,
    std::string_view expected_relative_path) noexcept {
  if (canonical_bundle_root.empty() || canonical_bundle_root.front() != '/' ||
      canonical_bundle_root.back() == '/' || expected_relative_path.empty() ||
      expected_relative_path.front() != '/' ||
      canonical_module_path.size() !=
          canonical_bundle_root.size() + expected_relative_path.size()) {
    return false;
  }
  return canonical_module_path.starts_with(canonical_bundle_root) &&
         canonical_module_path.substr(canonical_bundle_root.size()) ==
             expected_relative_path;
}

std::string_view EligibilityName(IdentityEligibility eligibility) noexcept {
  switch (eligibility) {
    case IdentityEligibility::kEligible:
      return "eligible";
    case IdentityEligibility::kIneligible:
      return "ineligible";
    case IdentityEligibility::kUnavailable:
      return "unavailable";
  }
  return "unavailable";
}

std::string_view IdentityReasonName(IdentityReason reason) noexcept {
  switch (reason) {
    case IdentityReason::kIdentityPolicySatisfied:
      return "identity_policy_satisfied";
    case IdentityReason::kSignedBuildRequired:
      return "signed_build_required";
    case IdentityReason::kWrongBundleIdentifier:
      return "wrong_bundle_identifier";
    case IdentityReason::kWrongTeamIdentifier:
      return "wrong_team_identifier";
    case IdentityReason::kHardenedRuntimeMissing:
      return "hardened_runtime_missing";
    case IdentityReason::kLibraryValidationDisabled:
      return "library_validation_disabled";
    case IdentityReason::kForbiddenEntitlement:
      return "forbidden_entitlement";
    case IdentityReason::kProfileAuthorizationMissing:
      return "profile_authorization_missing";
    case IdentityReason::kModuleIdentityMismatch:
      return "module_identity_mismatch";
    case IdentityReason::kModulePathMismatch:
      return "module_path_mismatch";
    case IdentityReason::kIdentityCheckUnavailable:
      return "identity_check_unavailable";
  }
  return "identity_check_unavailable";
}

}  // namespace soar::credential
