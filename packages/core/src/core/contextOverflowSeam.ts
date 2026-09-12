/**
 * [[EXT-160]] / [[EXT-167]] / [[EXT-174]] — **the one compact-and-retry seam, for every surface that
 * drives the agent.**
 *
 * A provider that rejects a turn for size is recovered the same way everywhere: classify the
 * failure through the termination taxonomy, fold the older conversation into a summary, and ask the
 * model again once with the smaller context. What an overflow *means* and how many retries it is
 * worth is decided here and nowhere else, so the surfaces cannot come to disagree about it.
 *
 * **Why this is a module and not a method of the runner.** The decision was written as
 * `GthAgentRunner.handleContextOverflow`, which suited the three surfaces that drive the agent
 * through the runner — the readline session, the Ink TUI and the ACP editor integrations — and
 * could not reach the fourth. The AG-UI server drives the agent's own stream directly, and routing
 * it through the runner's typed-event driver is not a small change: that driver closes every tool
 * call it saw start and never saw end with an error result, which is right for a call the approval
 * gate declined and wrong for a call the graph suspended for the *browser* to fulfil; it drains
 * pending approval interrupts through the runner's own gate, which that server leaves parked; and
 * it drives one runner-owned thread where the server rotates a checkpoint thread per request. So
 * the seam is what moves, not the server: the runner's private method now delegates here, and the
 * server calls the same functions with its own agent, thread and model.
 *
 * The host is a plain object rather than an interface the caller implements, because the two
 * callers hold the same four things under different names — the runner as fields, the server as
 * request-scoped locals — and neither should have to grow a class to hand them over.
 */
import type { RunnableConfig } from '@langchain/core/runnables';
import type { AgentStreamEvent, GthAgentInterface, StatusUpdateCallback } from '#src/core/types.js';
import { StatusLevel } from '#src/core/types.js';
import {
  compactMessages,
  conversationSize,
  createModelSummarizer,
  DEFAULT_KEEP_RECENT,
  type CompactConversationOptions,
  type ConversationCompaction,
  type SummarizingModel,
} from '#src/core/compaction.js';
import {
  classifyThrownTermination,
  replaceTerminationReason,
  terminationPosture,
  terminationReason,
  terminationReasonOf,
  type GthTerminationReason,
} from '#src/core/terminationReason.js';
import { terminationLogLine } from '#src/core/terminationNotice.js';
import { debugLog, debugLogError } from '#src/utils/debugUtils.js';

/**
 * What the seam needs from the surface that hit the overflow.
 *
 * The first four are the turn itself: the agent whose state is folded, the thread it was driven
 * on, the model that writes the summary, and the channel the one-line notices go to. The two hooks
 * are for a host that keeps a termination reason of its own beside the agent's (the runner does;
 * the AG-UI server reads the reason off the error and the agent, and passes neither).
 */
export interface ContextOverflowSeamHost {
  /** The agent whose conversation overflowed; the compaction reads and rewrites its state. */
  agent: GthAgentInterface;
  /** The thread the failed attempt was driven on — the same `runConfig`, so the retry continues it. */
  runConfig: RunnableConfig;
  /** The model that writes the summary — the run's own `config.llm`. */
  model: SummarizingModel;
  /** Where the seam's one-line notices go. */
  statusUpdate: StatusUpdateCallback;
  /**
   * Called with the reason the seam decided, AFTER it has been stamped on the error, for a host
   * that carries a reason field of its own. The two carriers move together so a host's field and
   * the error it is about can never disagree. Fail-soft: a hook that throws changes nothing.
   */
  onTerminationOverridden?: (reason: GthTerminationReason) => void;
  /**
   * Called once a retry is decided, AFTER the agent's own reason has been reset, for a host that
   * keeps reason state of its own: the retry is a fresh attempt and owes its own reason, so the
   * failed attempt's must not be read later as the retry's. Fail-soft.
   */
  onRetry?: () => void;
}

