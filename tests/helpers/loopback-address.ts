/**
 * BL-20261117-1641-fixture-tests-loopback-address-forms: the forms in which a loopback endpoint's address would show in a record or a
 * printed line, for the role-fixture tests' "without the address" checks. They are the base URL, its origin, and the host and port in
 * each loopback spelling and as a URL's port before a path. They are never the port's bare digits, nor its digits after a colon: a random
 * port's digits can occur by chance inside a sha256 digest (CI's `check` on #153, port 35339) or as the start of a JSON number
 * (`"bytes":353390`), so a record that holds those digits may still hold no address.
 */
export function loopbackAddressForms(baseUrl: string): string[] {
  const url = new URL(baseUrl);
  // Without an explicit port `:${port}/` would be ":/", which every URL holds.
  if (!url.port) throw new Error("loopback_address_without_port");
  return [...new Set([baseUrl, url.origin, url.host, `127.0.0.1:${url.port}`, `localhost:${url.port}`, `[::1]:${url.port}`, `:${url.port}/`])];
}
