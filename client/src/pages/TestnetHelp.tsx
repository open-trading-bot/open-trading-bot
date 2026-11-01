import { Link, useParams, Navigate } from 'react-router-dom';
import { useLanguageStore } from 'common';

type Exchange = 'bybit' | 'binance';

const SUPPORTED: Exchange[] = ['bybit', 'binance'];

export function TestnetHelp() {
  const { t } = useLanguageStore();
  const { exchange } = useParams<{ exchange: string }>();

  if (!exchange || !SUPPORTED.includes(exchange as Exchange)) {
    return <Navigate to="/help/testnet/bybit" replace />;
  }

  const ex = exchange as Exchange;

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <Link to="/settings" className="text-xs text-blue-400 hover:underline">
          ← {t('backToSettings')}
        </Link>
        <h1 className="text-2xl font-bold mt-2">
          {ex === 'bybit' ? t('testnetHelpBybitTitle') : t('testnetHelpBinanceTitle')}
        </h1>
        <p className="text-sm text-gray-400 mt-1">{t('testnetHelpIntro')}</p>
      </div>

      <nav className="flex gap-2 text-xs">
        <Link
          to="/help/testnet/bybit"
          className={`px-3 py-1.5 rounded-lg border ${
            ex === 'bybit'
              ? 'border-blue-500/40 bg-blue-500/10 text-blue-300'
              : 'border-gray-700 text-gray-400 hover:text-white'
          }`}
        >
          Bybit
        </Link>
        <Link
          to="/help/testnet/binance"
          className={`px-3 py-1.5 rounded-lg border ${
            ex === 'binance'
              ? 'border-blue-500/40 bg-blue-500/10 text-blue-300'
              : 'border-gray-700 text-gray-400 hover:text-white'
          }`}
        >
          Binance
        </Link>
      </nav>

      <div className="space-y-4 text-sm text-gray-300 leading-relaxed">
        <section>
          <h2 className="text-lg font-semibold text-white mb-2">{t('testnetHelpWhatTitle')}</h2>
          <p>{t('testnetHelpWhatBody')}</p>
        </section>

        {ex === 'bybit' && (
          <section className="rounded-lg border border-gray-700 bg-gray-800/40 p-4">
            <h2 className="text-lg font-semibold text-white mb-3">{t('testnetHelpBybitTitle')}</h2>
            <ol className="list-decimal list-inside space-y-2">
              <li>
                {t('testnetHelpBybitStep1')}{' '}
                <a
                  href="https://testnet.bybit.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-400 hover:underline"
                >
                  testnet.bybit.com
                </a>
              </li>
              <li>{t('testnetHelpBybitStep2')}</li>
              <li>
                {t('testnetHelpBybitStep3')}{' '}
                <a
                  href="https://testnet.bybit.com/app/user/api-management"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-400 hover:underline"
                >
                  {t('testnetHelpApiManagement')}
                </a>
              </li>
              <li>{t('testnetHelpBybitStep4')}</li>
              <li>
                {t('testnetHelpBybitStep5')}{' '}
                <a
                  href="https://testnet.bybit.com/user/assets/home"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-400 hover:underline"
                >
                  {t('testnetHelpFaucet')}
                </a>
              </li>
            </ol>

            {/* Read-Only vs Read-and-Write warning */}
            <div className="mt-4 rounded-lg border border-red-500/30 bg-red-500/5 p-3">
              <h3 className="text-sm font-semibold text-red-400 mb-2 flex items-start gap-2">
                <span>⚠</span>
                <span>{t('bybitReadOnlyWarningTitle')}</span>
              </h3>
              <p className="text-xs text-red-200/80 leading-relaxed mb-2">
                {t('bybitReadOnlyWarningBody')}
              </p>
              <ul className="text-xs text-red-200/80 leading-relaxed list-disc list-inside space-y-1 ps-2">
                <li>{t('bybitReadOnlyWarningItem1')}</li>
                <li>{t('bybitReadOnlyWarningItem2')}</li>
                <li>{t('bybitReadOnlyWarningItem3')}</li>
              </ul>
              <p className="text-xs text-red-200/80 leading-relaxed mt-2">
                {t('bybitReadOnlyWarningFooter')}
              </p>
            </div>
          </section>
        )}

        {ex === 'binance' && (
          <section className="rounded-lg border border-gray-700 bg-gray-800/40 p-4">
            <h2 className="text-lg font-semibold text-white mb-3">{t('testnetHelpBinanceTitle')}</h2>
            <ol className="list-decimal list-inside space-y-2">
              <li>
                {t('testnetHelpBinanceStep1')}{' '}
                <a
                  href="https://testnet.binancefuture.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-400 hover:underline"
                >
                  testnet.binancefuture.com
                </a>
              </li>
              <li>{t('testnetHelpBinanceStep2')}</li>
              <li>{t('testnetHelpBinanceStep3')}</li>
              <li>{t('testnetHelpBinanceStep4')}</li>
              <li>{t('testnetHelpBinanceStep5')}</li>
            </ol>
          </section>
        )}

        <section>
          <h2 className="text-lg font-semibold text-white mb-2">{t('testnetHelpUseTitle')}</h2>
          <ol className="list-decimal list-inside space-y-1">
            <li>{t('testnetHelpUseStep1')}</li>
            <li>{t('testnetHelpUseStep2')}</li>
            <li>{t('testnetHelpUseStep3')}</li>
            <li>{t('testnetHelpUseStep4')}</li>
          </ol>
        </section>

        <section className="rounded-lg border border-yellow-500/20 bg-yellow-500/5 px-3 py-2">
          <p className="text-xs text-yellow-400">{t('testnetHelpWarning')}</p>
        </section>
      </div>
    </div>
  );
}
