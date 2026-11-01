import { useLanguageStore } from 'common';

export function Terms() {
  const { t } = useLanguageStore();
  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold">{t('termsOfService')}</h1>
      <p className="text-sm text-gray-400">Last updated: April 2026</p>
      <div className="space-y-4 text-sm text-gray-300 leading-relaxed">
        <section>
          <h2 className="text-lg font-semibold text-white mb-2">1. Acceptance of Terms</h2>
          <p>By accessing or using the Trading Bot platform, you agree to be bound by these Terms of Service. If you do not agree, do not use the platform.</p>
        </section>
        <section>
          <h2 className="text-lg font-semibold text-white mb-2">2. Description of Service</h2>
          <p>Trading Bot provides algorithmic cryptocurrency trading tools, including strategy backtesting, automated order execution, portfolio tracking, and wallet integration. The platform is provided "as is" for informational and educational purposes.</p>
        </section>
        <section>
          <h2 className="text-lg font-semibold text-white mb-2">3. Risk Disclaimer</h2>
          <p>Cryptocurrency trading involves substantial risk of loss. Past performance does not guarantee future results. You are solely responsible for any trading decisions made using this platform. We do not provide financial advice.</p>
        </section>
        <section>
          <h2 className="text-lg font-semibold text-white mb-2">4. User Accounts</h2>
          <p>You are responsible for maintaining the confidentiality of your account credentials and API keys. You agree to notify us immediately of any unauthorized use of your account.</p>
        </section>
        <section>
          <h2 className="text-lg font-semibold text-white mb-2">5. Prohibited Use</h2>
          <p>You may not use the platform for market manipulation, money laundering, or any illegal activity. We reserve the right to suspend accounts that violate these terms.</p>
        </section>
        <section>
          <h2 className="text-lg font-semibold text-white mb-2">6. Limitation of Liability</h2>
          <p>We are not liable for any losses, damages, or costs arising from your use of the platform, including but not limited to trading losses, system downtime, or data breaches.</p>
        </section>
        <section>
          <h2 className="text-lg font-semibold text-white mb-2">7. System Requirements</h2>
          <p>This platform is optimized for and officially supports Google Chrome (latest version). While the platform may work in other modern browsers, full functionality and optimal experience are only guaranteed on Chrome. We recommend keeping your browser up to date.</p>
        </section>
        <section>
          <h2 className="text-lg font-semibold text-white mb-2">8. Changes to Terms</h2>
          <p>We may update these terms at any time. Continued use of the platform constitutes acceptance of the updated terms.</p>
        </section>
      </div>
    </div>
  );
}
