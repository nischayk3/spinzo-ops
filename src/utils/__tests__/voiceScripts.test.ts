import { describe, it, expect } from 'vitest';
import { extractCleanTokenNumber, buildHindiVoicePrompt } from '../voiceScripts';

describe('extractCleanTokenNumber', () => {
  it('strips leading T-, t-, #, and whitespace', () => {
    expect(extractCleanTokenNumber('T-42')).toBe('42');
    expect(extractCleanTokenNumber('t-108')).toBe('108');
    expect(extractCleanTokenNumber('#75')).toBe('75');
    expect(extractCleanTokenNumber('  #T-99  ')).toBe('99');
    expect(extractCleanTokenNumber(25)).toBe('25');
  });

  it('rejects long alphanumeric Firestore order IDs and non-digit strings', () => {
    expect(extractCleanTokenNumber('xK9mPq2Lw8ZvRt3N')).toBe('');
    expect(extractCleanTokenNumber('ORD123456789')).toBe('');
    expect(extractCleanTokenNumber('ABCDEF')).toBe('');
    expect(extractCleanTokenNumber('   ')).toBe('');
    expect(extractCleanTokenNumber(null)).toBe('');
    expect(extractCleanTokenNumber(undefined)).toBe('');
  });

  it('falls back to tokensMap when rawToken is empty or invalid', () => {
    expect(extractCleanTokenNumber('', { wash: 'T-14' })).toBe('14');
    expect(extractCleanTokenNumber('xK9mPq2Lw8ZvRt3N', { a: 'INVALID', b: '#203' })).toBe('203');
    expect(extractCleanTokenNumber(undefined, { a: 'longfirestoreid12345' })).toBe('');
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

  it('builds delivery prompts with and without token', () => {
    expect(buildHindiVoicePrompt({ kind: 'delivery', tokenNumber: 'T-55' })).toBe(
      'टोकन नंबर 55, डिलीवरी के लिए जाना है'
    );
    expect(buildHindiVoicePrompt({ kind: 'delivery', tokensMap: { primary: '#19' } })).toBe(
      'टोकन नंबर 19, डिलीवरी के लिए जाना है'
    );
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
      'टोकन नंबर 12, डिटर्जेंट डालिए'
    );
    expect(buildHindiVoicePrompt({ kind: 'nudge', phase: 'softener', tokenNumber: '#12' })).toBe(
      'टोकन नंबर 12, सॉफ्टनर डालिए'
    );
    expect(
      buildHindiVoicePrompt({ kind: 'nudge', step: 'getting_washed', phase: 'accepted', tokenNumber: '7' })
    ).toBe('टोकन नंबर 7, वॉशर चालू करिए');
    expect(
      buildHindiVoicePrompt({ kind: 'nudge', step: 'getting_washed', phase: 'started', tokenNumber: '7' })
    ).toBe('टोकन नंबर 7, वॉशर से निकालिए');
    expect(
      buildHindiVoicePrompt({ kind: 'nudge', step: 'getting_dried', phase: 'accepted', tokenNumber: '8' })
    ).toBe('टोकन नंबर 8, ड्रायर चालू करिए');
    expect(
      buildHindiVoicePrompt({ kind: 'nudge', step: 'getting_dried', phase: 'started', tokenNumber: '8' })
    ).toBe('टोकन नंबर 8, ड्रायर से निकालिए');
    expect(buildHindiVoicePrompt({ kind: 'nudge', step: 'tagging', tokenNumber: 'T-3' })).toBe(
      'टोकन नंबर 3, टैगिंग जल्दी पूरी करिए'
    );
    expect(buildHindiVoicePrompt({ kind: 'nudge', step: 'packaging' })).toBe(
      'पैकेजिंग जल्दी पूरी करिए'
    );
  });

  it('builds all helper_assignment prompts with and without token', () => {
    expect(
      buildHindiVoicePrompt({ kind: 'helper_assignment', step: 'tagging', tokenNumber: 'T-10' })
    ).toBe('टोकन नंबर 10, टैगिंग करनी है');
    expect(
      buildHindiVoicePrompt({ kind: 'helper_assignment', step: 'getting_washed', tokenNumber: '11' })
    ).toBe('टोकन नंबर 11, वॉशर में डालिए');
    expect(
      buildHindiVoicePrompt({ kind: 'helper_assignment', step: 'getting_dried', tokenNumber: '12' })
    ).toBe('टोकन नंबर 12, ड्रायर में डालिए');
    expect(
      buildHindiVoicePrompt({ kind: 'helper_assignment', step: 'getting_ironed', tokenNumber: '13' })
    ).toBe('टोकन नंबर 13, आयरन करना है');
    expect(
      buildHindiVoicePrompt({ kind: 'helper_assignment', step: 'packaging', tokenNumber: '14' })
    ).toBe('टोकन नंबर 14, पैकेजिंग करनी है');
    expect(buildHindiVoicePrompt({ kind: 'helper_assignment', step: 'unknown_step' })).toBe(
      'नया काम आया है'
    );
  });
});
