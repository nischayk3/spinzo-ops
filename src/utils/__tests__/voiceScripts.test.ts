import { describe, it, expect } from 'vitest';
import {
  extractCleanTokens,
  extractCleanTokenNumber,
  formatTokenForHindiSpeech,
  formatTokensForHindiSpeech,
  buildHindiVoicePrompt,
} from '../voiceScripts';

describe('extractCleanTokens & extractCleanTokenNumber', () => {
  it('strips leading T-, t-, #, Token, Token #, and whitespace while preserving series letters', () => {
    expect(extractCleanTokenNumber('T-42')).toBe('42');
    expect(extractCleanTokenNumber('t-108')).toBe('108');
    expect(extractCleanTokenNumber('#75')).toBe('75');
    expect(extractCleanTokenNumber('Token #23')).toBe('23');
    expect(extractCleanTokenNumber('token 42')).toBe('42');
    expect(extractCleanTokenNumber('  #T-99  ')).toBe('99');
    expect(extractCleanTokenNumber('T108')).toBe('T108');
    expect(extractCleanTokenNumber(25)).toBe('25');
  });

  it('accepts alphanumeric and hyphenated store token formats and normalizes to uppercase', () => {
    expect(extractCleanTokens('108')).toEqual(['108']);
    expect(extractCleanTokens('03')).toEqual(['03']);
    expect(extractCleanTokens('b102')).toEqual(['B102']);
    expect(extractCleanTokens('B-102')).toEqual(['B-102']);
    expect(extractCleanTokens('p98')).toEqual(['P98']);
    expect(extractCleanTokens('P108')).toEqual(['P108']);
    expect(extractCleanTokens('A108')).toEqual(['A108']);
    expect(extractCleanTokens('1a')).toEqual(['1A']);
    expect(extractCleanTokens('39a')).toEqual(['39A']);
    expect(extractCleanTokens('39-1')).toEqual(['39-1']);
    expect(extractCleanTokens('1b108')).toEqual(['1B108']);
    expect(extractCleanTokens('2a45')).toEqual(['2A45']);
  });

  it('splits multi-token strings and deduplicates case-insensitively preserving order', () => {
    expect(extractCleanTokens('1A, B102')).toEqual(['1A', 'B102']);
    expect(extractCleanTokenNumber('1A, B102')).toBe('1A, B102');
    expect(extractCleanTokens('23, 24, 23')).toEqual(['23', '24']);
    expect(extractCleanTokens('b102 / P108; B102 & 1a और P98')).toEqual(['B102', 'P108', '1A', 'P98']);
  });

  it('rejects random Firestore order IDs, ORD prefixes, 3+ letter prefixes, and non-digit strings', () => {
    expect(extractCleanTokenNumber('xK9mPq2Lw8ZvRt3N')).toBe('');
    expect(extractCleanTokenNumber('aBcDeFg123456')).toBe('');
    expect(extractCleanTokenNumber('ORD123456789')).toBe('');
    expect(extractCleanTokenNumber('ORD9999')).toBe('');
    expect(extractCleanTokenNumber('order123')).toBe('');
    expect(extractCleanTokenNumber('abc12345')).toBe('');
    expect(extractCleanTokenNumber('ABCDEF')).toBe('');
    expect(extractCleanTokenNumber('pickup')).toBe('');
    expect(extractCleanTokenNumber('local')).toBe('');
    expect(extractCleanTokenNumber('   ')).toBe('');
    expect(extractCleanTokenNumber(null)).toBe('');
    expect(extractCleanTokenNumber(undefined)).toBe('');
  });

  it('falls back to deduplicated tokensMap values when rawToken is empty or invalid', () => {
    expect(extractCleanTokenNumber('', { wash: 'T-14' })).toBe('14');
    expect(extractCleanTokenNumber('xK9mPq2Lw8ZvRt3N', { a: 'INVALID', b: '#203' })).toBe('203');
    expect(extractCleanTokenNumber(undefined, { a: 'longfirestoreid12345' })).toBe('');
    expect(
      extractCleanTokens(undefined, {
        wash_fold__L1: '23',
        wash_fold__L2: '24',
        wash_fold: '23, 24',
      })
    ).toEqual(['23', '24']);
    expect(
      extractCleanTokens('', {
        iron__L1: '1a',
        wash__L1: 'b102',
        all: '1A, B102',
      })
    ).toEqual(['1A', 'B102']);
  });
});

