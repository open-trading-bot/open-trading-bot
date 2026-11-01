import { create } from 'zustand';
import { getFeatureFlags } from '../lib/api';

interface FeatureFlagStore {
  flags: Record<string, boolean>;
  loaded: boolean;
  fetchFlags: () => Promise<void>;
  isEnabled: (flag: string) => boolean;
}

export const useFeatureFlagStore = create<FeatureFlagStore>((set, get) => ({
  flags: {},
  loaded: false,
  async fetchFlags() {
    try {
      const { flags } = await getFeatureFlags();
      set({ flags, loaded: true });
    } catch {
      set({ loaded: true });
    }
  },
  isEnabled(flag: string) {
    return get().flags[flag] ?? false;
  },
}));
