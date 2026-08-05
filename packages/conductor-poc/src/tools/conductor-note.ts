import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

/**
 * Fase-0 custom-tool PoC (plano_desenvolvimento.md §8 entregável 4; gate8-validation.md §3 row 4 —
 * "no Fase-1 cover story available", queued by §7 as the second backfill item of this
 * continuation).
 *
 * Deliberately trivial: appends a short note to an in-memory list and returns a confirmation. No
 * real journal/library wiring — that is Fase 6 (see docs/conductor/pi-conductor-feature-matrix.md,
 * row 12: "Custom tools — mechanism yes, tools no").
 *
 * Registered via the SDK-level `customTools` option of createAgentSession() (recon
 * `_recon-pi-architecture.md` §3 point 1; `packages/coding-agent/docs/sdk.md:565-597`), wired
 * through src/session.ts's createConductorSession(). Deliberately does NOT get any special
 * treatment from the permission-gate's default routing: see src/permission-gate.ts's explicit
 * "conductor_note" branch, which requires the same ctx.ui.confirm() approval as write/edit/bash —
 * proving a custom tool is not implicitly trusted just because it isn't one of the four built-ins
 * (test/permission-gate.test.ts's "unrelated custom tool" test proves the inverse: a custom tool
 * WITHOUT a declared policy still falls through to the fail-closed default).
 */

export interface ConductorNoteRecord {
	note: string;
	/** ISO-8601 UTC timestamp of when the note was recorded (observability, matches the
	 * permission-gate's own PermissionGateDecision.timestamp convention). */
	timestamp: string;
}

export interface ConductorNoteParams {
	note: string;
}

export interface ConductorNoteToolHandle {
	/**
	 * Bare `ToolDefinition` (not the specific `ToolDefinition<typeof conductorNoteParamsSchema,
	 * ConductorNoteRecord>` instantiation) deliberately: defineTool()'s actual return type is that
	 * specific instantiation intersected with `AnyToolDefinition` (`ToolDefinition<any, any, any>`,
	 * see its doc comment in coding-agent's extensions/types.ts) precisely so the result can be
	 * assigned into a `ToolDefinition[]` array — such as `customTools` below and in session.ts —
	 * without a structural-variance error on `renderCall`/`renderResult`'s parameter types.
	 * Re-declaring the specific instantiation here would discard that widening and reintroduce the
	 * error (caught by `npm run check`'s `tsgo --noEmit` during this backfill).
	 */
	tool: ToolDefinition;
	/** Notes recorded so far, in call order. A live reference — callers read it after driving a
	 * session, they do not need to re-fetch it. */
	notes: ConductorNoteRecord[];
}

/** Defensive upper bound so a single tool call cannot record unbounded input (quality-baseline
 * category 1, input validation: type/length/format/range on every external input). */
const MAX_NOTE_LENGTH = 500;

const conductorNoteParamsSchema = Type.Object({
	note: Type.String({
		description: "Short note text to record (Fase 0 PoC — in-memory only, no persistence).",
		minLength: 1,
		maxLength: MAX_NOTE_LENGTH,
	}),
});

/**
 * Create a fresh `conductor_note` tool bound to its own in-memory notes list. Each call returns an
 * independent handle — tests and callers must not share one across unrelated sessions.
 */
export function createConductorNoteTool(): ConductorNoteToolHandle {
	const notes: ConductorNoteRecord[] = [];

	const tool = defineTool({
		name: "conductor_note",
		label: "Conductor Note",
		description:
			"Append a short note to Conductor's in-memory note list for this session. Fase-0 proof-of-concept " +
			"only — no real journal/library wiring.",
		parameters: conductorNoteParamsSchema,
		execute: async (_toolCallId, params) => {
			// Input validation (quality-baseline category 1): the JSON schema advertised to the model
			// (`parameters` above) is not documented as an enforced runtime guard ahead of execute()
			// (recon §3 — no schema-validation step is described between tool-call parsing and
			// execute()), so this tool validates its own input defensively, the same posture
			// workspace-policy.ts/permission-gate.ts already take for every tool argument they see.
			const rawNote = (params as ConductorNoteParams).note;
			if (typeof rawNote !== "string") {
				throw new Error("conductor_note: 'note' must be a string");
			}
			const trimmed = rawNote.trim();
			if (trimmed.length === 0) {
				throw new Error("conductor_note: 'note' must not be empty");
			}
			if (trimmed.length > MAX_NOTE_LENGTH) {
				throw new Error(`conductor_note: 'note' must be at most ${MAX_NOTE_LENGTH} characters`);
			}

			const record: ConductorNoteRecord = { note: trimmed, timestamp: new Date().toISOString() };
			notes.push(record);

			return {
				content: [{ type: "text", text: `Recorded note: "${trimmed}"` }],
				details: record,
			};
		},
	});

	return { tool, notes };
}
