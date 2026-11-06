/* electron/backend.js WORKFLOW_FIELDS is the authority; this list mirrors it for the general order form. */
export const FORM_WORKFLOW_FIELDS = ['workflow', 'customerConfirmation', 'productionAuthorization', 'stopInfo', 'settlement', 'cancellation', 'approvedAt', 'managerOverrideDebt', 'onHold', 'holdReason', 'pricing', 'quoteHistory'];

export function withoutWorkflowWrites(next, previous) {
  const out = { ...next };
  for (const key of FORM_WORKFLOW_FIELDS) {
    delete out[key];
    if (previous && Object.prototype.hasOwnProperty.call(previous, key)) out[key] = previous[key];
  }
  return out;
}
