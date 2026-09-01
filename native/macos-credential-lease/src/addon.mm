#include <CoreFoundation/CoreFoundation.h>
#include <Security/Security.h>
#include <dispatch/dispatch.h>
#include <dlfcn.h>
#include <limits.h>
#include <node_api.h>
#include <stdlib.h>

#include <cstdint>
#include <cstring>
#include <string>
#include <string_view>

#include "identity-policy.hpp"
#include "lease-state-machine.hpp"

#if !defined(SOAR_CREDENTIAL_BUILD_LOCKED) || \
    SOAR_CREDENTIAL_BUILD_LOCKED != 1
#error "PR6B1-B may compile only the locked credential broker flavor."
#endif

namespace soar::credential {
namespace {

constexpr std::string_view kSchemaVersion =
    "soar-native-credential-lease-v1";
constexpr std::string_view kLockedFlavor = "locked";
constexpr std::string_view kExpectedBundleIdentifier = "ai.soar.desktop";
constexpr std::string_view kLegacyService = "ai.soar.openrouter";
constexpr std::string_view kLegacyAccount = "default";
constexpr std::string_view kExpectedModuleRelativePath =
    "/Contents/Resources/app.asar.unpacked/node_modules/@soar/"
    "macos-credential-lease/build/Release/"
    "soar_macos_credential_lease.node";

constexpr const char* kForbiddenEntitlements[] = {
    "com.apple.security.get-task-allow",
    "com.apple.security.cs.debugger",
    "com.apple.security.cs.allow-dyld-environment-variables",
    "com.apple.security.cs.disable-library-validation",
    "com.apple.security.cs.allow-unsigned-executable-memory",
};

struct CodeFacts {
  bool available = false;
  bool valid = false;
  bool ad_hoc = false;
  bool signed_build = false;
  bool expected_bundle = false;
  bool hardened_runtime = false;
  bool library_validation = false;
  bool forbidden_entitlement_absent = false;
  std::string team_identifier;
};

struct BrokerState {
  BrokerState()
      : queue(dispatch_queue_create(
            "ai.soar.credential-lease.locked", DISPATCH_QUEUE_SERIAL)) {
    dispatch_sync(queue, ^{
      initial_identity = EvaluateCurrentIdentity();
    });
  }

  static IdentityPolicyResult EvaluateCurrentIdentity();
  static bool LegacyStatusAllowedForCurrentIdentity();

