import { Platform } from 'react-native';
import { GarmentLabel } from './opsProcess';

export interface LabelMeta { orderShort: string; }

const CRLF = '\r\n';
const DPI = 203;

const mm = (mm: number) => Math.round((mm / 25.4) * DPI);

export function buildTSPL(labels: GarmentLabel[], meta: LabelMeta, opts?: { widthMm?: number; heightMm?: number }): string {
  const w = mm(opts?.widthMm ?? 40);
  const h = mm(opts?.heightMm ?? 25);
  const lines: string[] = [];
  lines.push(`SIZE ${w} dots,${h} dots`);
  lines.push('GAP 3 mm,0');
  lines.push('DIRECTION 1');
  for (const label of labels) {
    lines.push('CLS');
    lines.push(`TEXT 60,60,"3",0,1,1,"#${meta.orderShort} #${label.seq}"`);
    lines.push(`QRCODE 60,150,M,4,A,0,"${label.qr}"`);
    lines.push('PRINT 1,1');
  }
  return lines.join(CRLF);
}

export async function printGarmentLabels(labels: GarmentLabel[], meta: LabelMeta): Promise<{ ok: boolean; mock: boolean; tspl?: string }> {
  const tspl = buildTSPL(labels, meta);
  if (Platform.OS === 'web') {
    openLabelPreview(tspl, labels, meta);
  }
  return { ok: true, mock: true, tspl };
}

function openLabelPreview(_tspl: string, labels: GarmentLabel[], meta: LabelMeta): void {
  if (typeof window === 'undefined') return;
  const rows = labels
    .map(l => `<div style="margin:12px 0;padding:16px;border:1px solid #999;font-family:monospace;font-size:12px">#${meta.orderShort} #${l.seq} &mdash; ${l.qr}</div>`)
    .join('');
  const win = window.open('', '_blank');
  win?.document.write(`<html><body style="font-family:sans-serif"><h3>Garment Labels (${labels.length})</h3>${rows}<script>setTimeout(()=>window.print(),300)</script></body></html>`);
  win?.document.close();
}
