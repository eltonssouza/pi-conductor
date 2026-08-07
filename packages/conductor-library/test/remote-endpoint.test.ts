/**
 * Test-first (Gate 5) for `connectRemote` (src/remote-endpoint.ts) -- ADR 0006 D10/§13,
 * gate3-addendum-fase5.md R33/T52.
 *
 * `connectRemote` is currently a STUB that throws "not implemented" -- every test below fails RED for
 * that one reason today (Gate 6 implements the body).
 *
 * Every DNS resolution and every HTTP call in this file is a FAKE (`DnsResolver`/`RemoteHttpClient`)
 * injected via `ConnectRemoteDeps` -- nothing here ever touches a real network, matching the ADR's own
 * framing: the guard must be provable without needing a real attacker-controlled DNS server or a real
 * cloud metadata endpoint to test against.
 */
import { describe, expect, it } from "vitest";
import {
	connectRemote,
	type DnsResolver,
	type EgressAuditWriter,
	type PolicyNetworkEntry,
	type RemoteHttpClient,
	type RemoteHttpResponse,
	type ResolvedAddress,
} from "../src/remote-endpoint.ts";

function fakeDnsResolver(sequence: ResolvedAddress[][]): DnsResolver & { calls: string[] } {
	const calls: string[] = [];
	let index = 0;
	return {
		calls,
		lookup: async (hostname: string) => {
			calls.push(hostname);
			const addresses = sequence[Math.min(index, sequence.length - 1)];
			index += 1;
			return addresses ?? [];
		},
	};
}

function fakeHttpClient(
	responses: RemoteHttpResponse[],
): RemoteHttpClient & { requests: Array<{ url: string; resolvedIp: string }> } {
	const requests: Array<{ url: string; resolvedIp: string }> = [];
	let index = 0;
	return {
		requests,
		request: async (url: string, resolvedIp: string) => {
			requests.push({ url, resolvedIp });
			const response = responses[Math.min(index, responses.length - 1)];
			index += 1;
			return response ?? { status: 200 };
		},
	};
}

function fakeAudit(): EgressAuditWriter & { entries: Array<{ destination: string; resolvedIp?: string }> } {
	const entries: Array<{ destination: string; resolvedIp?: string }> = [];
	return {
		entries,
		recordEgress: (entry) => {
			entries.push(entry);
		},
	};
}

const BENIGN_LOOKING_ENTRY: PolicyNetworkEntry = { destination: "rag.example.com" };

describe("connectRemote -- SSRF guard over the RESOLVED IP (D10 §13.2)", () => {
	it("rejects a destination that resolves to loopback, even though the hostname string looks benign", async () => {
		const dns = fakeDnsResolver([[{ address: "127.0.0.1", family: 4 }]]);
		const http = fakeHttpClient([{ status: 200 }]);
		const audit = fakeAudit();

		const result = await connectRemote(BENIGN_LOOKING_ENTRY, audit, { dns, http });

		expect(result.ok).toBe(false);
		expect(http.requests).toHaveLength(0);
	});

	it("rejects a destination that resolves to the cloud metadata link-local address 169.254.169.254", async () => {
		const dns = fakeDnsResolver([[{ address: "169.254.169.254", family: 4 }]]);
		const http = fakeHttpClient([{ status: 200 }]);
		const audit = fakeAudit();

		const result = await connectRemote(BENIGN_LOOKING_ENTRY, audit, { dns, http });

		expect(result.ok).toBe(false);
		expect(http.requests).toHaveLength(0);
	});

	it("rejects a destination that resolves to a private (RFC1918) address", async () => {
		const dns = fakeDnsResolver([[{ address: "10.0.0.5", family: 4 }]]);
		const http = fakeHttpClient([{ status: 200 }]);
		const audit = fakeAudit();

		const result = await connectRemote(BENIGN_LOOKING_ENTRY, audit, { dns, http });

		expect(result.ok).toBe(false);
		expect(http.requests).toHaveLength(0);
	});

	it("rejects if ANY resolved address is private, even when a hostile resolver ALSO returns a public one in the same answer", async () => {
		const dns = fakeDnsResolver([
			[
				{ address: "8.8.8.8", family: 4 },
				{ address: "192.168.1.1", family: 4 },
			],
		]);
		const http = fakeHttpClient([{ status: 200 }]);
		const audit = fakeAudit();

		const result = await connectRemote(BENIGN_LOOKING_ENTRY, audit, { dns, http });

		expect(result.ok).toBe(false);
		expect(http.requests).toHaveLength(0);
	});

	it("accepts a private address ONLY when allowPrivateAddress is explicitly true on that grant entry", async () => {
		const entry: PolicyNetworkEntry = { destination: "local-chroma.internal", allowPrivateAddress: true };
		const dns = fakeDnsResolver([[{ address: "127.0.0.1", family: 4 }]]);
		const http = fakeHttpClient([{ status: 200 }]);
		const audit = fakeAudit();

		const result = await connectRemote(entry, audit, { dns, http });

		expect(result.ok).toBe(true);
		expect(http.requests).toHaveLength(1);
	});

	it("accepts an ordinary public address with no special allowance needed", async () => {
		const dns = fakeDnsResolver([[{ address: "203.0.113.10", family: 4 }]]);
		const http = fakeHttpClient([{ status: 200 }]);
		const audit = fakeAudit();

		const result = await connectRemote(BENIGN_LOOKING_ENTRY, audit, { dns, http });

		expect(result.ok).toBe(true);
	});
});

