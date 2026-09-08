/**
 * [[EXT-159]] — the shared taxonomy's own rules.
 *
 * The per-site cells live in `GthAgentRunnerTermination.spec.ts`,
 * `GthAbstractAgentTermination.spec.ts` and `GthLeanMiddlewareTermination.spec.ts`, each driven
 * through the site it covers. What is left over — and belongs here — are the properties of the
 * vocabulary itself: that retryability is two facts rather than one, that the context-overflow
 * predicate is the typed class and not the asymmetric error code, that the substring fallback
 * survives a provider rewording its 400, and that the reason travels on a thrown error.
 *
 * CFG-73 adds the precedence between those last two: a committed reason outranks the text, so the
 * feeder obeys the rule this module states for every consumer instead of exempting itself. The
 * substring arms are what an unclassified error still gets, and their ordering is pinned here too —
 * it was examined and kept, and nothing made undoing it fail.
 */
import { describe, expect, it } from 'vitest';
import { ContextOverflowError, addLangChainErrorFields } from '@langchain/core/errors';
import {
  attachTerminationReason,
  classifyThrownTermination,
  isContextOverflow,
  terminationPosture,
  terminationReason,
  terminationReasonOf,
  type GthTerminationCategory,
} from '#src/core/terminationReason.js';

describe('[[EXT-159]] retryability is two facts, not a boolean', () => {
  /**
   * The measured case the whole shape exists for. `@langchain/core` stamps `ContextOverflowError`
   * non-retryable in its own constructor — correct for "send the same prompt again" and exactly
   * backwards for the remedy this cause actually has, which is to send a smaller one. Collapse the
   * two into one boolean and the first honest consumer of `getRetryable()` correctly refuses to do
   * the thing autocompaction exists to do.
   */
  it('context overflow is not retryable as-is but IS retryable after reducing context', () => {
    const posture = terminationPosture('context_overflow');
    expect(posture.retryableAsIs).toBe(false);
    expect(posture.retryableAfterRemedy).toBe(true);
    expect(posture.remedy).toBe('reduce-context');
  });

  /** The two facts genuinely differ somewhere, or the pair is a boolean wearing two names. */
  it('at least one category differs between the two facts', () => {
    const categories: GthTerminationCategory[] = [
      'context_overflow',
      'rate_limited',
      'content_refusal',
      'suspended',
    ];
    for (const category of categories) {
      const posture = terminationPosture(category);
      expect(posture.retryableAsIs).toBe(false);
      expect(posture.retryableAfterRemedy).toBe(true);
    }
  });

  /** And a category that IS retryable as-is exists, or the first fact is a constant. */
  it('a transient provider fault is retryable as-is', () => {
    expect(terminationPosture('provider_error').retryableAsIs).toBe(true);
    expect(terminationPosture('empty_response').retryableAsIs).toBe(true);
  });

  /**
   * A named remedy is what makes the second fact actionable. `retryableAfterRemedy: true` with no
   * remedy tells a consumer that something would help without saying what.
   */
  it('every remedy-retryable category names its remedy, and no other category names one', () => {
    const categories: GthTerminationCategory[] = [
      'completed',
      'empty_response',
      'content_refusal',
      'output_truncated',
      'context_overflow',
      'rate_limited',
      'auth_failed',
      'invalid_request',
      'provider_error',
      'network_error',
      'timeout',
      'cancelled',
      'approval_stop',
      'tool_error_budget',
      'tool_loop_guard',
      'interrupt_drain_guard',
      'tool_error',
      'suspended',
      'recursion_limit',
      'abandoned',
      'unknown',
    ];
    for (const category of categories) {
      const posture = terminationPosture(category);
      expect(posture.remedy === undefined).toBe(!posture.retryableAfterRemedy);
    }
  });

  /**
   * [[EXT-82]]'s ruling, held by the table rather than by each consumer: a 400 is never retried,
   * and a 429 is a different case with a remedy of its own.
   */
  it('a rejected request offers no retry, while a rate limit offers back-off', () => {
    expect(terminationPosture('invalid_request')).toEqual({
      retryableAsIs: false,
      retryableAfterRemedy: false,
    });
    expect(terminationPosture('rate_limited').remedy).toBe('back-off');
  });

  /**
   * The interrupt drain's own bound is NOT the graph's recursion limit. They are different bounds
   * owned by different layers with different knobs, and `recursion_limit`'s own meaning is that
   * the graph hit its limit — which, at the drain, did not happen. Reporting one for the other
   * would be the false-category defect this taxonomy exists to remove, so it is a member of its
   * own and `site` separates the two surfaces it has.
   */
  it('the interrupt-drain bound is its own member, distinct from the graph recursion limit', () => {
    expect(terminationPosture('interrupt_drain_guard')).toEqual({
      retryableAsIs: false,
      retryableAfterRemedy: true,
      remedy: 'change-request',
    });
    expect(
      terminationReason('runner.interrupt-guard-exhausted', 'control', 'interrupt_drain_guard')
    ).toMatchObject({ category: 'interrupt_drain_guard' });
  });

  /** Unclassified is not "probably fine": nothing is known, so nothing is offered. */
  it('unknown offers nothing', () => {
    expect(terminationPosture('unknown')).toEqual({
      retryableAsIs: false,
      retryableAfterRemedy: false,
    });
  });

  /** A site cannot invent a posture: the builder fills it from the one table. */
  it('the builder fills posture from the table, never from its caller', () => {
    const reason = terminationReason('runner.turn-error', 'exception', 'context_overflow');
    expect(reason).toMatchObject({
      category: 'context_overflow',
      site: 'runner.turn-error',
      source: 'exception',
      ...terminationPosture('context_overflow'),
    });
  });
});