/**
 * [[EXT-160]] — the read-compact-write itself, with **no turn-state guards**: the shared internal
 * behind both the idle `/compact` (`GthAgentRunner.compactConversation`, which adds the guards) and
 * the involuntary compact-and-retry inside a turn.
 *
 * It exists because the idle seam's guards are exactly wrong for the involuntary case. That method
 * refuses while a turn is in flight, and the overflow seam runs inside the driver's `catch`, where
 * the turn it is recovering is still counted in — so calling the public method from there throws
 * every time. The alternative was for the seam to compose `compactMessages` with
 * `replaceConversationMessages` itself, which is the same six steps written twice: two places to
 * keep the summariser, the keep-recent default, the read-back and the `changed: false` shape in
 * agreement. One implementation with the guards on the caller that needs them is the version that
 * cannot drift.
 *
 * **The pending-approval guard is dropped here too, and that is deliberate rather than an
 * oversight.** `/compact` refuses under a pending approval because the user is mid-decision about a
 * tool call, and folding the conversation under them would rewrite the history that decision is
 * being made against. The involuntary path cannot be in that position: it runs from the `catch` of
 * a model call that threw, and a model call that threw produced no tool call, so there is no new
 * interrupt to answer. An approval raised EARLIER in the same turn has already been resolved — the
 * driver resolves interrupts in a loop before the model is asked again — so by the time an overflow
 * can be caught, there is nothing pending for the guard to protect.
 */
export async function applyConversationCompaction(
  host: Pick<ContextOverflowSeamHost, 'agent' | 'runConfig' | 'model'>,
  options: CompactConversationOptions = {}
): Promise<ConversationCompaction> {
  const { agent, runConfig } = host;
  if (!agent.getConversationMessages || !agent.replaceConversationMessages) {
    throw new Error(
      'This agent does not expose its conversation state, so it cannot be compacted.'
    );
  }
  const keepRecent = options.keepRecent ?? DEFAULT_KEEP_RECENT;
  const messages = await agent.getConversationMessages(runConfig);
  const before = conversationSize(messages);
  const result = await compactMessages({
    messages,
    summarize: createModelSummarizer(host.model),
    keepRecent,
    ...(options.focus !== undefined ? { focus: options.focus } : {}),
  });
  if (!result.changed) {
    return {
      changed: false,
      removedCount: 0,
      keptCount: messages.length,
      keepRecent,
      summaryText: '',
      before,
      after: before,
    };
  }
  await agent.replaceConversationMessages(runConfig, result.messages);
  const after = conversationSize(await agent.getConversationMessages(runConfig));
  debugLog(
    `Compacted the conversation: ${result.removedCount} folded, ${result.keptCount} kept, ` +
      `${before.messages}→${after.messages} messages, ${before.characters}→${after.characters} chars`
  );
  return {
    changed: true,
    removedCount: result.removedCount,
    keptCount: result.keptCount,
    keepRecent,
    summaryText: result.summaryText,
    before,
    after,
  };
}

