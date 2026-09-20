// Stands in for next/navigation's notFound(), the same shape the existing unit tests already use.
export function notFound() {
    throw Object.assign(new Error("NEXT_NOT_FOUND"), { digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
}