describe('[[EXT-159]] the exception feeder', () => {
  /**
   * The predicate is `ContextOverflowError.isInstance`, never `lc_error_code`. The code is set
   * asymmetrically — Anthropic stamps both the class and the code, OpenAI only the class — so a
   * detector keyed on the code silently misses openai, xai, deepseek and huggingface, which is
   * most of where the typed class actually works.
   */
  it('detects a typed ContextOverflowError that carries NO lc_error_code', () => {
    const openaiShape = new ContextOverflowError('This model supports at most 4096 tokens');
    expect((openaiShape as unknown as { lc_error_code?: string }).lc_error_code).toBeUndefined();

    expect(isContextOverflow(openaiShape)).toBe(true);
    expect(classifyThrownTermination(openaiShape).category).toBe('context_overflow');
  });

  it('detects the Anthropic shape, which carries the code as well as the class', () => {
    const anthropicShape = addLangChainErrorFields(
      new ContextOverflowError('prompt is too long'),
      'CONTEXT_OVERFLOW'
    );
    expect(classifyThrownTermination(anthropicShape).category).toBe('context_overflow');
  });

  /**
   * LangChain's own detection is substring matching on the provider's English prose, so a provider
   * rewording its 400 drops the typed class with nothing going red. Our detector sits BESIDE it
   * with its own fallback rather than deferring to it — this cell is that fallback, on a plain
   * `Error` no LangChain provider ever typed.
   */
  it('falls back to its own prose match when the typed class is absent', () => {
    const untypedFromAProviderWeDoNotType = new Error(
      'This request would exceed the context window for this model (400 invalid_request_error)'
    );
    expect(ContextOverflowError.isInstance(untypedFromAProviderWeDoNotType)).toBe(false);

    expect(classifyThrownTermination(untypedFromAProviderWeDoNotType).category).toBe(
      'context_overflow'
    );
  });

  /** A context overflow is also an HTTP 400; the typed case must not be eaten by the status rule. */
  it('prefers context overflow over the 400 that carries it', () => {
    const error = Object.assign(new Error('context_length_exceeded'), { status: 400 });
    expect(classifyThrownTermination(error).category).toBe('context_overflow');
  });

  it.each([
    ['a 429 status', Object.assign(new Error('slow down'), { status: 429 }), 'rate_limited'],
    ['rate-limit prose', new Error('Rate limit reached for gpt-4'), 'rate_limited'],
    ['a 401', Object.assign(new Error('nope'), { status: 401 }), 'auth_failed'],
    ['invalid-key prose', new Error('Incorrect API key provided'), 'auth_failed'],
    ['a 503', Object.assign(new Error('down'), { status: 503 }), 'provider_error'],
    [
      'a provider-side internal error',
      new Error('Internal error during token generation'),
      'provider_error',
    ],
    ['a socket failure', new Error('socket hang up'), 'network_error'],
    ['a deadline', new Error('Request timed out'), 'timeout'],
    ['a graph recursion limit', new Error('Recursion limit of 25 reached'), 'recursion_limit'],
    ['an abort', Object.assign(new Error('x'), { name: 'AbortError' }), 'cancelled'],
    ['a tool exception', Object.assign(new Error('x'), { name: 'ToolException' }), 'tool_error'],
    ['a graph suspend', Object.assign(new Error('x'), { name: 'GraphInterrupt' }), 'suspended'],
    ['a plain 400', Object.assign(new Error('bad'), { status: 400 }), 'invalid_request'],
  ])('classifies %s', (_label, error, expected) => {
    expect(classifyThrownTermination(error).category).toBe(expected);
  });

  /**
   * `detail` is documented as the raw token the classification was made from, so it must state the
   * status the response actually had. A non-500 status whose prose matches the invalid-request
   * patterns reaches that branch too — it is past the 429/401/403/408/5xx arms — and stamping a
   * flat `'400'` on one would put a false statement in the field that exists to record what was
   * seen. The 400 case is the control: it must keep reporting 400.
   */
  it('records the status an invalid request actually carried, not a flat 400', () => {
    const conflict = Object.assign(new Error('invalid request: already exists'), { status: 409 });
    expect(classifyThrownTermination(conflict)).toMatchObject({
      category: 'invalid_request',
      detail: '409',
    });

    const realBadRequest = Object.assign(new Error('bad'), { status: 400 });
    expect(classifyThrownTermination(realBadRequest)).toMatchObject({
      category: 'invalid_request',
      detail: '400',
    });
  });

  /**
   * CFG-73 — the arm ordering, pinned so that undoing it reds.
   *
   * `status === 400` deliberately sits BEHIND the specific-cause prose arms instead of up with the
   * other status codes, and that is the ordering CFG-73 examined and kept. 400 is a bucket rather
   * than a cause: providers return it for a bad API key, an expired grant and an exhausted quota
   * alike, and the prose is the only thing that tells those apart. Lifting the status would collapse
   * all three into `invalid_request`, whose posture names no remedy at all — so a user holding a
   * wrong key would be told there is nothing to be done, instead of `fix-credentials`.
   *
   * Nothing covered this before. The table's `'a plain 400'` case carries no specific-cause prose,
   * and the context-overflow-in-a-400 case is settled by the typed arm long before the status is
   * consulted — so a reorder passed the whole suite silently.
   */
  it.each([
    ['a bad key Google returns as a 400', 'API key not valid. Please pass a valid API key.'],
    ['an OAuth grant that expired', 'invalid_grant: token has been expired or revoked'],
  ])('keeps %s out of the invalid-request bucket', (_label, message) => {
    const error = Object.assign(new Error(message), { status: 400 });
    expect(classifyThrownTermination(error).category).toBe('auth_failed');
    // The remedy is what the ordering protects: `invalid_request` names none.
    expect(terminationPosture('auth_failed').remedy).toBe('fix-credentials');
    expect(terminationPosture('invalid_request').remedy).toBeUndefined();
  });

  it('keeps a quota refusal carried in a 400 out of the invalid-request bucket', () => {
    const error = Object.assign(new Error('Quota exceeded for this project'), { status: 400 });
    expect(classifyThrownTermination(error).category).toBe('rate_limited');
    expect(terminationPosture('rate_limited').remedy).toBe('back-off');
  });

  /** The payload SDKs nest under `error` / `response` is read, not only the top-level message. */
  it('reads a nested provider payload', () => {
    const error = { response: { status: 429 }, message: 'request failed' };
    expect(classifyThrownTermination(error).category).toBe('rate_limited');
  });

  /**
   * "Nothing matched" is recorded as such rather than guessed at, and classification never becomes
   * the thing that breaks a run that was already failing.
   */
  it('reports `unknown` rather than guessing, and never throws', () => {
    expect(classifyThrownTermination(new Error('something went sideways')).category).toBe(
      'unknown'
    );
    expect(classifyThrownTermination(undefined).category).toBe('unknown');
    expect(classifyThrownTermination(Object.create(null)).category).toBe('unknown');
    const hostile = new Proxy(
      {},
      {
        get() {
          throw new Error('nope');
        },
      }
    );
    expect(() => classifyThrownTermination(hostile)).not.toThrow();
  });
});

