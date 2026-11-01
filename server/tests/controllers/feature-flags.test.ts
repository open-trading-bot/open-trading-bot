import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createBackofficeController } from '../../src/controllers/backoffice.js';
import type { FeatureFlagService } from '../../src/services/featureFlags.js';

function mockRes() {
  const res: any = { statusCode: 200 };
  res.status = vi.fn((code: number) => { res.statusCode = code; return res; });
  res.json = vi.fn();
  return res;
}

function mockReq(body: any = {}, params: any = {}, user: any = { id: 42 }): any {
  return { body, params, user };
}

function createMockFlagService(overrides: Partial<FeatureFlagService> = {}): FeatureFlagService {
  return {
    getAllFlags: vi.fn().mockReturnValue([]),
    getResolvedFlags: vi.fn().mockReturnValue({}),
    createFlag: vi.fn(),
    updateFlag: vi.fn(),
    deleteFlag: vi.fn(),
    setOverrides: vi.fn(),
    ...overrides,
  };
}

describe('BackofficeController — feature flags', () => {
  let flagService: FeatureFlagService;

  beforeEach(() => {
    flagService = createMockFlagService();
  });

  function makeCtrl(fs = flagService) {
    return createBackofficeController({} as any, fs);
  }

  describe('getFeatureFlags', () => {
    it('returns all flags as JSON', () => {
      const flags = [{ id: 'flag-a', description: 'Flag A', enabled: true, overrides: [] }];
      flagService = createMockFlagService({ getAllFlags: vi.fn().mockReturnValue(flags) });
      const ctrl = makeCtrl(flagService);
      const res = mockRes();

      ctrl.getFeatureFlags(mockReq(), res);

      expect(flagService.getAllFlags).toHaveBeenCalledOnce();
      expect(res.json).toHaveBeenCalledWith(flags);
    });
  });

  describe('createFeatureFlag', () => {
    it('returns 400 when id is missing', () => {
      const ctrl = makeCtrl();
      const res = mockRes();

      ctrl.createFeatureFlag(mockReq({ description: 'some desc' }), res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: 'id and description are required' });
      expect(flagService.createFlag).not.toHaveBeenCalled();
    });

    it('returns 400 when description is missing', () => {
      const ctrl = makeCtrl();
      const res = mockRes();

      ctrl.createFeatureFlag(mockReq({ id: 'my_flag' }), res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: 'id and description are required' });
      expect(flagService.createFlag).not.toHaveBeenCalled();
    });

    it('calls createFlag with user id and returns ok on success', () => {
      const ctrl = makeCtrl();
      const res = mockRes();

      ctrl.createFeatureFlag(mockReq({ id: 'my_flag', description: 'My flag', enabled: true }, {}, { id: 7 }), res);

      expect(flagService.createFlag).toHaveBeenCalledWith('my_flag', 'My flag', true, 7);
      expect(res.status).not.toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith({ ok: true });
    });

    it('defaults enabled to false when not provided', () => {
      const ctrl = makeCtrl();
      const res = mockRes();

      ctrl.createFeatureFlag(mockReq({ id: 'my_flag', description: 'My flag' }, {}, { id: 7 }), res);

      expect(flagService.createFlag).toHaveBeenCalledWith('my_flag', 'My flag', false, 7);
    });

    it('returns 400 when service throws (e.g. duplicate id)', () => {
      flagService = createMockFlagService({
        createFlag: vi.fn().mockImplementation(() => {
          throw Object.assign(new Error('UNIQUE constraint failed: feature_flags.id'), { code: 'SQLITE_CONSTRAINT_PRIMARYKEY' });
        }),
      });
      const ctrl = makeCtrl();
      const res = mockRes();

      ctrl.createFeatureFlag(mockReq({ id: 'dup_flag', description: 'Dup' }), res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: 'Flag already exists' });
    });
  });

  describe('updateFeatureFlag', () => {
    it('calls updateFlag with id from params and body fields', () => {
      const ctrl = makeCtrl();
      const res = mockRes();

      ctrl.updateFeatureFlag(mockReq({ description: 'Updated', enabled: false }, { id: 'flag-x' }), res);

      expect(flagService.updateFlag).toHaveBeenCalledWith('flag-x', { description: 'Updated', enabled: false });
      expect(res.json).toHaveBeenCalledWith({ ok: true });
    });
  });

  describe('deleteFeatureFlag', () => {
    it('calls deleteFlag with id from params', () => {
      const ctrl = makeCtrl();
      const res = mockRes();

      ctrl.deleteFeatureFlag(mockReq({}, { id: 'flag-y' }), res);

      expect(flagService.deleteFlag).toHaveBeenCalledWith('flag-y');
      expect(res.json).toHaveBeenCalledWith({ ok: true });
    });
  });

  describe('setFeatureFlagOverrides', () => {
    it('returns 400 when overrides is not an array', () => {
      const ctrl = makeCtrl();
      const res = mockRes();

      ctrl.setFeatureFlagOverrides(mockReq({ overrides: 'not-an-array' }, { id: 'flag-z' }), res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: 'overrides must be an array' });
      expect(flagService.setOverrides).not.toHaveBeenCalled();
    });

    it('returns 400 when overrides is missing', () => {
      const ctrl = makeCtrl();
      const res = mockRes();

      ctrl.setFeatureFlagOverrides(mockReq({}, { id: 'flag-z' }), res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: 'overrides must be an array' });
      expect(flagService.setOverrides).not.toHaveBeenCalled();
    });

    it('calls setOverrides with id and overrides array', () => {
      const ctrl = makeCtrl();
      const res = mockRes();
      const overrides = [{ targetType: 'user', targetValue: '5', enabled: true }];

      ctrl.setFeatureFlagOverrides(mockReq({ overrides }, { id: 'flag-z' }), res);

      expect(flagService.setOverrides).toHaveBeenCalledWith('flag-z', overrides);
      expect(res.json).toHaveBeenCalledWith({ ok: true });
    });

    it('accepts an empty array for overrides', () => {
      const ctrl = makeCtrl();
      const res = mockRes();

      ctrl.setFeatureFlagOverrides(mockReq({ overrides: [] }, { id: 'flag-z' }), res);

      expect(flagService.setOverrides).toHaveBeenCalledWith('flag-z', []);
      expect(res.json).toHaveBeenCalledWith({ ok: true });
    });
  });
});
