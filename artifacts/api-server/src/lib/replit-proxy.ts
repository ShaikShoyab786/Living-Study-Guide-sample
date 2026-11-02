/**
 * Replit preview requests currently reach the API through a local socket peer
 * plus three X-Forwarded-For entries. Keep this exact hop count in sync with
 * the proxy chain; do not replace it with blanket trust.
 */
export const REPLIT_TRUSTED_PROXY_HOPS = 4;
