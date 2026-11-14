import type { ServingCardRequestSettings } from "../../src/main/private-agent/serving-card";
/** A synthetic probe_version 2 result shaped the way scripts/serving-probe.py writes one. Invented numbers, no address anywhere. */
const h = (n: string) => n.repeat(64);

export function syntheticStream(prompt: number, completion: number, ttft: number, decode: number, extra: Record<string, unknown> = {}) {
  return { status: 200, prompt_tokens: prompt, completion_tokens: completion, cached_tokens: null, reasoning_tokens: 0, reasoning_chars: 0, reasoning_bytes: 0,
    content_chars: completion * 4, ttft_s: ttft, decode_tok_s: decode, prefill_tok_s_est: Math.round(prompt / ttft), total_s: Math.round((ttft + completion / decode) * 100) / 100,
    finish_reason: "stop", reasoning_field: "none", model_chunks: 3, model_mismatch_chunks: 0, chunks: 3, leading_think_tag: false, ...extra };
}

function p10Call(role: string, thinking: string, ordinal: number, classification: string, extra: Record<string, unknown> = {}) {
  return { ordinal, status: 200, elapsed_s: 12.5, finish_reason: classification === "truncated" ? "length" : "stop", prompt_tokens: 1200, completion_tokens: 400,
    reasoning_tokens: thinking === "on" ? 350 : 0, reasoning_field: thinking === "on" ? "reasoning_content" : "none", reasoning_bytes: thinking === "on" ? 1400 : 0,
    content_bytes: 900, content_sha256: h("a"), leading_think_tag: false, reply_file: `${role}-${thinking}-strict-${String(ordinal).padStart(2, "0")}.json`,
    body_sha256: h("b"), classification, ...extra };
}

function p10Cell(role: string, thinking: string, maxTokens: number, valid: number, other: Record<string, number>) {
  const calls: Record<string, unknown>[] = [];
  for (let i = 0; i < valid; i++) calls.push(p10Call(role, thinking, calls.length + 1, "valid"));
  for (const [classification, count] of Object.entries(other)) for (let i = 0; i < count; i++) calls.push(p10Call(role, thinking, calls.length + 1, classification));
  const counts: Record<string, unknown> = { request_rejected: 0, truncated: 0, invalid_json: 0, schema_invalid: 0, binding_invalid: 0, valid, unassessed: 0, ...other, total: calls.length,
    median_elapsed_s: 12.5, max_elapsed_s: 30.1, median_completion_tokens: 400 };
  if (thinking === "on") Object.assign(counts, { thinking_on_zero_reasoning: 0, reasoning_tokens_unreported: 0 });
  return { role, thinking, strict: true, max_tokens: maxTokens, calls, counts };
}

/**
 * The settings the role export built P10's bodies under, as P10-align records them (`request_settings`): the served alias, streaming
 * on, the legacy reply contract, the heavy profile and the cache salt (BL-20261114-1734-serving-card-request-settings-design).
 */
export const SYNTHETIC_P10_REQUEST_SETTINGS: Readonly<ServingCardRequestSettings> = Object.freeze({ model: "RM-01 VLM", streaming: true, localReplyContract: null,
  localContextTokens: null, profile: "heavy", cacheSalt: true });