describe('[[CFG-73]] a committed reason outranks the prose', () => {
  /** The provider rejection Groq returns for a `file` part, in its own words. */
  const REJECTION =
    '400 status code (no body) {"error":{"message":"messages.4.content.1 : expected one of ' +
    "'text', 'image_url', 'document'\",\"type\":\"invalid_request_error\"}}";

  /**
   * The note the binary-attachment middleware prepends, with the classification already committed.
   *
   * This is the measured shape, not an invented one: the note names the file so the user can see
   * which one was refused, and the filename is data nobody in the tree controls.
   */
  function rejectionNoting(fileName: string): Error {
    const error: Error & { status?: number } = new Error(
      `The provider "groq" would not accept this request. It carried the attachment ${fileName}, ` +
        `which gth_read_binary read and added to that one request only. ${REJECTION}`
    );
    error.status = 400;
    return attachTerminationReason(
      error,
      terminationReason('middleware.binary-attachment-rejected', 'exception', {
        category: 'invalid_request',
        provider: 'groq',
        detail: '400',
      })
    );
  }

  /**
   * THE PIN. Six of seven ordinary filenames flipped the category of a rejection that classified
   * `invalid_request` before the name was interpolated, and every category they flipped it to is a
   * retryable posture — so the user was told to send again a request the provider refuses
   * identically every time, and an overflow-matching name sent the runner off to compact first.
   *
   * Each case proves its own text is genuinely hostile before asserting the fix, by stripping the
   * committed reason and watching the feeder answer the other category. Without that half the
   * assertion could pass on a message that never carried the token at all.
   */
  it.each([
    ['api-timeout-investigation.pdf', 'timeout'],
    ['contract - terminated.pdf', 'network_error'],
    ['forbidden-zones-map.pdf', 'auth_failed'],
    ['rate limit escalation.pdf', 'rate_limited'],
    ['internal error postmortem.pdf', 'provider_error'],
    ['prompt is too long - notes.pdf', 'context_overflow'],
  ])('%s no longer reads back as %s', (fileName, wouldHaveBeen) => {
    const annotated = rejectionNoting(fileName);

    // The same text with nothing committed: this is what the feeder used to answer, and it is what
    // makes the assertion below capable of failing.
    expect(classifyThrownTermination(new Error(annotated.message)).category).toBe(wouldHaveBeen);

    expect(classifyThrownTermination(annotated).category).toBe('invalid_request');
  });

  /**
   * A committed reason outranks a status code and a typed class too, not only prose.
   *
   * Both of those are evidence ABOUT the failure; a committed reason is a classification OF it,
   * made by a site that watched it happen. Ranking them in tiers — typed beats committed, prose
   * does not — is a precedence nobody could hold in their head, and `attachTerminationReason` is
   * already first-write-wins, so the earliest site is the truest one by construction. The typed
   * case here is real: pressing Esc during a turn that would also have overflowed ends the run
   * because the user stopped it, and `cancelled` is the honest answer.
   */
  it('outranks a status code and a typed class, not only prose', () => {
    const rateLimitShape = Object.assign(new Error('slow down'), { status: 429 });
    attachTerminationReason(
      rateLimitShape,
      terminationReason('runner.turn-error', 'exception', 'tool_error')
    );
    expect(classifyThrownTermination(rateLimitShape).category).toBe('tool_error');

    const overflowShape = new ContextOverflowError('prompt is too long');
    attachTerminationReason(
      overflowShape,
      terminationReason('agent.stream-cancelled', 'control', 'cancelled')
    );
    expect(classifyThrownTermination(overflowShape).category).toBe('cancelled');
  });

  /**
   * The provider and the detail travel with the category, and nothing else does: a classification
   * is `{category, provider?, detail?}`, and the site and source belong to whoever attaches one.
   */
  it('carries the committed provider and detail through, and adds nothing of its own', () => {
    const error = new Error('socket hang up');
    attachTerminationReason(
      error,
      terminationReason('middleware.binary-attachment-rejected', 'exception', {
        category: 'invalid_request',
        provider: 'groq',
        detail: '400',
      })
    );

    expect(classifyThrownTermination(error)).toEqual({
      category: 'invalid_request',
      provider: 'groq',
      detail: '400',
    });
  });

  /**
   * Consumers read a committed reason through {@link terminationReasonOf}, which follows one cause
   * link — so the feeder follows the same one. Any other answer would let the two disagree about a
   * wrapped failure, which is the whole class of defect this taxonomy exists to remove.
   */
  it('follows the same cause link its consumers do', () => {
    const inner = new Error('the real fault');
    attachTerminationReason(
      inner,
      terminationReason('runner.stream-error', 'exception', 'auth_failed')
    );
    const wrapper = new Error('Agent processing failed: the request timed out', { cause: inner });

    expect(classifyThrownTermination(wrapper).category).toBe('auth_failed');
    expect(terminationReasonOf(wrapper)?.category).toBe('auth_failed');
  });

  /**
   * Fail-soft on the shape. The reason rides on an ordinary non-enumerable property, so anything
   * could be parked there; a value carrying no category must fall back to the text rather than
   * become a category the taxonomy does not define.
   */
  it('falls back to the text when what is parked on the property is not a reason', () => {
    const error = new Error('Request timed out');
    Object.defineProperty(error, 'gthTerminationReason', {
      value: { site: 'runner.turn-error' },
      enumerable: false,
      configurable: true,
    });

    expect(classifyThrownTermination(error).category).toBe('timeout');
  });
});

