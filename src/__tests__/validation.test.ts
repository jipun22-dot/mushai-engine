import { describe, expect, it } from 'vitest';
import {
  buildAlertDedupKey,
  calculateDowntimeMinutes,
  calculateProductionMetrics,
  downtimeLogSchema,
  evaluateExpiryStatus,
  evaluateQualityMeasurement,
  productionLogSchema,
} from '../lib/validation';

describe('Deterministic Operational Calculations & Validation', () => {
  it('computes production achievement and rejection rate deterministically', () => {
    const metrics = calculateProductionMetrics(1000, 950, 19);
    expect(metrics.achievementPercent).toBe(95);
    expect(metrics.rejectionRatePercent).toBe(2);
  });

  it('computes downtime duration from valid timestamps and rejects inverted windows', () => {
    const mins = calculateDowntimeMinutes('2026-11-16T08:00', '2026-11-16T09:45');
    expect(mins).toBe(105);

    expect(() => calculateDowntimeMinutes('2026-11-16T10:00', '2026-11-16T09:00')).toThrow();

    const invalidResult = downtimeLogSchema.safeParse({
      siteId: 'site_1',
      machine: 'Press-1',
      productionLine: 'Line A',
      startTime: '2026-11-16T12:00',
      endTime: '2026-11-16T11:00',
      reason: 'Motor trip',
      reportedBy: 'Alex',
      resolutionStatus: 'open',
    });
    expect(invalidResult.success).toBe(false);
  });

  it('flags out-of-range quality measurements accurately', () => {
    expect(evaluateQualityMeasurement(84.5, 18, 85)).toEqual({ outOfRange: false, result: 'pass' });
    expect(evaluateQualityMeasurement(86.1, 18, 85)).toEqual({ outOfRange: true, result: 'fail' });
    expect(evaluateQualityMeasurement(17.9, 18, 85)).toEqual({ outOfRange: true, result: 'fail' });
  });

  it('evaluates certification expiry thresholds accurately', () => {
    const now = new Date('2026-11-16T00:00:00Z');
    expect(evaluateExpiryStatus('2026-11-10', 30, now).status).toBe('expired');
    expect(evaluateExpiryStatus('2026-11-30', 30, now).status).toBe('expiring_soon');
    expect(evaluateExpiryStatus('2027-03-01', 30, now).status).toBe('valid');
  });

  it('produces deterministic alert deduplication keys per org, category, and target', () => {
    const k1 = buildAlertDedupKey('org_a', 'permit_expiry', 'ptw_101');
    const k2 = buildAlertDedupKey('org_a', 'permit_expiry', 'ptw_101');
    const k3 = buildAlertDedupKey('org_b', 'permit_expiry', 'ptw_101');
    expect(k1).toBe(k2);
    expect(k1).not.toBe(k3);
  });

  it('rejects negative target quantities in productionLogSchema', () => {
    const res = productionLogSchema.safeParse({
      productionDate: '2026-11-16',
      siteId: 'site_1',
      productionLine: 'Line 1',
      machine: 'CNC-1',
      shift: 'Shift A',
      product: 'Gearbox',
      targetQuantity: 0,
      actualQuantity: 50,
      rejectedQuantity: 0,
      supervisor: 'Sam',
    });
    expect(res.success).toBe(false);
  });
});
