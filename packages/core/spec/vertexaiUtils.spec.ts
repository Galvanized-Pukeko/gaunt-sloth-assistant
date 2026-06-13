import { describe, expect, it } from 'vitest';
import { enhanceVertexUnauthorizedMessage, isVertexGoogleLlm } from '#src/utils/vertexaiUtils.js';

const vertexLlm = { _platform: 'gcp' };
const genAiLlm = { _platform: 'gai' };

describe('isVertexGoogleLlm', () => {
  it('returns true only for gcp-platform models', () => {
    expect(isVertexGoogleLlm(vertexLlm)).toBe(true);
    expect(isVertexGoogleLlm(genAiLlm)).toBe(false);
    expect(isVertexGoogleLlm(null)).toBe(false);
    expect(isVertexGoogleLlm('not-an-llm')).toBe(false);
  });
});

describe('enhanceVertexUnauthorizedMessage', () => {
  it('appends the reauth hint for HTTP 401 / unauthorized errors', () => {
    expect(enhanceVertexUnauthorizedMessage('Got 401 from endpoint', vertexLlm)).toContain(
      'gcloud auth application-default login'
    );
    expect(enhanceVertexUnauthorizedMessage('Request unauthorized', vertexLlm)).toContain(
      'Vertex AI authentication failed.'
    );
  });

  it('appends the reauth hint for expired ADC credential errors (invalid_grant / invalid_rapt)', () => {
    const adcReauthError =
      'Agent processing failed: {"error":"invalid_grant",' +
      '"error_description":"reauth related error (invalid_rapt)",' +
      '"error_subtype":"invalid_rapt"}';

    const enhanced = enhanceVertexUnauthorizedMessage(adcReauthError, vertexLlm);

    expect(enhanced).toContain(adcReauthError);
    expect(enhanced).toContain('gcloud auth application-default login');
  });

  it('leaves the message untouched for non-vertex models', () => {
    const message = 'invalid_grant reauth related error';
    expect(enhanceVertexUnauthorizedMessage(message, genAiLlm)).toBe(message);
  });

  it('leaves unrelated errors untouched even on vertex', () => {
    const message = 'Model returned an empty response.';
    expect(enhanceVertexUnauthorizedMessage(message, vertexLlm)).toBe(message);
  });
});
