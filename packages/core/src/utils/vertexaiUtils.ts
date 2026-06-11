export function isVertexGoogleLlm(llm: unknown): boolean {
  if (!llm || typeof llm !== 'object') {
    return false;
  }
  const model = llm as { _platform?: string };
  return model._platform === 'gcp';
}

// Matches the auth failures Vertex AI / gcloud ADC surface:
//  - HTTP 401 / "unauthorized" (token rejected by the endpoint)
//  - OAuth "invalid_grant" with "invalid_rapt" subtype, or any "reauth" wording
//    (expired ADC credentials / reauth proof token — `gcloud auth ... login` needed)
const VERTEX_AUTH_ERROR_PATTERN = /\b401\b|unauthori[sz]ed|invalid_grant|invalid_rapt|reauth/i;

export function enhanceVertexUnauthorizedMessage(originalMessage: string, llm: unknown): string {
  if (!isVertexGoogleLlm(llm) || !VERTEX_AUTH_ERROR_PATTERN.test(originalMessage)) {
    return originalMessage;
  }

  return (
    `${originalMessage}\n\n` +
    'Vertex AI authentication failed. ' +
    'If you use ADC, run `gcloud auth login` and `gcloud auth application-default login`. ' +
    'Also make sure `GOOGLE_API_KEY` is unset or not a Google AI Studio key, ' +
    'since AI Studio keys are not valid for Vertex AI endpoints.\n'
  );
}