export function syntheticProbe(): Record<string, any> {
  const acceptance = { strict: { status: 200, elapsed_s: 1.2, accepted: true }, non_strict: { status: 200, elapsed_s: 1.1, accepted: true } };
  const kStream = (k: number, decode: number) => ({ streams: k, errors: 0, per_stream_decode_tok_s: Array(k).fill(decode), median_decode_tok_s: decode, aggregate_tok_s: Math.round(decode * k * 0.98 * 10) / 10,
    max_ttft_s: 0.1 + k * 0.05, max_total_s: Math.round(900 / decode * 100) / 100, running_samples: [k, k, k], running_max: k });
  const jsonReply = (thinking: boolean) => ({ status: 200, elapsed_s: thinking ? 14.2 : 3.1, finish_reason: "stop", model_present: true, model_matches: true,
    reasoning_field: thinking ? "reasoning_content" : "none", reasoning_bytes: thinking ? 2100 : 0, reasoning_tokens: thinking ? 520 : 0, prompt_tokens: 40, completion_tokens: thinking ? 600 : 90,
    content_bytes: 300, content_sha256: h("f"), leading_think_tag: false });
  const sseReply = (thinking: boolean) => ({ ...syntheticStream(40, thinking ? 600 : 90, 0.13, 60, { reasoning_tokens: thinking ? 500 : 0, reasoning_field: thinking ? "reasoning_content" : "none", reasoning_bytes: thinking ? 2000 : 0 }),
    content_sha256: h("f"), content_bytes: 300 });
  return {
    probe_version: 2, started_utc: "2026-11-08T09:15:00+00:00", finished_utc: "2026-11-08T11:02:10+00:00", run_id: "serving-probe-2026-11-08T091500+0000",
    transport_class: "loopback", cost_policy: "local_zero_cost", api_key_configured: false, model_source: "env",
    probes_selected: ["P1", "P2", "P3", "P4", "P5", "P6", "P7", "P9", "P10", "P11", "adapter"],
    probes_run: ["P1", "P2", "P3", "P4", "P5", "P7", "P9", "P10", "P11", "adapter"], probes_skipped: ["P8"], probes_failed: { P6: "URLError" },
    roles: { output_tokens: { index: 1536, plan: 8192, extract: 2048, synthesis: 8192 }, thinking: { index: "disabled", plan: "model", extract: "disabled", synthesis: "model" }, protocol_sha256: h("c") },
    load_before: { running: 0, waiting: 0 }, load_after: { running: 1, waiting: 0 }, spec_decode_acceptance_during_probe: 0.73,
    P1: { models_status: 200, auth_required: false, models: [{ id: "RM-01 VLM", root_basename: "Qwen3.8-Flash-Next-NVFP4", max_model_len: 262144 }], version_status: 200, version: "0.33.0rc1.dev617+g821038729" },
    P2: { kwargs_low: syntheticStream(40, 600, 0.13, 61, { reasoning_tokens: 520 }), kwargs_medium: syntheticStream(40, 700, 0.13, 62, { reasoning_tokens: 640 }),
      kwargs_xhigh: syntheticStream(40, 900, 0.14, 60, { reasoning_tokens: 850 }), toplevel_medium_as_SOAR_sends: syntheticStream(40, 690, 0.13, 61, { reasoning_tokens: 630 }), thinking_disabled: syntheticStream(40, 90, 0.12, 36) },
    P3: { prose_no_think: syntheticStream(30, 1400, 0.13, 35.2), code_no_think: syntheticStream(40, 2200, 0.14, 58), long_context_no_think: syntheticStream(47299, 300, 26.4, 35) },
    P4: { repeat_same_long_prompt: syntheticStream(47299, 300, 1.85, 35.1, { cached_tokens: 44800 }) },
    P5: { status: 200, elapsed_s: 79.7, payload_bytes: 11124, finish_reason: "tool_calls", tool_calls: 1, args_parse: true, content_exact: true, content_len_ratio: 1 },
    P7: { single: syntheticStream(30, 900, 0.13, 35), concurrent: { s0: syntheticStream(30, 900, 0.2, 34.8), s1: syntheticStream(30, 900, 0.21, 35.1) } },
    P9: { status: 400, elapsed_s: 0.04, error_bytes: 180, error_sha256: h("d"), requested_max_tokens: 262144, rejected: true },
    P10: { calls_per_cell: 20, strict_requested: true, reasoning_stripped: false, request_settings: { ...SYNTHETIC_P10_REQUEST_SETTINGS }, schemas_protocol_sha256: h("c"), schema_sha256: { plan: h("1"), extract: h("2"), synthesis: h("3") },
      binding: { units: ["U1", "U2", "U3"], sourceIds: ["input/corpus/alpha.md", "input/corpus/beta.md"] }, acceptance: { plan: acceptance, extract: acceptance, synthesis: acceptance },
      cells: { "plan/on": p10Cell("plan", "on", 8192, 19, { truncated: 1 }), "plan/off": p10Cell("plan", "off", 8192, 17, { schema_invalid: 2, binding_invalid: 1 }),
        "extract/on": p10Cell("extract", "on", 2048, 20, {}), "extract/off": p10Cell("extract", "off", 2048, 20, {}),
        "synthesis/on": p10Cell("synthesis", "on", 8192, 18, { truncated: 2 }), "synthesis/off": p10Cell("synthesis", "off", 8192, 19, { invalid_json: 1 }) },
      assessed: { version: 1, assessedUtc: "2026-11-08T11:05:00.123Z", protocolSha256: h("c"), schemasProtocolMatch: true, assessor: "scripts/assess-probe-replies.ts" } },
    P11: { tokens_per_word_assumed: 1.245, max_model_len: 262144, max_tokens: 300, sizes_refused: [],
      sizes: { "20000": { ...syntheticStream(20010, 300, 9.8, 36), target_tokens: 20000, words: 16064, tokens_per_word_observed: 1.2457 },
        "60000": { ...syntheticStream(60100, 300, 31.2, 34.1), target_tokens: 60000, words: 48193, tokens_per_word_observed: 1.2471 },
        "120000": { ...syntheticStream(119800, 300, 66, 31.5), target_tokens: 120000, words: 96386, tokens_per_word_observed: 1.2429 } },
      cache_layouts: { packet_sha256: h("7"), packet_bytes: 20480, chunk_sha256: [h("8"), h("9")], chunk_bytes: [65536, 65536],
        layouts: { sorted_keys: { requests: [{ request: 1, status: 200, prompt_tokens: 21000, cached_tokens: 0, ttft_s: 10.1, total_s: 12 }, { request: 2, status: 200, prompt_tokens: 21010, cached_tokens: 256, ttft_s: 9.9, total_s: 12 }], cache_salt_accepted: true, second_request_cached_tokens: 256 },
          stable_prefix: { requests: [{ request: 1, status: 200, prompt_tokens: 21000, cached_tokens: 0, ttft_s: 10.2, total_s: 12 }, { request: 2, status: 200, prompt_tokens: 21010, cached_tokens: 5120, ttft_s: 7.6, total_s: 9.5 }], cache_salt_accepted: true, second_request_cached_tokens: 5120 } } },
      k_streams: { "1": kStream(1, 35), "2": kStream(2, 34.8), "4": kStream(4, 33.9), "8": kStream(8, 30.2) } },
    adapter: { openapi: { status: 200, schema_sha256: h("e"), version: "0.33.0rc1.dev617+g821038729", tokenize_route: true, chat_request_fields: { response_format: true, chat_template_kwargs: true, cache_salt: true } },
      tokenize: { status: 200, elapsed_s: 0.05, count: 23, chat_status: 200, usage_prompt_tokens: 23, parity: true },
      thinking_on_json: jsonReply(true), thinking_on_sse: sseReply(true), thinking_off_json: jsonReply(false), thinking_off_sse: sseReply(false),
      preserve_thinking: { accepted: true }, cache_salt: { status: 200, elapsed_s: 0.3, accepted: true },
      verdict: { legacy_consistent: true, flash_next_v1_consistent: true, checks: { settled: true, model_in_replies: true, no_leading_think_tag: true, no_reasoning_under_thinking_off: true, one_reasoning_field: true, preserve_thinking_accepted: true },
        note: "consistency of a few synthetic replies; it does not establish the contract" } },
  };
}