/**
 * [[EXT-160]] — **decide what a thrown turn's context overflow means, and act on it once.**
 *
 * Returns the compaction when the conversation was made smaller and the turn is worth attempting
 * again; `null` for everything else, including every failure that is not an overflow at all, in
 * which case the caller's existing error path runs untouched. The string driver reads it as a
 * boolean; the typed-event drivers ([[EXT-167]], [[EXT-174]]) also hand the numbers to their
 * consumer.
 *
 * **The predicate is the taxonomy's, never a private one.** The category comes from the reason an
 * inner site already attached, or failing that from `classifyThrownTermination`, and the decision
 * is `remedy === 'reduce-context'` read out of the one POSTURE table. That is what makes this the
 * same fact [[EXT-159]] surfaces rather than a second opinion about it — and it is why an
 * `output_truncated` turn is not compacted here: the answer was cut off against the output cap, its
 * remedy is `change-request`, and folding the history would not add a single token of room to the
 * part that ran out. `context_overflow` is also the one category whose posture separates the two
 * facts this function depends on: retrying the SAME prompt is hopeless (`retryableAsIs: false`,
 * which is what `ContextOverflowError.getRetryable()` says too) while retrying a SMALLER one is the
 * whole move (`retryableAfterRemedy: true`).
 *
 * **One retry, and the reasons a compaction can decline.** A second overflow after the history has
 * already been folded is not worth a second fold — the tail it just kept is what the next
 * compaction would have to eat — so `attempt > 0` terminates at its own site. So does a compaction
 * that had nothing to fold, could not get a summary, or found an agent with no conversation state:
 * each is "the automatic remedy was tried and had nothing to give", which is a different fact from
 * "the model said no" and deserves to be said in its own words.
 *
 * The original overflow error is what surfaces in every declining branch. A compaction that throws
 * has its own failure logged and dropped rather than re-thrown, because replacing a diagnosis the
 * whole node exists to preserve with a summariser's stack trace buries the one useful thing the turn
 * produced.
 *
 * The sites this stamps are named `runner.…` on every host, including one that is not a runner:
 * a site names the seam that classified the failure, not the surface that showed it, and the seam
 * is one thing wherever it is called from.
 */
export async function handleContextOverflow(
  error: unknown,
  attempt: number,
  host: ContextOverflowSeamHost
): Promise<ConversationCompaction | null> {
  const category =
    terminationReasonOf(error)?.category ?? classifyThrownTermination(error).category;
  if (terminationPosture(category).remedy !== 'reduce-context') return null;

  if (attempt > 0) {
    overrideTerminationReason(
      host,
      error,
      terminationReason('runner.overflow-compact-exhausted', 'exception', {
        category: 'context_overflow',
        detail: 'overflowed again after compaction',
      })
    );
    host.statusUpdate(
      StatusLevel.WARNING,
      'The context overflowed again after compacting, so this turn was ended. Start a new ' +
        'conversation, or narrow what this turn is asking for.'
    );
    return null;
  }

  // An agent that exposes no conversation state cannot be compacted at ALL, which is a different
  // fact from a compaction that ran and had nothing to give — and only the second is something
  // this seam knows. So nothing is overridden here: the wrapper's own classification is the
  // truest thing anyone has, and claiming the remedy was tried would be false.
  const agent = host.agent;
  if (!agent.getConversationMessages || !agent.replaceConversationMessages) {
    debugLog(
      'Context overflow: this agent exposes no conversation state, so it cannot be compacted.'
    );
    return null;
  }

  let compaction: ConversationCompaction;
  try {
    compaction = await applyConversationCompaction(host);
  } catch (compactionError) {
    debugLogError('Compacting after a context overflow', compactionError);
    compaction = { changed: false } as ConversationCompaction;
  }
  if (!compaction.changed) {
    overrideTerminationReason(
      host,
      error,
      terminationReason('runner.overflow-compact', 'exception', {
        category: 'context_overflow',
        detail: 'nothing left to compact',
      })
    );
    host.statusUpdate(
      StatusLevel.WARNING,
      'The context overflowed and there was nothing left to compact, so this turn was ended. ' +
        'Start a new conversation, or narrow what this turn is asking for.'
    );
    return null;
  }

  // [[TUI-C108]] — **INFO, so a quieted console does not see the fold.** Kept deliberately, on the
  // same reasoning as the proactive twin in `GthLangChainAgent`'s `onCompact`: in
  // `defaultStatusCallback` the level also picks the colour and the channel, so DISPLAY would
  // restyle this notice for every default-level user as a side effect of making it survive at
  // `consoleLevel: "display"`. The honest fix is to let a level be raised without changing how the
  // line looks, which is a change to the status bus, not to this call.
  //
  // The gap is real and worth naming rather than leaving for someone to rediscover: the
  // nothing-left-to-compact branch above is a WARNING and survives, so today the ladder reports a
  // context fold only when the fold FAILED — the successful one, which quietly changes what the
  // model can still see, is the one that goes silent.
  host.statusUpdate(
    StatusLevel.INFO,
    `The context overflowed, so ${compaction.removedCount} earlier messages were folded into a ` +
      `summary (${compaction.before.messages}→${compaction.after.messages} messages). Retrying.`
  );
  // The retry is a fresh attempt and owes its own reason: the failed attempt's provider finish
  // reasons go with it rather than being read later as the retry's. The agent's carrier is reset
  // here for every host; a host with a carrier of its own resets it in the hook.
  try {
    agent.resetTerminationReason?.();
    host.onRetry?.();
  } catch (e) {
    debugLogError('resetting the termination reason before the overflow retry', e);
  }
  return compaction;
}

