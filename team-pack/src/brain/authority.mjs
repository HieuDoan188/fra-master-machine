// Submission Authority — the final gate, ported from legacy agents/submission/authority.py,
// with the review scoring from agents/review/review.py and coverage from services/testing_service.
// Submission is irreversible (one per item), so every check must pass before submit_work may call the API.

import { RULES } from './rules.mjs';

const clamp01 = (v) => Math.max(0, Math.min(1, Number(v)));

// legacy ReviewAgent.review: weighted confidence.
export function reviewConfidence({ correctness, regressionRisk, maintainability, security }) {
  return Math.round((0.4 * clamp01(correctness) + 0.3 * (1 - clamp01(regressionRisk)) + 0.2 * clamp01(maintainability) + 0.1 * clamp01(security)) * 100) / 100;
}

// legacy TestOutcome.coverage: passed scenarios / all scenarios (MVS + extra), in percent.
export function coverage({ mvs, extra }) {
  const total = (mvs?.total ?? 0) + (extra?.total ?? 0);
  if (!total) return 0;
  return Math.round(((mvs?.passed ?? 0) + (extra?.passed ?? 0)) / total * 1000) / 10;
}

// verification: { mvs:{total,passed}, extra:{total,passed}, review:{correctness,regressionRisk,maintainability,security}, evidenceFiles:[...] }
// mvsRequired: count of minimumVerificationScenarios returned by Start Work.
// evidenceOk: whether every evidence file exists under answers/<ID>/evidence/.
export function gate(verification, { mvsRequired = 0, evidenceOk = false } = {}) {
  const r = RULES.submission;
  const mvs = verification.mvs ?? { total: 0, passed: 0 };
  const review = verification.review ?? {};
  const confidence = reviewConfidence(review);
  const cov = coverage(verification);
  const checks = {
    mvs_pass: mvs.total >= mvsRequired && mvs.passed === mvs.total,
    coverage_ok: cov >= r.minCoverage,
    confidence_ok: confidence >= r.minConfidence,
    regression_ok: clamp01(review.regressionRisk ?? 1) <= r.maxRegressionRisk,
    correctness_ok: clamp01(review.correctness ?? 0) >= r.minCorrectness,
    evidence_complete: evidenceOk && (verification.evidenceFiles?.length ?? 0) > 0,
  };
  return { approved: Object.values(checks).every(Boolean), checks, confidence, coverage: cov };
}
