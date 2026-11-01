type BotStatus = 'running' | 'paused' | 'stopped';
type BotMode = 'paper' | 'live';

const DOT_COLORS: Record<BotStatus, string> = {
  running: '#22c55e',
  paused: '#eab308',
  stopped: '#6b7280',
};

const GRAPH_COLORS: Record<BotMode, string> = {
  paper: '#6b7280',
  live: '#22c55e',
};

function buildSvg(status: BotStatus, mode: BotMode): string {
  const dotFill = DOT_COLORS[status];
  const graphStroke = GRAPH_COLORS[mode];
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" fill="none">',
    '<rect width="32" height="32" rx="6" fill="#0f172a"/>',
    `<path d="M6 22L12 14L17 18L26 8" stroke="${graphStroke}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`,
    `<path d="M21 8H26V13" stroke="${graphStroke}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`,
    '<line x1="6" y1="25" x2="26" y2="25" stroke="#334155" stroke-width="1.5" stroke-linecap="round"/>',
    `<circle cx="25" cy="25" r="6" fill="${dotFill}" stroke="#0f172a" stroke-width="2"/>`,
    '</svg>',
  ].join('');
}

function toDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

let currentKey = '';

export function setFaviconStatus(status: BotStatus, mode: BotMode): void {
  const key = `${status}:${mode}`;
  if (key === currentKey) return;
  currentKey = key;
  const link = document.querySelector<HTMLLinkElement>("link[rel='icon']");
  if (!link) return;
  link.href = toDataUrl(buildSvg(status, mode));
}
