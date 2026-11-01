import type { Db, DbFeatureFlag, DbFeatureFlagOverride } from '../db/index.js';

export interface FlagWithOverrides extends DbFeatureFlag {
  overrides: Omit<DbFeatureFlagOverride, 'id' | 'flagId'>[];
}

export interface FeatureFlagService {
  getAllFlags(): FlagWithOverrides[];
  getResolvedFlags(userId: number, role: string): Record<string, boolean>;
  createFlag(id: string, description: string, enabled: boolean, createdBy: number): void;
  updateFlag(id: string, updates: Partial<{ description: string; enabled: boolean }>): void;
  deleteFlag(id: string): void;
  setOverrides(flagId: string, overrides: { targetType: string; targetValue: string; enabled: boolean }[]): void;
}

export function createFeatureFlagService(db: Db): FeatureFlagService {
  return {
    getAllFlags() {
      const flags = db.getActiveFlags();
      const allOverrides = db.getAllFlagOverrides();
      return flags.map((flag) => ({
        ...flag,
        overrides: allOverrides
          .filter((o) => o.flagId === flag.id)
          .map(({ targetType, targetValue, enabled }) => ({ targetType, targetValue, enabled })),
      }));
    },

    getResolvedFlags(userId: number, role: string) {
      const flags = db.getActiveFlags();
      const allOverrides = db.getAllFlagOverrides();
      const result: Record<string, boolean> = {};

      for (const flag of flags) {
        const flagOverrides = allOverrides.filter((o) => o.flagId === flag.id);

        // Priority: user override > role override > global default
        const userOverride = flagOverrides.find((o) => o.targetType === 'user' && o.targetValue === String(userId));
        if (userOverride) {
          result[flag.id] = userOverride.enabled;
          continue;
        }

        const roleOverride = flagOverrides.find((o) => o.targetType === 'role' && o.targetValue === role);
        if (roleOverride) {
          result[flag.id] = roleOverride.enabled;
          continue;
        }

        result[flag.id] = flag.enabled;
      }

      return result;
    },

    createFlag(id: string, description: string, enabled: boolean, createdBy: number) {
      db.createFlag(id, description, enabled, createdBy);
    },

    updateFlag(id: string, updates: Partial<{ description: string; enabled: boolean }>) {
      db.updateFlag(id, updates);
    },

    deleteFlag(id: string) {
      db.deleteFlag(id);
    },

    setOverrides(flagId: string, overrides: { targetType: string; targetValue: string; enabled: boolean }[]) {
      db.replaceFlagOverrides(flagId, overrides);
    },
  };
}
