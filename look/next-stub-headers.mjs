// Stands in for next/headers. A component test builds a config with no `sites` option, which is
// the only path that reads a request's headers, so this throws rather than guessing at a Headers
// object nobody asked for: a test that reaches it anyway fails loudly instead of reading nothing.
export async function headers() {
    throw new Error("headers() was read by a component test that named no request to read them from");
}

export async function cookies() {
    return { get: () => undefined };
}
