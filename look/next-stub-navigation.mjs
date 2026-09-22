// Stands in for next/navigation's notFound(), the same shape the existing unit tests already use.
export function notFound() {
    throw Object.assign(new Error("NEXT_NOT_FOUND"), { digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
}

// screens/page.js imports both at module scope even where a component test calls neither. Named
// exports have to exist for the import itself to resolve; a test that reaches one fails loudly
// instead of redirecting anywhere.
export function permanentRedirect() {
    throw new Error("permanentRedirect() was called by a component test that named no redirect target");
}

export function redirect() {
    throw new Error("redirect() was called by a component test that named no redirect target");
}
