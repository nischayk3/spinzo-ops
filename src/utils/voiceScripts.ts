export interface VoicePromptParams {
  kind: 'pickup' | 'delivery' | 'helper_assignment' | 'nudge' | 'idle_alert' | 'new_order';
  step?: string;
  phase?: string;
  tokenNumber?: unknown;
  tokensMap?: Record<string, unknown> | null;
  isExpress?: boolean;
  locality?: string;
}

const LATIN_TO_DEVANAGARI: Record<string, string> = {
  A: 'ए',
  B: 'बी',
  C: 'सी',
  D: 'डी',
  E: 'ई',
  F: 'एफ',
  G: 'जी',
  H: 'एच',
  I: 'आई',
  J: 'जे',
  K: 'के',
  L: 'एल',
  M: 'एम',
  N: 'एन',
  O: 'ओ',
  P: 'पी',
  Q: 'क्यू',
  R: 'आर',
  S: 'एस',
  T: 'टी',
  U: 'यू',
  V: 'वी',
  W: 'डब्ल्यू',
  X: 'एक्स',
  Y: 'वाई',
  Z: 'ज़ेड',
};

const VALID_TOKEN_PATTERN =
  /^(?:[A-Za-z]{1,2}-?\d{1,5}[A-Za-z]?|\d{1,5}(?:-?[A-Za-z]{1,2}\d{0,5})?(?:-[A-Za-z0-9]{1,2})?)$/;

