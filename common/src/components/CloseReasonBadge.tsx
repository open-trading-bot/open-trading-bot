import type { TranslationKey } from '../i18n';

export function CloseReasonBadge({ reason, t }: { reason?: string | null; t: (k: TranslationKey) => string }) {
  if (!reason) return <span className="text-gray-600 text-xs">—</span>;
  const labelKey = (() => {
    switch (reason) {
      case 'bot': return 'closeReasonBot' as const;
      case 'user': return 'closeReasonUser' as const;
      case 'admin': return 'closeReasonAdmin' as const;
      case 'liquidation': return 'closeReasonLiquidation' as const;
      case 'bot_stop': return 'closeReasonBotStop' as const;
      case 'system': return 'closeReasonSystem' as const;
      case 'asset-disabled': return 'closeReasonAssetDisabled' as const;
      default: return 'closeReasonUnknown' as const;
    }
  })();
  const color = (() => {
    switch (reason) {
      case 'user': return 'bg-blue-500/10 text-blue-400';
      case 'admin': return 'bg-purple-500/10 text-purple-400';
      case 'bot':
      case 'bot_stop': return 'bg-green-500/10 text-green-400';
      case 'liquidation': return 'bg-red-500/10 text-red-400';
      case 'asset-disabled': return 'bg-amber-500/10 text-amber-400';
      case 'system': return 'bg-gray-500/10 text-gray-400';
      default: return 'bg-gray-500/10 text-gray-400';
    }
  })();
  return (
    <span className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded-md ${color}`}>
      {t(labelKey)}
    </span>
  );
}
