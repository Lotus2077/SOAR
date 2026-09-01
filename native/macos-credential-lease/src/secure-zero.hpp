#ifndef SOAR_MACOS_CREDENTIAL_SECURE_ZERO_HPP_
#define SOAR_MACOS_CREDENTIAL_SECURE_ZERO_HPP_

#include <cstddef>

namespace soar::credential {

#if defined(__GNUC__) || defined(__clang__)
__attribute__((noinline))
#endif
inline void SecureZero(void* memory, std::size_t size) noexcept {
  auto* cursor = static_cast<volatile unsigned char*>(memory);
  while (size > 0) {
    *cursor = 0;
    ++cursor;
    --size;
  }
}

}  // namespace soar::credential

#endif  // SOAR_MACOS_CREDENTIAL_SECURE_ZERO_HPP_
