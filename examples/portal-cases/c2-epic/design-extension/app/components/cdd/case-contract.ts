export interface CaseDesignBinding {
  caseId: 'c2' | 'c3';
  planId: string;
  contextHash: string;
  resultId: string;
  resultHash: string;
  captureFingerprint: string;
  rootNodeId: '1378:120';
}
export interface LandingRouteContract {
  authenticated: boolean;
  login: string;
  signup: string;
  notes: string;
  registration: { action: string; method: 'get' | 'post'; emailField: 'email' };
}
export function assertActualCaseDesignBinding(binding: CaseDesignBinding, actualPlan: { caseId: 'c2' | 'c3'; planId: string; contextHash: string }) {
  const hash = /^sha256:[a-f0-9]{64}$/u;
  if (binding.caseId !== actualPlan.caseId || binding.planId !== actualPlan.planId || binding.contextHash !== actualPlan.contextHash || !hash.test(binding.contextHash) || !hash.test(binding.resultHash) || !hash.test(binding.captureFingerprint) || !binding.resultId || binding.rootNodeId !== '1378:120') throw Error('ACTUAL_CASE_DESIGN_BINDING_REQUIRED');
  // This consistency check never replaces the service's actual lease/profile/capture authority.
}
