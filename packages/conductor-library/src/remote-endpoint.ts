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

/** D10 §13.2 point 4's default hard cap on `3xx` re-entries when a caller does not supply
 * `maxRedirects` -- conservative on purpose (an SSRF guard's own redirect budget should be small; a
 * legitimate remote corpus/embedding endpoint has no business chaining more than a handful of
 * redirects, and every extra hop is another full allowlist+DNS+pin re-entry an attacker gets to
 * probe). Not sourced from the ADR (which specifies the mechanism -- a hard cap exists -- but not a
 * number); grounded instead at Gate 6 against OWASP ASVS's SSRF guidance for allowlist-based egress
 * controls (V5.2.6/V5.2.7), which favors the smallest number that does not break the legitimate case
 * over a large default. */
const DEFAULT_MAX_REDIRECTS = 5;

interface RemoteTarget {
	host: string;
	scheme: "https" | "http";
	port: number;
}

function targetFromEntry(entry: PolicyNetworkEntry): RemoteTarget {
	const scheme = entry.scheme ?? "https";
	return {
		host: entry.destination,
		scheme,
		port: entry.port ?? (scheme === "https" ? 443 : 80),
	};
}

/** Step 1: allowlist match on host/port/scheme -- EXACT string comparison, never suffix/substring
 * (same discipline `policy-trust-store.ts` already applies to its own content-hash comparisons). A
 * redirect target re-enters this same check against the SAME single grant `entry` -- there is no
 * broader allowlist to fall back to, so a redirect can only ever succeed by landing back on exactly
 * what was already granted. */
function matchesAllowlist(target: RemoteTarget, entry: PolicyNetworkEntry): { ok: true } | { ok: false; reason: string } {
	const allowedScheme = entry.scheme ?? "https";
	if (target.scheme !== allowedScheme) {
		return { ok: false, reason: `scheme not allowlisted: expected "${allowedScheme}", got "${target.scheme}"` };
	}
	if (target.scheme === "http" && entry.allowPlaintext !== true) {
		return { ok: false, reason: "plaintext http requires allowPlaintext:true on the grant" };
	}
	if (target.host.toLowerCase() !== entry.destination.toLowerCase()) {
		return { ok: false, reason: `host not allowlisted: "${target.host}"` };
	}
	const allowedPort = entry.port ?? (allowedScheme === "https" ? 443 : 80);
	if (target.port !== allowedPort) {
		return { ok: false, reason: `port not allowlisted: expected ${allowedPort}, got ${target.port}` };
	}
	return { ok: true };
}

