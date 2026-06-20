/**
 * Frontend input sanitization — blocks obvious prompt-injection / jailbreak
 * attempts before they reach the backend. This is defense-in-depth (the backend
 * + LLM still have their own guardrails); the goal is early-return on the client
 * so malicious/noise input doesn't even trigger a search.
 *
 * NOTE: heuristic by nature. Tuned to avoid blocking normal Indonesian kos
 * queries while catching common injection patterns (morse, encoded blobs,
 * instruction-override phrases, markup, invisible characters).
 */

export interface ValidationResult {
  ok: boolean;
  reason?: string;
}

export const MAX_QUERY_LEN = 500;

// Phrases that strongly indicate an injection attempt. Kept specific to avoid
// false positives on ordinary queries.
const JAILBREAK_PHRASES = [
  "ignore previous",
  "ignore all previous",
  "ignore the above",
  "ignore your instructions",
  "ignore your system",
  "disregard previous",
  "forget your instructions",
  "override previous",
  "override your instructions",
  "override your system",
  "new instructions:",
  "you are now",
  "pretend you are",
  "act as if you",
  "from now on you are",
  "jailbreak",
  "do anything now",
  "dan mode",
  "system prompt",
  "system instruction",
  "reveal your instructions",
  "show your instructions",
  "repeat your instructions",
  "developer mode",
  "unfiltered mode",
  "no restrictions",
];

// Invisible / control characters (zero-width spaces, BOM, control chars).
const CONTROL_CHARS =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u0080-\u009F\u200B-\u200F\u2028-\u202F\u2060-\u206F\uFEFF]/;

// Looks like morse code: only dots, dashes and spaces.
const MORSE = /^[.\-][.\-\s]+[.\-]$/;

// HTML/script injection.
const MARKUP = /<\s*(script|img|iframe|svg|object|embed)|javascript:|on(error|load|click|mouse)\s*=/i;

// Long base64-ish blob.
const BASE64_BLOB = /[A-Za-z0-9+/=]{60,}/;

export function validateQuery(raw: string): ValidationResult {
  const s = (raw || "").trim();
  if (!s) return { ok: false, reason: "Pesan tidak boleh kosong." };
  if (s.length > MAX_QUERY_LEN)
    return { ok: false, reason: `Pesan terlalu panjang (maks ${MAX_QUERY_LEN} karakter).` };

  if (CONTROL_CHARS.test(s))
    return { ok: false, reason: "Pesan mengandung karakter terlarang (karakter kontrol/invisibel)." };

  if (MARKUP.test(s))
    return { ok: false, reason: "Pesan mengandung markup/HTML yang tidak diperbolehkan." };

  if (MORSE.test(s))
    return { ok: false, reason: "Pesan terdeteksi sebagai sandi/kode morse." };

  const lower = s.toLowerCase();
  for (const p of JAILBREAK_PHRASES) {
    if (lower.includes(p))
      return {
        ok: false,
        reason: `Pesan terdeteksi sebagai upaya prompt injection ("${p}").`,
      };
  }

  if (BASE64_BLOB.test(s))
    return { ok: false, reason: "Pesan mengandung blob terenkode (base64) yang mencurigakan." };

  // Abnormal symbol ratio (ignore common punctuation + alphanumerics).
  const stripped = s.replace(/[A-Za-z0-9\s.,!?'"()\-/+@:%&]/g, "");
  if (s.length > 20 && stripped.length / s.length > 0.5) {
    return { ok: false, reason: "Pesan mengandung terlalu banyak simbol/karakter aneh." };
  }

  return { ok: true };
}