describe('formatTokenForHindiSpeech & formatTokensForHindiSpeech', () => {
  it('converts Latin letters to natural Devanagari phonetics while keeping numbers intact', () => {
    expect(formatTokenForHindiSpeech('108')).toBe('108');
    expect(formatTokenForHindiSpeech('B102')).toBe('बी 102');
    expect(formatTokenForHindiSpeech('1A')).toBe('1 ए');
    expect(formatTokenForHindiSpeech('1B108')).toBe('1 बी 108');
    expect(formatTokenForHindiSpeech('P98')).toBe('पी 98');
    expect(formatTokenForHindiSpeech('P108')).toBe('पी 108');
    expect(formatTokenForHindiSpeech('B-102')).toBe('बी 102');
    expect(formatTokenForHindiSpeech('AB12')).toBe('ए बी 12');
    expect(formatTokenForHindiSpeech('')).toBe('');
  });

  it('joins 0, 1, 2, and 3+ tokens naturally in Hindi', () => {
    expect(formatTokensForHindiSpeech([])).toBe('');
    expect(formatTokensForHindiSpeech(['B102'])).toBe('बी 102');
    expect(formatTokensForHindiSpeech(['1A', 'B102'])).toBe('1 ए और बी 102');
    expect(formatTokensForHindiSpeech(['1A', 'B102', 'P108'])).toBe('1 ए, बी 102 और पी 108');
  });
});