describe('[[EXT-159]] the reason travels on a thrown error', () => {
  it('attaches without widening what the error serialises to', () => {
    const error = new Error('boom');
    attachTerminationReason(error, terminationReason('runner.turn-error', 'exception', 'timeout'));

    expect(terminationReasonOf(error)).toMatchObject({ category: 'timeout' });
    // Non-enumerable: a logged or JSON-stringified error keeps exactly the shape it had.
    expect(Object.keys(error)).not.toContain('gthTerminationReason');
    expect(JSON.stringify({ ...error })).not.toContain('timeout');
  });

  /** First-write-wins: a re-throw through an outer wrapper cannot overwrite the truer inner one. */
  it('keeps the first reason attached', () => {
    const error = new Error('boom');
    attachTerminationReason(
      error,
      terminationReason('runner.stream-error', 'exception', 'rate_limited')
    );
    attachTerminationReason(error, terminationReason('runner.turn-error', 'exception', 'unknown'));

    expect(terminationReasonOf(error)).toMatchObject({ site: 'runner.stream-error' });
  });

  /** A wrapper that kept the original as its `cause` still answers for it. */
  it('follows a cause link', () => {
    const inner = new Error('the real fault');
    attachTerminationReason(
      inner,
      terminationReason('runner.stream-error', 'exception', 'provider_error')
    );
    const wrapper = new Error('Agent processing failed: the real fault', { cause: inner });

    expect(terminationReasonOf(wrapper)).toMatchObject({ category: 'provider_error' });
  });

  it('is a no-op on a value that cannot carry one', () => {
    expect(() =>
      attachTerminationReason(
        'a string throw',
        terminationReason('runner.turn-error', 'exception', 'unknown')
      )
    ).not.toThrow();
    expect(terminationReasonOf('a string throw')).toBeUndefined();
    expect(terminationReasonOf(undefined)).toBeUndefined();
  });
});
