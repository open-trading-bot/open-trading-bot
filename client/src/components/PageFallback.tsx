// Shown while a lazily loaded page downloads.
export function PageFallback() {
  return (
    <div className="flex justify-center py-16 text-gray-500" role="status" aria-label="Loading">
      <svg className="animate-spin w-6 h-6" fill="none" viewBox="0 0 24 24" aria-hidden="true">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
    </div>
  );
}
