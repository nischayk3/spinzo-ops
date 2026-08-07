import { describe, it, expect, vi } from 'vitest';

// react-native's Flow-typed source cannot be parsed in the vitest/node environment;
// labelPrint only needs Platform.OS, so stub the module.
vi.mock('react-native', () => ({ Platform: { OS: 'node' } }));

import { buildTSPL } from './labelPrint';
import { GarmentLabel } from './opsProcess';

const count = (haystack: string, needle: string) => haystack.split(needle).length - 1;

describe('buildTSPL', () => {
  const labels: GarmentLabel[] = [
    { seq: 1, qr: 'SPNZ:abc:1' },
    { seq: 2, qr: 'SPNZ:abc:2' },
  ];

  it('emits a SIZE line in dots', () => {
    const tspl = buildTSPL(labels, { orderShort: 'SPNZ:abc' });
    expect(tspl).toMatch(/^SIZE \d+ dots,\d+ dots/);
    expect(tspl).toContain('SIZE ');
    expect(tspl).toContain('dots');
  });

  it('uses 203dpi dot math for the default 40x25mm label', () => {
    const tspl = buildTSPL(labels, { orderShort: 'SPNZ:abc' });
    expect(tspl).toContain('SIZE 320 dots,200 dots');
  });

  it('embeds each QR value in a QRCODE command', () => {
    const tspl = buildTSPL(labels, { orderShort: 'SPNZ:abc' });
    expect(tspl).toContain('QRCODE 60,150,M,4,A,0,"SPNZ:abc:1"');
    expect(tspl).toContain('QRCODE 60,150,M,4,A,0,"SPNZ:abc:2"');
  });

  it('emits exactly one PRINT 1,1 per label', () => {
    const one = buildTSPL([labels[0]], { orderShort: 'SPNZ:abc' });
    expect(count(one, 'PRINT 1,1')).toBe(1);

    const two = buildTSPL(labels, { orderShort: 'SPNZ:abc' });
    expect(count(two, 'PRINT 1,1')).toBe(2);
  });

  it('emits a CLS (clear) before each label block', () => {
    const tspl = buildTSPL(labels, { orderShort: 'SPNZ:abc' });
    expect(count(tspl, 'CLS')).toBe(2);
  });

  it('respects custom dimensions', () => {
    const tspl = buildTSPL(labels, { orderShort: 'SPNZ:abc' }, { widthMm: 50, heightMm: 30 });
    // 50mm -> 400 dots, 30mm -> 240 dots at 203 dpi
    expect(tspl).toContain('SIZE 400 dots,240 dots');
  });

  it('escapes quotes and backslashes in QR/text content so TSPL commands stay intact', () => {
    const dirty: GarmentLabel[] = [{ seq: 1, qr: 'SPNZ:a"b\\c"d:1' }];
    const tspl = buildTSPL(dirty, { orderShort: 'A"B\\C' });
    expect(tspl).toContain('QRCODE 60,150,M,4,A,0,"SPNZ:a\\"b\\\\c\\"d:1"');
    expect(tspl).toContain('TEXT 60,60,"3",0,1,1,"#A\\"B\\\\C #1"');
    // Escaped content must not produce a bare unescaped quote inside the string.
    expect(tspl).not.toContain('d:1" #');
  });

  it('strips newlines from content so a label command is never split', () => {
    const dirty: GarmentLabel[] = [{ seq: 1, qr: 'SPNZ:a\nb:1' }];
    const tspl = buildTSPL(dirty, { orderShort: 'AB' });
    expect(tspl).not.toContain('\n"');
  });
});
