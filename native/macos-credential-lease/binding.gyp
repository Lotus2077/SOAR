{
  "targets": [
    {
      "target_name": "soar_macos_credential_lease",
      "sources": [
        "src/addon.mm",
        "src/identity-policy.cc",
        "src/lease-state-machine.cc"
      ],
      "defines": [
        "NAPI_VERSION=8",
        "SOAR_CREDENTIAL_BUILD_LOCKED=1"
      ],
      "xcode_settings": {
        "CLANG_CXX_LANGUAGE_STANDARD": "c++20",
        "CLANG_ENABLE_OBJC_ARC": "NO",
        "GCC_ENABLE_CPP_EXCEPTIONS": "YES",
        "GCC_ENABLE_CPP_RTTI": "NO",
        "GCC_SYMBOLS_PRIVATE_EXTERN": "YES",
        "MACOSX_DEPLOYMENT_TARGET": "13.0",
        "OTHER_CPLUSPLUSFLAGS": [
          "-Wall",
          "-Wextra",
          "-Werror",
          "-fblocks"
        ],
        "OTHER_LDFLAGS": [
          "-framework CoreFoundation",
          "-framework Security"
        ]
      }
    }
  ]
}
