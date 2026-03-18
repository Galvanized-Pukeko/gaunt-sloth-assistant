export function isVertexGoogleLlm(llm: unknown): boolean {
  if (!llm || typeof llm !== 'object') {
    return false;
  }
  const model = llm as { _platform?: string };
  return model._platform === 'gcp';
}

export function enhanceVertexUnauthorizedMessage(originalMessage: string, llm: unknown): string {
  if (!isVertexGoogleLlm(llm) || !/\b401\b|unauthori[sz]ed/i.test(originalMessage)) {
    return originalMessage;
  }

  return (
    `${originalMessage}\n` +
    'Vertex AI authentication failed (401). ' +
    'If you use ADC, run `gcloud auth application-default login`. ' +
    'Also make sure `GOOGLE_API_KEY` is unset or not a Google AI Studio key, ' +
    'since AI Studio keys are not valid for Vertex AI endpoints.'
  );
}