describe("connectRemote -- IP pinning against DNS rebinding (D10 §13.2 point 3)", () => {
	it("connects to the FIRST resolved address and never re-resolves before connecting, even if the resolver would answer differently a second time", async () => {
		// A rebinding resolver: a benign public address on the first lookup, a private one on any
		// SECOND lookup. If connectRemote re-resolved before connecting, it would see the second,
		// malicious answer.
		const dns = fakeDnsResolver([[{ address: "203.0.113.10", family: 4 }], [{ address: "127.0.0.1", family: 4 }]]);
		const http = fakeHttpClient([{ status: 200 }]);
		const audit = fakeAudit();

		const result = await connectRemote(BENIGN_LOOKING_ENTRY, audit, { dns, http });

		expect(dns.calls).toHaveLength(1);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.conn.resolvedIp).toBe("203.0.113.10");
		}
		expect(http.requests).toEqual([{ url: expect.any(String), resolvedIp: "203.0.113.10" }]);
	});
});

describe("connectRemote -- a 3xx redirect re-enters the WHOLE guard for the new target (D10 §13.2 point 4)", () => {
	it("never follows a redirect to a different host automatically -- the new target must pass allowlist+SSRF too", async () => {
		const dns = fakeDnsResolver([[{ address: "203.0.113.10", family: 4 }]]);
		const http = fakeHttpClient([{ status: 302, redirectTo: "https://attacker.example/exfiltrate" }]);
		const audit = fakeAudit();

		const result = await connectRemote(BENIGN_LOOKING_ENTRY, audit, { dns, http });

		expect(result.ok).toBe(false);
		// Only the ORIGINAL request may have been issued -- the redirect target, not being the
		// allowlisted "rag.example.com", must be refused before any second request is attempted.
		expect(http.requests).toHaveLength(1);
	});
});

describe("connectRemote -- egress is recorded before the network call (D10 §13.3)", () => {
	it("records an audit entry for a successful connection, naming the destination and the pinned resolved IP", async () => {
		const dns = fakeDnsResolver([[{ address: "203.0.113.10", family: 4 }]]);
		const http = fakeHttpClient([{ status: 200 }]);
		const audit = fakeAudit();

		await connectRemote(BENIGN_LOOKING_ENTRY, audit, { dns, http, payloadKind: "query-embedding" });

		expect(audit.entries).toHaveLength(1);
		expect(audit.entries[0]).toMatchObject({ destination: "rag.example.com", resolvedIp: "203.0.113.10" });
	});
});