  dispatch_queue_t queue;
  LeaseStateMachine leases;
  IdentityPolicyResult initial_identity{
      IdentityEligibility::kUnavailable,
      IdentityReason::kIdentityCheckUnavailable,
  };
};

bool CfStringEquals(CFTypeRef value, std::string_view expected) {
  if (value == nullptr || CFGetTypeID(value) != CFStringGetTypeID()) {
    return false;
  }
  CFStringRef expected_string = CFStringCreateWithBytes(
      kCFAllocatorDefault,
      reinterpret_cast<const UInt8*>(expected.data()),
      static_cast<CFIndex>(expected.size()), kCFStringEncodingUTF8, false);
  if (expected_string == nullptr) return false;
  const bool equal = CFEqual(value, expected_string);
  CFRelease(expected_string);
  return equal;
}

std::string CfStringToBoundedUtf8(CFTypeRef value) {
  if (value == nullptr || CFGetTypeID(value) != CFStringGetTypeID()) return {};
  const auto string = static_cast<CFStringRef>(value);
  char buffer[129] = {};
  if (!CFStringGetCString(string, buffer, sizeof(buffer),
                          kCFStringEncodingUTF8)) {
    return {};
  }
  return std::string(buffer);
}

bool ReadSignatureFlags(CFDictionaryRef information, std::uint32_t* flags) {
  const auto value = CFDictionaryGetValue(information, kSecCodeInfoFlags);
  if (value == nullptr || CFGetTypeID(value) != CFNumberGetTypeID()) {
    return false;
  }
  std::int64_t wide_flags = 0;
  if (!CFNumberGetValue(static_cast<CFNumberRef>(value), kCFNumberSInt64Type,
                        &wide_flags) ||
      wide_flags < 0 || wide_flags > UINT32_MAX) {
    return false;
  }
  *flags = static_cast<std::uint32_t>(wide_flags);
  return true;
}

bool HasForbiddenEntitlement(CFDictionaryRef information) {
  const auto value =
      CFDictionaryGetValue(information, kSecCodeInfoEntitlementsDict);
  if (value == nullptr) return false;
  if (CFGetTypeID(value) != CFDictionaryGetTypeID()) return true;
  const auto entitlements = static_cast<CFDictionaryRef>(value);
  for (const char* name : kForbiddenEntitlements) {
    CFStringRef key = CFStringCreateWithCString(
        kCFAllocatorDefault, name, kCFStringEncodingUTF8);
    if (key == nullptr) return true;
    const auto entitlement = CFDictionaryGetValue(entitlements, key);
    CFRelease(key);
    // Presence itself is forbidden. A false or malformed value is not proof
    // that the capability is absent from the signed entitlement dictionary.
    if (entitlement != nullptr) return true;
  }
  return false;
}

CodeFacts FactsForCode(SecStaticCodeRef code, bool expected_bundle) {
  CodeFacts facts;
  if (code == nullptr ||
      SecStaticCodeCheckValidity(code, kSecCSStrictValidate, nullptr) !=
          errSecSuccess) {
    return facts;
  }
  facts.valid = true;

  CFDictionaryRef information = nullptr;
  if (SecCodeCopySigningInformation(
          code, kSecCSSigningInformation | kSecCSRequirementInformation,
          &information) != errSecSuccess ||
      information == nullptr) {
    return facts;
  }

  std::uint32_t flags = 0;
  if (!ReadSignatureFlags(information, &flags)) {
    CFRelease(information);
    return facts;
  }
  facts.team_identifier = CfStringToBoundedUtf8(
      CFDictionaryGetValue(information, kSecCodeInfoTeamIdentifier));
  facts.ad_hoc = (flags & kSecCodeSignatureAdhoc) != 0;
  facts.signed_build =
      !facts.ad_hoc && !facts.team_identifier.empty();
  facts.expected_bundle =
      !expected_bundle ||
      CfStringEquals(
          CFDictionaryGetValue(information, kSecCodeInfoIdentifier),
          kExpectedBundleIdentifier);
  facts.hardened_runtime = (flags & kSecCodeSignatureRuntime) != 0;
  facts.library_validation =
      (flags & kSecCodeSignatureLibraryValidation) != 0;
  facts.forbidden_entitlement_absent = !HasForbiddenEntitlement(information);
  facts.available = true;
  CFRelease(information);
  return facts;
}

CodeFacts HostCodeFacts() {
  SecCodeRef dynamic_code = nullptr;
  if (SecCodeCopySelf(kSecCSDefaultFlags, &dynamic_code) != errSecSuccess ||
      dynamic_code == nullptr) {
    return {};
  }
  if (SecCodeCheckValidity(dynamic_code, kSecCSStrictValidate, nullptr) !=
      errSecSuccess) {
    CFRelease(dynamic_code);
    return {};
  }
  SecStaticCodeRef static_code = nullptr;
  if (SecCodeCopyStaticCode(dynamic_code, kSecCSDefaultFlags, &static_code) !=
          errSecSuccess ||
      static_code == nullptr) {
    CFRelease(dynamic_code);
    return {};
  }
  CodeFacts facts = FactsForCode(static_code, true);
  CFRelease(static_code);
  CFRelease(dynamic_code);
  return facts;
}

void ModuleAnchor() {}

bool ModulePath(std::string* path) {
  Dl_info information = {};
  if (dladdr(reinterpret_cast<const void*>(&ModuleAnchor), &information) == 0 ||
      information.dli_fname == nullptr) {
    return false;
  }
  char resolved[PATH_MAX] = {};
  if (realpath(information.dli_fname, resolved) == nullptr) return false;
  path->assign(resolved);
  return path->size() < PATH_MAX;
}

bool MainBundleRoot(std::string* path) {
  CFBundleRef bundle = CFBundleGetMainBundle();
  if (bundle == nullptr) return false;
  CFURLRef url = CFBundleCopyBundleURL(bundle);
  if (url == nullptr) return false;
  UInt8 unresolved[PATH_MAX] = {};
  const bool copied = CFURLGetFileSystemRepresentation(
      url, true, unresolved, sizeof(unresolved));
  CFRelease(url);
  if (!copied) return false;
  char resolved[PATH_MAX] = {};
  if (realpath(reinterpret_cast<const char*>(unresolved), resolved) ==
      nullptr) {
    return false;
  }
  path->assign(resolved);
  return !path->empty() && path->size() < PATH_MAX;
}

bool ModulePathMatchesCurrentBundle(std::string_view module_path) {
  std::string bundle_root;
  return MainBundleRoot(&bundle_root) &&
         ExactBundleRelativePath(bundle_root, module_path,
                                 kExpectedModuleRelativePath);
}

CodeFacts ModuleCodeFacts(const std::string& path) {
  CFURLRef url = CFURLCreateFromFileSystemRepresentation(
      kCFAllocatorDefault, reinterpret_cast<const UInt8*>(path.data()),
      static_cast<CFIndex>(path.size()), false);
  if (url == nullptr) return {};
  SecStaticCodeRef code = nullptr;
  const OSStatus create_status = SecStaticCodeCreateWithPath(
      url, kSecCSDefaultFlags, &code);
  CFRelease(url);
  if (create_status != errSecSuccess || code == nullptr) return {};
  CodeFacts facts = FactsForCode(code, false);
  CFRelease(code);
  return facts;
}

IdentityPolicyResult BrokerState::EvaluateCurrentIdentity() {
  const CodeFacts host = HostCodeFacts();
  std::string module_path;
  const bool path_available = ModulePath(&module_path);
  const CodeFacts module =
      path_available ? ModuleCodeFacts(module_path) : CodeFacts{};
  const bool module_identity_matches =
      host.available && module.available && host.valid && module.valid &&
      !host.team_identifier.empty() &&
      host.team_identifier == module.team_identifier;

  // Phase B intentionally has no expected Team ID or profile/access-group
  // authorization compiled into it. A genuinely signed package therefore
  // reaches profile_authorization_missing rather than claiming eligibility.
  return EvaluateIdentityPolicy({
      .identity_check_available = host.available && path_available,
      .signed_build = host.signed_build,
      .bundle_identifier_matches = host.expected_bundle,
      .team_identifier_matches = !host.team_identifier.empty(),
      .hardened_runtime = host.hardened_runtime,
      .library_validation = host.library_validation,
      .forbidden_entitlement_absent =
          host.forbidden_entitlement_absent,
      .profile_authorized = false,
      .module_identity_matches = module_identity_matches,
      .module_path_matches =
          path_available && ModulePathMatchesCurrentBundle(module_path),
  });
}

bool BrokerState::LegacyStatusAllowedForCurrentIdentity() {
  const CodeFacts host = HostCodeFacts();
  std::string module_path;
  const bool path_available = ModulePath(&module_path);
  const CodeFacts module =
      path_available ? ModuleCodeFacts(module_path) : CodeFacts{};
  const bool both_ad_hoc = host.ad_hoc && module.ad_hoc &&
                           host.team_identifier.empty() &&
                           module.team_identifier.empty();
  const bool same_identified_signer = !host.team_identifier.empty() &&
                                      host.team_identifier ==
                                          module.team_identifier;

  // Passive legacy presence is the sole ad-hoc exception. It still requires
  // the exact SOAR bundle identity, the sealed module location, valid host and
  // module code, and signer continuity whenever a Team ID is available.
  return EvaluateLegacyStatusPolicy({
      .identity_check_available =
          host.available && module.available && path_available,
      .host_valid = host.valid,
      .bundle_identifier_matches = host.expected_bundle,
      .module_valid = module.valid,
      .module_path_matches =
          path_available && ModulePathMatchesCurrentBundle(module_path),
      .both_ad_hoc = both_ad_hoc,
      .matching_identified_signer = same_identified_signer,
      .forbidden_entitlement_absent =
          host.forbidden_entitlement_absent &&
          module.forbidden_entitlement_absent,
  });
}

BrokerState& State() {
  static BrokerState state;
  return state;
}

IdentityPolicyResult EvaluateIdentityOnBrokerQueue() {
  __block IdentityPolicyResult identity{
      IdentityEligibility::kUnavailable,
      IdentityReason::kIdentityCheckUnavailable,
  };
  dispatch_sync(State().queue, ^{
    identity = BrokerState::EvaluateCurrentIdentity();
  });
  return identity;
}

bool SetString(napi_env env,
               napi_value object,
               const char* name,
               std::string_view value) {
  napi_value text = nullptr;
  return napi_create_string_utf8(env, value.data(), value.size(), &text) ==
             napi_ok &&
         napi_set_named_property(env, object, name, text) == napi_ok;
}

napi_value CapabilityResult(napi_env env, IdentityPolicyResult identity) {
  napi_value result = nullptr;
  if (napi_create_object(env, &result) != napi_ok ||
      !SetString(env, result, "schemaVersion", kSchemaVersion) ||
      !SetString(env, result, "flavor", kLockedFlavor) ||
      !SetString(env, result, "eligibility",
                 EligibilityName(identity.eligibility)) ||
      !SetString(env, result, "reasonCode",
                 IdentityReasonName(identity.reason))) {
    return nullptr;
  }
  return result;
}

napi_value Capability(napi_env env, napi_callback_info) {
  return CapabilityResult(env, EvaluateIdentityOnBrokerQueue());
}

napi_value ActivationLocked(napi_env env, napi_callback_info) {
  // Repeat native identity validation on every lease operation, but do not
  // expose its detail here. Locked Phase B has no protected/synthetic locator,
  // consumer, or SecItem mutation and cannot issue a handle.
  (void)EvaluateIdentityOnBrokerQueue();
  napi_value result = nullptr;
  if (napi_create_object(env, &result) != napi_ok ||
      !SetString(env, result, "state", "activation_locked") ||
      !SetString(env, result, "reasonCode", "activation_locked")) {
    return nullptr;
  }
  return result;
}

enum class LegacyState {
  kPresent,
  kNotObserved,
  kUnknownLocked,
  kUnknownDenied,
  kUnknownUnavailable,
};

LegacyState ReadLegacyStatus() {
  CFMutableDictionaryRef query = CFDictionaryCreateMutable(
      kCFAllocatorDefault, 0, &kCFTypeDictionaryKeyCallBacks,
      &kCFTypeDictionaryValueCallBacks);
  if (query == nullptr) return LegacyState::kUnknownUnavailable;

  CFStringRef service = CFStringCreateWithBytes(
      kCFAllocatorDefault,
      reinterpret_cast<const UInt8*>(kLegacyService.data()),
      static_cast<CFIndex>(kLegacyService.size()), kCFStringEncodingUTF8,
      false);
  CFStringRef account = CFStringCreateWithBytes(
      kCFAllocatorDefault,
      reinterpret_cast<const UInt8*>(kLegacyAccount.data()),
      static_cast<CFIndex>(kLegacyAccount.size()), kCFStringEncodingUTF8,
      false);
  if (service == nullptr || account == nullptr) {
    if (service != nullptr) CFRelease(service);
    if (account != nullptr) CFRelease(account);
    CFRelease(query);
    return LegacyState::kUnknownUnavailable;
  }

  CFDictionarySetValue(query, kSecClass, kSecClassGenericPassword);
  CFDictionarySetValue(query, kSecAttrService, service);
  CFDictionarySetValue(query, kSecAttrAccount, account);
  CFDictionarySetValue(query, kSecMatchLimit, kSecMatchLimitOne);
  CFDictionarySetValue(query, kSecReturnAttributes, kCFBooleanTrue);
  CFDictionarySetValue(query, kSecReturnData, kCFBooleanFalse);
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
  // PR6B1-B deliberately uses the explicit fail mode required by its approved
  // passive-status contract. The modern LAContext equivalent belongs to a
  // separately reviewed native UI/authentication boundary.
  CFDictionarySetValue(query, kSecUseAuthenticationUI,
                       kSecUseAuthenticationUIFail);
#pragma clang diagnostic pop
  CFRelease(service);
  CFRelease(account);

  CFTypeRef result = nullptr;
  const OSStatus status = SecItemCopyMatching(query, &result);
  CFRelease(query);
  if (result != nullptr) CFRelease(result);

  if (status == errSecSuccess) return LegacyState::kPresent;
  if (status == errSecItemNotFound) return LegacyState::kNotObserved;
  if (status == errSecInteractionNotAllowed) {
    return LegacyState::kUnknownLocked;
  }
  if (status == errSecAuthFailed || status == errSecUserCanceled) {
    return LegacyState::kUnknownDenied;
  }
  return LegacyState::kUnknownUnavailable;
}

struct LegacyWork {
  napi_env env = nullptr;
  napi_deferred deferred = nullptr;
  napi_async_work work = nullptr;
  LegacyState result = LegacyState::kUnknownUnavailable;
};

void ExecuteLegacyStatus(napi_env, void* data) {
  auto* work = static_cast<LegacyWork*>(data);
  dispatch_sync(State().queue, ^{
    // The legacy query is the sole Phase-B Keychain exception. Wrong hosts,
    // copied modules outside the sealed path, and signer mismatches return
    // unknown before Security.framework receives a query.
    if (BrokerState::LegacyStatusAllowedForCurrentIdentity()) {
      work->result = ReadLegacyStatus();
    }
  });
}

napi_value LegacyResult(napi_env env, LegacyState state) {
  napi_value result = nullptr;
  if (napi_create_object(env, &result) != napi_ok) return nullptr;
  switch (state) {
    case LegacyState::kPresent:
      if (!SetString(env, result, "state", "present") ||
          !SetString(env, result, "reasonCode",
                     "legacy_metadata_present")) {
        return nullptr;
      }
      break;
    case LegacyState::kNotObserved:
      if (!SetString(env, result, "state", "not_observed") ||
          !SetString(env, result, "reasonCode",
                     "legacy_metadata_not_observed")) {
        return nullptr;
      }
      break;
    case LegacyState::kUnknownLocked:
      if (!SetString(env, result, "state", "unknown") ||
          !SetString(env, result, "reasonCode", "keychain_locked")) {
        return nullptr;
      }
      break;
    case LegacyState::kUnknownDenied:
      if (!SetString(env, result, "state", "unknown") ||
          !SetString(env, result, "reasonCode", "keychain_access_denied")) {
        return nullptr;
      }
      break;
    case LegacyState::kUnknownUnavailable:
      if (!SetString(env, result, "state", "unknown") ||
          !SetString(env, result, "reasonCode",
                     "legacy_metadata_unavailable")) {
        return nullptr;
      }
      break;
  }
  return result;
}

void CompleteLegacyStatus(napi_env env, napi_status status, void* data) {
  auto* work = static_cast<LegacyWork*>(data);
  napi_value result = LegacyResult(
      env, status == napi_ok ? work->result
                             : LegacyState::kUnknownUnavailable);
  if (result == nullptr) {
    napi_value undefined = nullptr;
    (void)napi_get_undefined(env, &undefined);
    (void)napi_resolve_deferred(env, work->deferred, undefined);
  } else {
    (void)napi_resolve_deferred(env, work->deferred, result);
  }
  (void)napi_delete_async_work(env, work->work);
  delete work;
}

napi_value LegacyStatus(napi_env env, napi_callback_info) {
  auto* work = new LegacyWork();
  work->env = env;
  napi_value promise = nullptr;
  napi_value resource_name = nullptr;
  if (napi_create_promise(env, &work->deferred, &promise) != napi_ok ||
      napi_create_string_utf8(env, "soar:legacy-credential-status",
                              NAPI_AUTO_LENGTH, &resource_name) != napi_ok ||
      napi_create_async_work(env, nullptr, resource_name, ExecuteLegacyStatus,
                             CompleteLegacyStatus, work, &work->work) !=
          napi_ok ||
      napi_queue_async_work(env, work->work) != napi_ok) {
    if (work->work != nullptr) (void)napi_delete_async_work(env, work->work);
    delete work;
    return nullptr;
  }
  return promise;
}

bool ExportFunction(napi_env env,
                    napi_value exports,
                    const char* name,
                    napi_callback callback) {
  napi_value function = nullptr;
  return napi_create_function(env, name, NAPI_AUTO_LENGTH, callback, nullptr,
                              &function) == napi_ok &&
         napi_set_named_property(env, exports, name, function) == napi_ok;
}

}  // namespace
}  // namespace soar::credential

NAPI_MODULE_INIT() {
  // Constructing State performs the first host/self validation before any
  // exported operation becomes reachable.
  (void)soar::credential::State();
  if (!soar::credential::ExportFunction(env, exports, "capability",
                                        soar::credential::Capability) ||
      !soar::credential::ExportFunction(env, exports, "legacyStatus",
                                        soar::credential::LegacyStatus) ||
      !soar::credential::ExportFunction(env, exports, "acquireLease",
                                        soar::credential::ActivationLocked) ||
      !soar::credential::ExportFunction(env, exports, "consumeLease",
                                        soar::credential::ActivationLocked) ||
      !soar::credential::ExportFunction(env, exports, "releaseLease",
                                        soar::credential::ActivationLocked)) {
    return nullptr;
  }
  return exports;
}
