import { useState } from 'react';

const CDN = 'https://cdn.jsdelivr.net/gh/atomiclabs/cryptocurrency-icons@1a63530be6e374711a8554f31b17e4cb92c25fa5/128/color';

// Known coins that exist on the CDN — avoids 404s for others
// Verified against CDN — only coins that return 200
const KNOWN_ICONS = new Set([
  'btc', 'eth', 'sol', 'bnb', 'xrp', 'ada', 'doge', 'dot', 'avax', 'matic',
  'link', 'uni', 'atom', 'ltc', 'etc', 'xlm', 'fil', 'aave', 'mkr', 'crv',
  'snx', 'comp', 'sushi', 'yfi', 'trx', 'icp', 'vet', 'sand', 'mana', 'enj',
  'chz', 'bat', 'zil', 'eos', 'xtz', 'algo', 'one', 'theta', 'grt', 'ren',
  'lrc', 'ape', '1inch', 'ankr', 'zrx', 'bch', 'neo', 'qtum', 'dash', 'waves',
  'ont', 'xem', 'zec', 'dcr', 'sc', 'zen', 'ksm', 'bal', 'storj', 'skl',
  'stx',
]);

function Fallback({ symbol, size }: { symbol: string; size: number }) {
  return (
    <div
      className="rounded-full bg-gray-700 flex items-center justify-center text-white font-bold shrink-0"
      style={{ width: size, height: size, fontSize: size * 0.4 }}
    >
      {symbol.split('/')[0].slice(0, 2)}
    </div>
  );
}

export function CryptoIcon({ symbol, size = 20 }: { symbol: string; size?: number }) {
  const coin = symbol.split('/')[0].toLowerCase();
  const [failed, setFailed] = useState(false);

  if (!KNOWN_ICONS.has(coin) || failed) {
    return <Fallback symbol={symbol} size={size} />;
  }

  return (
    <img
      src={`${CDN}/${coin}.png`}
      alt={coin}
      width={size}
      height={size}
      className="rounded-full shrink-0"
      onError={() => setFailed(true)}
    />
  );
}
