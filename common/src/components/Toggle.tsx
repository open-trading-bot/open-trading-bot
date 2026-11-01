interface ToggleProps {
  enabled: boolean;
  onChange: () => void;
}

export function Toggle({ enabled, onChange }: ToggleProps) {
  return (
    <button
      onClick={onChange}
      className={`relative w-12 h-6 rounded-full transition-colors shrink-0 ${enabled ? 'bg-green-600' : 'bg-gray-700'}`}
      dir="ltr"
    >
      <div
        className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-transform shadow ${enabled ? 'left-[26px]' : 'left-0.5'}`}
      />
    </button>
  );
}
