/**
 * Remote RAG endpoint: policy-grant + TOFU + SSRF guard over the RESOLVED IP -- BORDA: network + audit
 * (docs/adr/0006-fase5-library-and-grounding.md D10, Apêndice §19; gate3-addendum-fase5.md R33/T52).
 *
 * GATE 5 (test-first): `connectRemote` is a STUB that throws "not implemented" -- Gate 6 implements
 * the body. This file ships the signature test/remote-endpoint.test.ts already compiles and tests
 * against.
 *
 * The decision this function embodies (D10 §13.1/§13.2), in order:
 *   1. No environment variable EVER participates (the class of authority `gate_land.py` and Fase 4's
 *      T40/R22 already rejected in writing) -- the only input is a `PolicyNetworkEntry` the CALLER
 *      already resolved through `@conductor/config`'s TOFU + trust-ordered-intersection policy chain
 *      (that resolution is out of THIS function's scope; by the time an entry reaches here it is
 *      already the trusted, merged grant).
 *   2. Allowlist match on host/port/scheme -- exact string match, never suffix/substring (the same
 *      discipline this monorepo's own `policy-trust-store.ts` already applies elsewhere).
 *   3. Resolve the hostname and reject if ANY resolved address is loopback, link-local (including
 *      `169.254.169.254`, cloud metadata), private, unspecified, or an IPv4-mapped IPv6 address
 *      disguising one of the above -- unless `entry.allowPrivateAddress` is explicitly true. Checked
 *      against EVERY address a resolver returns, not just the first (a hostile/rebinding resolver can
 *      return a list).
 *   4. PIN the resolved IP and connect to THAT IP (with the original hostname still used for
 *      `Host`/SNI) -- this is what closes the TOCTOU window between step 3's resolution and the
 *      actual connection; re-resolving at connect time would let DNS answer differently between the
 *      two calls (rebinding).
 *   5. `redirect: "manual"` -- a `3xx` response re-enters steps 2-4 IN FULL for the new target. A
 *      redirect is never followed automatically, and a chain has a hard cap (`maxRedirects`).
 *   6. Egress is recorded via `audit` BEFORE the network call is made -- reusing the synchronous,
 *      durable-on-return guarantee `@conductor/runtime`'s `audit-trail.ts` already documents for this
 *      exact ordering pattern.
 *
 * `dns`/`http` are injected (never `node:dns`/global `fetch` called directly by this function) so
 * tests can simulate a hostile/rebinding resolver and a redirecting server without touching a real
 * network -- the ADR §19 two-argument signature is widened by one optional `deps` parameter for
 * exactly this purpose (documented testability seam, same pattern as `code-index.ts`'s
 * `OpenCodeIndexOptions`; production callers omit it and get real `node:dns`/`fetch`).
 */

/** D10 §13.2's extension of the policy-loader's network grant shape -- declared locally (a
 * structurally-compatible port), not imported from `@conductor/config` (that package's
 * `policy-loader.ts` is in the PARALLEL Gate 5 stream's scope for this same ADR delta; Gate 6's
 * composition root is what wires a real `@conductor/config` grant into this shape). */
export interface PolicyNetworkEntry {
	/** Host only (no scheme) -- the allowlist entry, matched EXACTLY, never by suffix/substring. */
	destination: string;
	scheme?: "https" | "http";
	port?: number;
	/** Required to reach an `http://` (non-TLS) destination at all; default false. */
	allowPlaintext?: boolean;
	/** The ONLY door to a loopback/link-local/private resolved address (e.g. the user's own local
	 * Chroma) -- explicit, per grant entry; default false. */
	allowPrivateAddress?: boolean;
}

export interface ResolvedAddress {
	address: string;
	family: 4 | 6;
}

/** Injected DNS resolution -- production default is `node:dns/promises`' `lookup(host, { all: true
 * })`; a test supplies a fake that can return DIFFERENT addresses on successive calls to simulate
 * rebinding. */
export interface DnsResolver {
	lookup(hostname: string): Promise<ResolvedAddress[]>;
}

export interface RemoteHttpResponse {
	status: number;
	/** Present only for a `3xx` response -- the redirect target, re-entered through the WHOLE guard
	 * (never followed automatically by the HTTP client itself). */
	redirectTo?: string;
}

/** Injected HTTP transport -- production default connects to `resolvedIp` directly (the pinned
 * address) while still sending the original hostname as `Host`/SNI; a test supplies a fake that never
 * touches a real network and can simulate a `3xx` response. */
export interface RemoteHttpClient {
	request(url: string, resolvedIp: string): Promise<RemoteHttpResponse>;
}

/** The shape this package needs from `@conductor/runtime`'s audit trail (D10 §13.3's `egress`
 * extension) -- a structurally-compatible PORT, never a direct import of `@conductor/runtime`'s
 * audit-trail.ts (in the PARALLEL Gate 5 stream's scope for this same ADR delta). */
export interface EgressAuditWriter {
	recordEgress(entry: {
		destination: string;
		resolvedIp?: string;
		payloadKind?: "query-embedding" | "corpus-fetch";
	}): void;
}

export interface RemoteConnection {
	destination: string;
	/** The PINNED IP the connection was actually made to (never re-resolved after this point). */
	resolvedIp: string;
}

export interface ConnectRemoteDeps {
	dns: DnsResolver;
	http: RemoteHttpClient;
	payloadKind?: "query-embedding" | "corpus-fetch";
	/** Hard cap on `3xx` re-entries (D10 §13.2 point 4); a chain longer than this is a refusal, never
	 * an infinite/unbounded follow. */
	maxRedirects?: number;
}

export type ConnectRemoteResult = { ok: true; conn: RemoteConnection } | { ok: false; reason: string };

/**
 * Validates `entry` against the allowlist, resolves and SSRF-checks the destination, pins the
 * resolved IP, records egress before connecting, and connects -- re-entering the whole guard for any
 * `3xx` redirect target. See this file's header for the full six-step contract.
 */
export function connectRemote(
	entry: PolicyNetworkEntry,
	audit: EgressAuditWriter,
	deps: ConnectRemoteDeps,
): Promise<ConnectRemoteResult> {
	throw new Error("not implemented");
}