/**
 * [[EXT-167]] / [[EXT-174]] — **one attempt at a typed-event turn, and the single retry around
 * it.** The generator form of the seam, for a driver that yields {@link AgentStreamEvent}s: catch,
 * decide through {@link handleContextOverflow}, announce the fold in-band, and run the turn again
 * once.
 *
 * `attemptTurn` is asked for the attempt's own stream. It is called with `0` for the turn the user
 * asked for and `1` for the single retry, and **the retry must continue the thread from its state
 * with no new input** — the user's message is already in the graph's state (the input step commits
 * before the model step throws), so re-sending it would append a second copy of the same turn.
 * That is why the caller, not this function, chooses the input: only the caller knows whether the
 * first attempt was a fresh turn, a resume of a suspended graph, or a resume with queued messages,
 * and all three continue the same way, with an empty message list on the same thread.
 *
 * **The retry is a continuation, not a replay.** Resuming from state means the tool calls the
 * failed attempt already announced — and whose results are already in the graph — are what the
 * model picks up from; nothing the consumer painted is redone. That is what makes the
 * `context_compacted` event yielded between the two attempts honest: it marks the point in the
 * turn where the history behind the model got shorter, and everything either side of it stands.
 *
 * A second overflow declines at the seam (`attempt > 0`) and is then re-thrown UNCHANGED: the seam
 * has already stamped the exhausted site on the error, so whoever classifies it next inherits that
 * rather than overwriting it.
 */
export async function* retryEventTurnOnContextOverflow(
  attemptTurn: (attempt: number) => AsyncGenerator<AgentStreamEvent>,
  host: ContextOverflowSeamHost,
  attempt = 0
): AsyncGenerator<AgentStreamEvent> {
  try {
    yield* attemptTurn(attempt);
  } catch (error) {
    const compaction = await handleContextOverflow(error, attempt, host);
    if (!compaction) throw error;
    yield { type: 'context_compacted', cause: 'context_overflow', compaction };
    yield* retryEventTurnOnContextOverflow(attemptTurn, host, attempt + 1);
  }
}

/**
 * [[EXT-160]] — record a reason that OVERRIDES what an inner site already said, on both carriers.
 *
 * The runner's `noteTermination` is first-write-wins and its `classifyThrownAt` inherits, which is
 * right for the nested wrappers they serve: the inner site saw the failure first. The overflow seam
 * is the one site that legitimately knows better — it has watched the same turn overflow twice, or
 * watched the remedy come back empty, and the wrapper that classified the throw saw neither. The
 * error is re-stamped here, for every host, because it is the carrier every catcher outside the
 * driver reads; a host with a field of its own is handed the same value through its hook so the two
 * can never disagree.
 */
function overrideTerminationReason(
  host: ContextOverflowSeamHost,
  error: unknown,
  reason: GthTerminationReason
): void {
  try {
    replaceTerminationReason(error, reason);
    host.onTerminationOverridden?.(reason);
    debugLog(terminationLogLine(reason));
  } catch (e) {
    /* fail-soft: classification must never affect a run */
    debugLogError('recording the overflow seam termination reason', e);
  }
}
