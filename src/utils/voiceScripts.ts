export interface VoicePromptParams {
  kind: 'pickup' | 'delivery' | 'helper_assignment' | 'nudge' | 'idle_alert' | 'new_order';
  step?: string;
  phase?: string;
  tokenNumber?: unknown;
  tokensMap?: Record<string, unknown> | null;
  isExpress?: boolean;
  locality?: string;
}

function cleanSingleToken(raw: unknown): string {
  if (raw === null || raw === undefined) return '';
  if (typeof raw !== 'string' && typeof raw !== 'number') return '';
  if (typeof raw === 'number' && !Number.isFinite(raw)) return '';

  const str = String(raw)
    .trim()
    .replace(/^[#\s]+/, '')
    .replace(/^t-/i, '')
    .replace(/^[#\s]+/, '')
    .trim();

  if (!str) return '';
  // Reject long random alphanumeric Firestore IDs (>8 chars) or strings lacking digits
  if (str.length > 8 || !/\d/.test(str)) return '';

  return str;
}

export function extractCleanTokenNumber(
  rawToken?: unknown,
  tokensMap?: Record<string, unknown> | null
): string {
  const direct = cleanSingleToken(rawToken);
  if (direct) return direct;

  if (tokensMap && typeof tokensMap === 'object') {
    for (const val of Object.values(tokensMap)) {
      const candidate = cleanSingleToken(val);
      if (candidate) return candidate;
    }
  }

  return '';
}

export function buildHindiVoicePrompt(params: VoicePromptParams): string {
  const tok = extractCleanTokenNumber(params.tokenNumber, params.tokensMap);
  const prefix = tok ? `टोकन नंबर ${tok}, ` : '';

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
      if (tok) {
        return `टोकन नंबर ${tok}, डिलीवरी के लिए जाना है`;
      }
      return params.isExpress ? 'एक्सप्रेस डिलीवरी के लिए जाना है' : 'नई डिलीवरी आई है';

    case 'idle_alert':
      return params.step === 'getting_dried'
        ? 'ड्रायर खाली है, कपड़े डालिए'
        : 'वॉशर खाली है, कपड़े डालिए';

    case 'nudge': {
      if (params.phase === 'detergent') return `${prefix}डिटर्जेंट डालिए`;
      if (params.phase === 'softener') return `${prefix}सॉफ्टनर डालिए`;
      if (params.step === 'getting_washed' && params.phase === 'accepted') {
        return `${prefix}वॉशर चालू करिए`;
      }
      if (params.step === 'getting_washed' && params.phase === 'started') {
        return `${prefix}वॉशर से निकालिए`;
      }
      if (params.step === 'getting_dried' && params.phase === 'accepted') {
        return `${prefix}ड्रायर चालू करिए`;
      }
      if (params.step === 'getting_dried' && params.phase === 'started') {
        return `${prefix}ड्रायर से निकालिए`;
      }
      if (params.step === 'tagging') return `${prefix}टैगिंग जल्दी पूरी करिए`;
      if (params.step === 'packaging') return `${prefix}पैकेजिंग जल्दी पूरी करिए`;
      return `${prefix}नया काम आया है`;
    }

    case 'helper_assignment': {
      if (params.step === 'tagging') return `${prefix}टैगिंग करनी है`;
      if (params.step === 'getting_washed') return `${prefix}वॉशर में डालिए`;
      if (params.step === 'getting_dried') return `${prefix}ड्रायर में डालिए`;
      if (params.step === 'getting_ironed') return `${prefix}आयरन करना है`;
      if (params.step === 'packaging') return `${prefix}पैकेजिंग करनी है`;
      return `${prefix}नया काम आया है`;
    }
  }
}