function cleanSingleToken(raw: unknown): string {
  if (raw === null || raw === undefined) return '';
  if (typeof raw !== 'string' && typeof raw !== 'number') return '';
  if (typeof raw === 'number' && !Number.isFinite(raw)) return '';

  const str = String(raw)
    .trim()
    .replace(/^[#\s]+/, '')
    .replace(/^token(?:\s*(?:no\.?|number|#|:|-))?\s*/i, '')
    .replace(/^[#\s]+/, '')
    .replace(/^t[-\s]+/i, '')
    .replace(/^[#\s]+/, '')
    .trim();

  if (!str) return '';
  // Reject random Firestore IDs / order IDs / non-token text
  if (str.length > 8 || !/\d/.test(str)) return '';
  if (/^(?:ORD|ORDER)/i.test(str)) return '';
  if (/[A-Za-z]{3,}/.test(str)) return '';
  if (!VALID_TOKEN_PATTERN.test(str)) return '';

  return str.toUpperCase();
}

function splitAndCleanTokens(raw: unknown): string[] {
  if (raw === null || raw === undefined) return [];
  if (typeof raw === 'number') {
    const cleaned = cleanSingleToken(raw);
    return cleaned ? [cleaned] : [];
  }
  if (typeof raw !== 'string') return [];

  const parts = raw.split(/\s*(?:[,;/&]|और)\s*/);
  const results: string[] = [];
  for (const part of parts) {
    const cleaned = cleanSingleToken(part);
    if (cleaned) results.push(cleaned);
  }
  return results;
}

function dedupeTokens(tokens: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const tok of tokens) {
    const key = tok.toUpperCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(tok);
    }
  }
  return out;
}

export function extractCleanTokens(
  rawToken?: unknown,
  tokensMap?: Record<string, unknown> | null
): string[] {
  const direct = dedupeTokens(splitAndCleanTokens(rawToken));
  if (direct.length > 0) return direct;

  if (tokensMap && typeof tokensMap === 'object') {
    const collected: string[] = [];
    for (const val of Object.values(tokensMap)) {
      collected.push(...splitAndCleanTokens(val));
    }
    return dedupeTokens(collected);
  }

  return [];
}

export function extractCleanTokenNumber(
  rawToken?: unknown,
  tokensMap?: Record<string, unknown> | null
): string {
  return extractCleanTokens(rawToken, tokensMap).join(', ');
}

export function formatTokenForHindiSpeech(token: string): string {
  if (!token) return '';
  const upper = token.trim().toUpperCase();
  if (!upper) return '';

  const segments = upper.match(/\d+|[A-Z]/g);
  if (!segments || segments.length === 0) return '';

  return segments.map((seg) => LATIN_TO_DEVANAGARI[seg] ?? seg).join(' ');
}

export function formatTokensForHindiSpeech(tokens: string[]): string {
  const formatted = tokens.map(formatTokenForHindiSpeech).filter(Boolean);
  if (formatted.length === 0) return '';
  if (formatted.length === 1) return formatted[0];
  if (formatted.length === 2) return `${formatted[0]} और ${formatted[1]}`;
  return `${formatted.slice(0, -1).join(', ')} और ${formatted[formatted.length - 1]}`;
}

export function buildHindiVoicePrompt(params: VoicePromptParams): string {
  const tokens = extractCleanTokens(params.tokenNumber, params.tokensMap);
  const spoken = formatTokensForHindiSpeech(tokens);

  switch (params.kind) {
    case 'new_order':
      return 'नया ऑर्डर आया है';

    case 'pickup': {
      const base = params.isExpress ? 'एक्सप्रेस पिकअप आया है' : 'नया पिकअप आया है';
      const loc = typeof params.locality === 'string' ? params.locality.trim() : '';
      const locUpper = loc.toUpperCase();
      if (loc && loc.length <= 25 && locUpper !== 'LOCAL' && locUpper !== 'STORE') {
        return `${base}, ${loc}`;
      }
      return base;
    }

    case 'delivery':
      if (spoken) {
        return `टोकन ${spoken} की डिलीवरी के लिए जाना है`;
      }
      return params.isExpress ? 'एक्सप्रेस डिलीवरी के लिए जाना है' : 'नई डिलीवरी आई है';

    case 'idle_alert':
      return params.step === 'getting_dried'
        ? 'ड्रायर खाली है, कपड़े डालिए'
        : 'वॉशर खाली है, कपड़े डालिए';

    case 'nudge': {
      if (params.phase === 'detergent') {
        return spoken ? `टोकन ${spoken} में डिटर्जेंट डालिए` : 'वॉशर में डिटर्जेंट डालिए';
      }
      if (params.phase === 'softener') {
        return spoken ? `टोकन ${spoken} में सॉफ्टनर डालिए` : 'वॉशर में सॉफ्टनर डालिए';
      }
      if (params.step === 'getting_washed' && params.phase === 'accepted') {
        return spoken ? `टोकन ${spoken} का वॉशर चालू करिए` : 'वॉशर चालू करिए';
      }
      if (params.step === 'getting_washed' && params.phase === 'started') {
        return spoken ? `टोकन ${spoken} को वॉशर से निकालिए` : 'वॉशर से कपड़े निकालिए';
      }
      if (params.step === 'getting_dried' && params.phase === 'accepted') {
        return spoken ? `टोकन ${spoken} का ड्रायर चालू करिए` : 'ड्रायर चालू करिए';
      }
      if (params.step === 'getting_dried' && params.phase === 'started') {
        return spoken ? `टोकन ${spoken} को ड्रायर से निकालिए` : 'ड्रायर से कपड़े निकालिए';
      }
      if (params.step === 'tagging') {
        return spoken ? `टोकन ${spoken} की टैगिंग जल्दी पूरी करिए` : 'टैगिंग जल्दी पूरी करिए';
      }
      if (params.step === 'packaging') {
        return spoken ? `टोकन ${spoken} की पैकेजिंग जल्दी पूरी करिए` : 'पैकेजिंग जल्दी पूरी करिए';
      }
      return spoken ? `टोकन ${spoken} का नया काम आया है` : 'नया काम आया है';
    }

    case 'helper_assignment': {
      if (params.step === 'tagging') {
        return spoken ? `टोकन ${spoken} की टैगिंग करनी है` : 'टैगिंग करनी है';
      }
      if (params.step === 'getting_washed') {
        return spoken ? `टोकन ${spoken} को वॉशर में डालिए` : 'कपड़े वॉशर में डालिए';
      }
      if (params.step === 'getting_dried') {
        return spoken ? `टोकन ${spoken} को ड्रायर में डालिए` : 'कपड़े ड्रायर में डालिए';
      }
      if (params.step === 'getting_ironed') {
        return spoken ? `टोकन ${spoken} का नया आयरनिंग का ऑर्डर आया है` : 'नया आयरनिंग का ऑर्डर आया है';
      }
      if (params.step === 'packaging') {
        return spoken ? `टोकन ${spoken} की पैकेजिंग करनी है` : 'पैकेजिंग करनी है';
      }
      return spoken ? `टोकन ${spoken} का नया काम आया है` : 'नया काम आया है';
    }
  }
}
