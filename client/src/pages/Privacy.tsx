import { useLanguageStore } from 'common';

export function Privacy() {
  const { t } = useLanguageStore();
  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold">{t('privacyPolicy')}</h1>
      <p className="text-sm text-gray-400">Last updated: April 2026</p>
      <div className="space-y-4 text-sm text-gray-300 leading-relaxed">
        <section>
          <h2 className="text-lg font-semibold text-white mb-2">1. Information We Collect</h2>
          <p>We collect information you provide directly: username, email address, wallet address, and exchange API keys. We also collect usage data such as trading activity, login timestamps, and platform interactions.</p>
        </section>
        <section>
          <h2 className="text-lg font-semibold text-white mb-2">2. How We Use Your Information</h2>
          <p>Your information is used to provide and improve the platform, execute trades on your behalf, authenticate your identity, and communicate important updates.</p>
        </section>
        <section>
          <h2 className="text-lg font-semibold text-white mb-2">3. Data Security</h2>
          <p>Exchange API keys are encrypted at rest using AES-256-GCM. Passwords are hashed. We implement industry-standard security measures to protect your data. However, no system is 100% secure.</p>
        </section>
        <section>
          <h2 className="text-lg font-semibold text-white mb-2">4. Data Sharing</h2>
          <p>We do not sell or share your personal information with third parties. Your exchange API keys are only used to execute trades on your configured exchange account.</p>
        </section>
        <section>
          <h2 className="text-lg font-semibold text-white mb-2">5. Wallet Data</h2>
          <p>When you connect a wallet, we store your public wallet address only. We never request or store private keys. Wallet connection is verified through cryptographic signature.</p>
        </section>
        <section>
          <h2 className="text-lg font-semibold text-white mb-2">6. Data Retention</h2>
          <p>Your data is retained as long as your account is active. Deleted accounts are soft-deleted and data is retained for 30 days before permanent removal.</p>
        </section>
        <section>
          <h2 className="text-lg font-semibold text-white mb-2">7. Your Rights</h2>
          <p>You may request access to, correction of, or deletion of your personal data at any time by contacting the platform administrator.</p>
        </section>
        <section>
          <h2 className="text-lg font-semibold text-white mb-2">8. Changes to Policy</h2>
          <p>We may update this privacy policy at any time. We will notify users of significant changes through the platform.</p>
        </section>
      </div>
    </div>
  );
}