describe('buildHindiVoicePrompt', () => {
  it('builds new_order prompt', () => {
    expect(buildHindiVoicePrompt({ kind: 'new_order' })).toBe('नया ऑर्डर आया है');
  });

  it('builds pickup prompts for normal, express, and locality filtering', () => {
    expect(buildHindiVoicePrompt({ kind: 'pickup' })).toBe('नया पिकअप आया है');
    expect(buildHindiVoicePrompt({ kind: 'pickup', isExpress: true })).toBe('एक्सप्रेस पिकअप आया है');
    expect(buildHindiVoicePrompt({ kind: 'pickup', locality: 'Indiranagar' })).toBe(
      'नया पिकअप आया है, Indiranagar'
    );
    expect(buildHindiVoicePrompt({ kind: 'pickup', isExpress: true, locality: 'Koramangala' })).toBe(
      'एक्सप्रेस पिकअप आया है, Koramangala'
    );
    // Ignores LOCAL, STORE, and long localities (>25 chars)
    expect(buildHindiVoicePrompt({ kind: 'pickup', locality: 'LOCAL' })).toBe('नया पिकअप आया है');
    expect(buildHindiVoicePrompt({ kind: 'pickup', locality: 'store' })).toBe('नया पिकअप आया है');
    expect(
      buildHindiVoicePrompt({
        kind: 'pickup',
        locality: 'Very Long Full Street Address Beyond Twenty Five Characters',
      })
    ).toBe('नया पिकअप आया है');
  });

  it('builds delivery prompts with single, alphanumeric, multi-token, and fallback cases', () => {
    expect(buildHindiVoicePrompt({ kind: 'delivery', tokenNumber: 'T-55' })).toBe(
      'टोकन 55 की डिलीवरी के लिए जाना है'
    );
    expect(buildHindiVoicePrompt({ kind: 'delivery', tokenNumber: 'B102' })).toBe(
      'टोकन बी 102 की डिलीवरी के लिए जाना है'
    );
    expect(buildHindiVoicePrompt({ kind: 'delivery', tokenNumber: '1A, B102' })).toBe(
      'टोकन 1 ए और बी 102 की डिलीवरी के लिए जाना है'
    );
    expect(
      buildHindiVoicePrompt({
        kind: 'delivery',
        tokensMap: { wash_fold__L1: 'P98', wash_fold__L2: 'P108', wash_fold: 'P98, P108' },
      })
    ).toBe('टोकन पी 98 और पी 108 की डिलीवरी के लिए जाना है');
    expect(buildHindiVoicePrompt({ kind: 'delivery', tokenNumber: 'longFirestoreId99999' })).toBe(
      'नई डिलीवरी आई है'
    );
    expect(buildHindiVoicePrompt({ kind: 'delivery', isExpress: true })).toBe(
      'एक्सप्रेस डिलीवरी के लिए जाना है'
    );
  });

  it('builds idle_alert prompts for washer and dryer', () => {
    expect(buildHindiVoicePrompt({ kind: 'idle_alert', step: 'getting_washed' })).toBe(
      'वॉशर खाली है, कपड़े डालिए'
    );
    expect(buildHindiVoicePrompt({ kind: 'idle_alert', step: 'getting_dried' })).toBe(
      'ड्रायर खाली है, कपड़े डालिए'
    );
    expect(buildHindiVoicePrompt({ kind: 'idle_alert' })).toBe('वॉशर खाली है, कपड़े डालिए');
  });

  it('builds all nudge prompts with and without token', () => {
    expect(buildHindiVoicePrompt({ kind: 'nudge', phase: 'detergent', tokenNumber: 'T-12' })).toBe(
      'टोकन 12 में डिटर्जेंट डालिए'
    );
    expect(buildHindiVoicePrompt({ kind: 'nudge', phase: 'detergent' })).toBe(
      'वॉशर में डिटर्जेंट डालिए'
    );
    expect(buildHindiVoicePrompt({ kind: 'nudge', phase: 'softener', tokenNumber: 'B102' })).toBe(
      'टोकन बी 102 में सॉफ्टनर डालिए'
    );
    expect(buildHindiVoicePrompt({ kind: 'nudge', phase: 'softener' })).toBe(
      'वॉशर में सॉफ्टनर डालिए'
    );
    expect(
      buildHindiVoicePrompt({ kind: 'nudge', step: 'getting_washed', phase: 'accepted', tokenNumber: '1B108' })
    ).toBe('टोकन 1 बी 108 का वॉशर चालू करिए');
    expect(
      buildHindiVoicePrompt({ kind: 'nudge', step: 'getting_washed', phase: 'accepted' })
    ).toBe('वॉशर चालू करिए');
    expect(
      buildHindiVoicePrompt({ kind: 'nudge', step: 'getting_washed', phase: 'started', tokenNumber: '7' })
    ).toBe('टोकन 7 को वॉशर से निकालिए');
    expect(
      buildHindiVoicePrompt({ kind: 'nudge', step: 'getting_washed', phase: 'started' })
    ).toBe('वॉशर से कपड़े निकालिए');
    expect(
      buildHindiVoicePrompt({ kind: 'nudge', step: 'getting_dried', phase: 'accepted', tokenNumber: 'P98' })
    ).toBe('टोकन पी 98 का ड्रायर चालू करिए');
    expect(
      buildHindiVoicePrompt({ kind: 'nudge', step: 'getting_dried', phase: 'accepted' })
    ).toBe('ड्रायर चालू करिए');
    expect(
      buildHindiVoicePrompt({ kind: 'nudge', step: 'getting_dried', phase: 'started', tokenNumber: '8' })
    ).toBe('टोकन 8 को ड्रायर से निकालिए');
    expect(
      buildHindiVoicePrompt({ kind: 'nudge', step: 'getting_dried', phase: 'started' })
    ).toBe('ड्रायर से कपड़े निकालिए');
    expect(buildHindiVoicePrompt({ kind: 'nudge', step: 'tagging', tokenNumber: 'T-3' })).toBe(
      'टोकन 3 की टैगिंग जल्दी पूरी करिए'
    );
    expect(buildHindiVoicePrompt({ kind: 'nudge', step: 'tagging' })).toBe(
      'टैगिंग जल्दी पूरी करिए'
    );
    expect(buildHindiVoicePrompt({ kind: 'nudge', step: 'packaging', tokenNumber: '1A' })).toBe(
      'टोकन 1 ए की पैकेजिंग जल्दी पूरी करिए'
    );
    expect(buildHindiVoicePrompt({ kind: 'nudge', step: 'packaging' })).toBe(
      'पैकेजिंग जल्दी पूरी करिए'
    );
    expect(buildHindiVoicePrompt({ kind: 'nudge', step: 'other', tokenNumber: '108' })).toBe(
      'टोकन 108 का नया काम आया है'
    );
    expect(buildHindiVoicePrompt({ kind: 'nudge', step: 'other' })).toBe('नया काम आया है');
  });

  it('builds all helper_assignment prompts with and without token', () => {
    expect(
      buildHindiVoicePrompt({ kind: 'helper_assignment', step: 'tagging', tokenNumber: 'T-10' })
    ).toBe('टोकन 10 की टैगिंग करनी है');
    expect(buildHindiVoicePrompt({ kind: 'helper_assignment', step: 'tagging' })).toBe(
      'टैगिंग करनी है'
    );
    expect(
      buildHindiVoicePrompt({ kind: 'helper_assignment', step: 'getting_washed', tokenNumber: 'B102' })
    ).toBe('टोकन बी 102 को वॉशर में डालिए');
    expect(buildHindiVoicePrompt({ kind: 'helper_assignment', step: 'getting_washed' })).toBe(
      'कपड़े वॉशर में डालिए'
    );
    expect(
      buildHindiVoicePrompt({ kind: 'helper_assignment', step: 'getting_dried', tokenNumber: '1B108' })
    ).toBe('टोकन 1 बी 108 को ड्रायर में डालिए');
    expect(buildHindiVoicePrompt({ kind: 'helper_assignment', step: 'getting_dried' })).toBe(
      'कपड़े ड्रायर में डालिए'
    );
    expect(
      buildHindiVoicePrompt({ kind: 'helper_assignment', step: 'getting_ironed', tokenNumber: 'P108' })
    ).toBe('टोकन पी 108 का नया आयरनिंग का ऑर्डर आया है');
    expect(buildHindiVoicePrompt({ kind: 'helper_assignment', step: 'getting_ironed' })).toBe(
      'नया आयरनिंग का ऑर्डर आया है'
    );
    expect(
      buildHindiVoicePrompt({ kind: 'helper_assignment', step: 'packaging', tokenNumber: '1A, B102' })
    ).toBe('टोकन 1 ए और बी 102 की पैकेजिंग करनी है');
    expect(buildHindiVoicePrompt({ kind: 'helper_assignment', step: 'packaging' })).toBe(
      'पैकेजिंग करनी है'
    );
    expect(
      buildHindiVoicePrompt({ kind: 'helper_assignment', step: 'unknown_step', tokenNumber: '108' })
    ).toBe('टोकन 108 का नया काम आया है');
    expect(buildHindiVoicePrompt({ kind: 'helper_assignment', step: 'unknown_step' })).toBe(
      'नया काम आया है'
    );
  });
});
