import { Link } from 'react-router-dom';
import { useLanguageStore } from 'common';

export function NotFound() {
  const { t } = useLanguageStore();

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center px-4">
      <div className="text-center">
        <div className="text-8xl font-bold text-gray-700 mb-4">404</div>
        <h1 className="text-xl font-semibold text-gray-200 mb-2">{t('pageNotFound')}</h1>
        <p className="text-sm text-gray-500 mb-6">{t('pageNotFoundDesc')}</p>
        <Link
          to="/"
          className="bg-blue-600 hover:bg-blue-700 text-white text-sm px-5 py-2.5 rounded-lg font-medium"
        >
          {t('backToDashboard')}
        </Link>
      </div>
    </div>
  );
}