function ipv4Octets(address: string): number[] | null {
	const parts = address.split(".");
	if (parts.length !== 4) return null;
	const octets = parts.map(Number);
	if (octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
	return octets;
}

/** Step 3 (IPv4 half): loopback (127.0.0.0/8), link-local incl. cloud metadata (169.254.0.0/16, which
 * covers 169.254.169.254), private (10/8, 172.16/12, 192.168/16), and unspecified (0.0.0.0). A
 * malformed address (not four valid octets) fails CLOSED -- treated as disallowed rather than passed
 * through, since a value this function cannot classify cannot be proven safe either. */
function isDisallowedIpv4(address: string): boolean {
	const octets = ipv4Octets(address);
	if (!octets) return true;
	const [a, b] = octets as [number, number, number, number];
	if (a === 127) return true; // loopback
	if (a === 169 && b === 254) return true; // link-local, incl. 169.254.169.254 cloud metadata
	if (a === 10) return true; // private (RFC1918)
	if (a === 172 && b >= 16 && b <= 31) return true; // private (RFC1918)
	if (a === 192 && b === 168) return true; // private (RFC1918)
	if (a === 0 && b === 0) return true; // unspecified (0.0.0.0/8, covers 0.0.0.0 itself)
	return false;
}

/** An IPv4-mapped IPv6 address (`::ffff:a.b.c.d`, in its common dotted-quad textual form) disguising
 * one of the ranges above -- unwrapped and re-checked under the IPv4 rules (step 3's explicit
 * "disguising one of the above" case). Returns `null` when `address` is not in that form. */
function ipv4MappedAddress(address: string): string | null {
	const lower = address.toLowerCase();
	const prefix = "::ffff:";
	if (!lower.startsWith(prefix)) return null;
	const rest = address.slice(prefix.length);
	return ipv4Octets(rest) ? rest : null;
}

/** Step 3 (IPv6 half): loopback (::1), unspecified (::), link-local (fe80::/10), unique-local/private
 * (fc00::/7), and IPv4-mapped addresses (delegated to `isDisallowedIpv4` after unwrapping). */
function isDisallowedIpv6(address: string): boolean {
	const lower = address.toLowerCase();
	if (lower === "::1" || lower === "0:0:0:0:0:0:0:1") return true; // loopback
	if (lower === "::" || lower === "0:0:0:0:0:0:0:0") return true; // unspecified

	const mapped = ipv4MappedAddress(address);
	if (mapped) return isDisallowedIpv4(mapped);

	const firstGroup = lower.split(":")[0] ?? "";
	if (/^fe[89ab][0-9a-f]$/.test(firstGroup)) return true; // link-local, fe80::/10
	if (/^f[cd][0-9a-f]{2}$/.test(firstGroup)) return true; // unique-local/private, fc00::/7

	return false;
}

function isDisallowedAddress(address: ResolvedAddress): boolean {
	return address.family === 4 ? isDisallowedIpv4(address.address) : isDisallowedIpv6(address.address);
}

function buildRequestUrl(target: RemoteTarget): string {
	const isDefaultPort = (target.scheme === "https" && target.port === 443) || (target.scheme === "http" && target.port === 80);
	return `${target.scheme}://${target.host}${isDefaultPort ? "" : `:${target.port}`}`;
}

function targetFromRedirect(redirectTo: string): RemoteTarget | { error: string } {
	let url: URL;
	try {
		url = new URL(redirectTo);
	} catch {
		return { error: `redirect target is not a valid URL: "${redirectTo}"` };
	}
	if (url.protocol !== "https:" && url.protocol !== "http:") {
		return { error: `unsupported redirect scheme: "${url.protocol}"` };
	}
	const scheme = url.protocol === "https:" ? "https" : "http";
	return {
		host: url.hostname,
		scheme,
		port: url.port ? Number(url.port) : scheme === "https" ? 443 : 80,
	};
}

function isRedirectStatus(status: number): boolean {
	return status >= 300 && status < 400;
}

/**
 * Validates `entry` against the allowlist, resolves and SSRF-checks the destination, pins the
 * resolved IP, records egress before connecting, and connects -- re-entering the whole guard for any
 * `3xx` redirect target. See this file's header for the full six-step contract.
 *
 * Never rejects its returned promise for an EXPECTED failure (allowlist mismatch, SSRF-disallowed
 * address, malformed redirect target, redirect budget exhausted, or the injected `dns`/`http` deps
 * themselves failing) -- every one of those collapses to `{ ok: false, reason }` instead, the same
 * "expected failure is a return value, not an exception" discipline `openGroundingLedgerReader` (R36)
 * and `loadPolicyTrustStore` (R11) already apply on their own read paths. A network guard whose
 * failure mode is "throw and hope every caller remembers to catch it" is one accidental unhandled
 * rejection away from taking down whatever process embeds it -- the Result-shaped return makes the
 * failure impossible to ignore silently.
 */
export async function connectRemote(
	entry: PolicyNetworkEntry,
	audit: EgressAuditWriter,
	deps: ConnectRemoteDeps,
): Promise<ConnectRemoteResult> {
	const maxRedirects = deps.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
	let target = targetFromEntry(entry);
	let redirectsFollowed = 0;

	for (;;) {
		const allow = matchesAllowlist(target, entry);
		if (!allow.ok) return { ok: false, reason: allow.reason };

		let resolved: ResolvedAddress[];
		try {
			resolved = await deps.dns.lookup(target.host);
		} catch (error) {
			return { ok: false, reason: `dns resolution failed for "${target.host}": ${String(error)}` };
		}
		if (resolved.length === 0) {
			return { ok: false, reason: `dns resolution returned no addresses for "${target.host}"` };
		}
		if (entry.allowPrivateAddress !== true) {
			// Step 3: reject if ANY resolved address is disallowed -- a hostile/rebinding resolver can
			// return a list, and only the first entry being benign proves nothing about the rest.
			const disallowed = resolved.find(isDisallowedAddress);
			if (disallowed) {
				return {
					ok: false,
					reason: `resolved address "${disallowed.address}" is not publicly routable (loopback/link-local/private/unspecified)`,
				};
			}
		}

		// Step 4: PIN the first resolved address and connect to THAT IP -- never re-resolve before
		// connecting, which is exactly the TOCTOU window DNS rebinding exploits.
		const pinnedIp = resolved[0]!.address;
		const url = buildRequestUrl(target);

		// Step 6: egress recorded BEFORE the network call, synchronously ordered ahead of it (mirrors
		// audit-trail.ts's own documented "write the event, then perform the action" guarantee).
		audit.recordEgress({ destination: target.host, resolvedIp: pinnedIp, payloadKind: deps.payloadKind });

		let response: RemoteHttpResponse;
		try {
			response = await deps.http.request(url, pinnedIp);
		} catch (error) {
			return { ok: false, reason: `request to "${target.host}" (${pinnedIp}) failed: ${String(error)}` };
		}

		if (!isRedirectStatus(response.status)) {
			return { ok: true, conn: { destination: target.host, resolvedIp: pinnedIp } };
		}
		if (!response.redirectTo) {
			return { ok: false, reason: `redirect status ${response.status} without a redirect target` };
		}
		// Step 5: `redirect: "manual"` -- never followed by the injected http client itself; a 3xx
		// re-enters steps 2-4 (the allowlist/DNS/SSRF/pin sequence above) IN FULL for the new target,
		// bounded by maxRedirects.
		if (redirectsFollowed >= maxRedirects) {
			return { ok: false, reason: `redirect budget exhausted (maxRedirects=${maxRedirects})` };
		}
		const nextTarget = targetFromRedirect(response.redirectTo);
		if ("error" in nextTarget) {
			return { ok: false, reason: nextTarget.error };
		}
		target = nextTarget;
		redirectsFollowed += 1;
	}
}
