/**
 * [[TUI-C105]] — capture the tool-display CONTROL BASELINE.
 *
 * This script renders a fixed corpus of tool calls through the **built** `dist/core/toolDisplay.js`
 * and writes the result to `packages/core/spec/fixtures/toolDisplayBaseline.json`, which
 * `spec/toolDisplayBaseline.spec.ts` then replays against the live `src/` implementation.
 *
 * WHY IT EXISTS: TUI-C105 makes the preview depth configurable. The whole risk of that change is
 * silently altering DEFAULT rendering for tools that were already in the display registry, so the
 * node's first acceptance criterion is a control — with no configuration, output is byte-identical
 * to what trunk produced. A baseline regenerated from the post-change build would be an assertion
 * that cannot fail, so this capture is run ONCE, against the pre-change build, and its output is
 * committed as a frozen artifact.
 *
 * **DO NOT re-run this to "fix" a red control.** A red control means either a real default-render
 * regression, or a deliberate registry change whose expected delta belongs in the spec's declared
 * exception list — never a stale fixture. The script is committed so the capture is reproducible
 * and auditable, not so the expectation can be refreshed on demand.
 *
 * Run from the repo root, after a build:
 *   node packages/core/scripts/capture-tool-display-baseline.mjs
 *
 * The corpus is written out INSIDE the fixture (each entry carries its own `input`), so the spec
 * replays exactly the inputs that were captured and the two cannot drift apart.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const distModule = resolve(here, '../dist/core/toolDisplay.js');
const outPath = resolve(here, '../spec/fixtures/toolDisplayBaseline.json');

const { summariseToolCall, buildToolPreviewLines, getToolGlyph } = await import(distModule);

/** A 12-line result: longer than the default 10-line cap, so the overflow marker is exercised. */
const TWELVE_LINES = Array.from(
  { length: 12 },
  (_, i) => `line-${String(i + 1).padStart(2, '0')}`
).join('\n');

/** The shared `<COMMAND_OUTPUT>` result shape every shell-shaped tool returns. */
const shellResult = (command, body, status) =>
  `Executing '${command}'\n\n<COMMAND_OUTPUT>\n${body}\n</COMMAND_OUTPUT>\n\n${status}`;

/**
 * The corpus: EVERY name in `TOOL_DISPLAY_REGISTRY` (the set whose rendering must not move), plus
 * an unregistered generic tool, an unregistered shell-shaped custom tool, the unparsable-args
 * frame, the no-args frame, and `gth_gh_read_file` — the tool this node adds to the registry, and
 * so the only name whose rendering is allowed to move at all.
 *
 * The registry is module-private, so this list is maintained by hand: a tool added to the registry
 * later is NOT automatically covered here, and should be added alongside it.
 */
const CORPUS = [
  {
    id: 'read_file',
    input: {
      name: 'read_file',
      argsText: '{"path":"notes/example.txt","offset":0,"limit":200}',
      result: TWELVE_LINES,
    },
  },
  {
    id: 'read_multiple_files',
    input: {
      name: 'read_multiple_files',
      argsText: '{"paths":["a/one.ts","a/two.ts"]}',
      result: 'a/one.ts:\nalpha\n\na/two.ts:\nbeta\n',
    },
  },
  {
    id: 'gth_read_binary',
    input: {
      name: 'gth_read_binary',
      argsText: '{"path":"assets/logo.png"}',
      result: 'Read 1 image (image/png).',
    },
  },
  {
    id: 'write_file',
    input: {
      name: 'write_file',
      argsText: '{"path":"src/new.ts","content":"export const a = 1;\\nexport const b = 2;\\n"}',
      result: 'Wrote 2 lines to src/new.ts',
    },
  },
  {
    id: 'write_file-error',
    input: {
      name: 'write_file',
      argsText: '{"path":"/etc/passwd","content":"nope\\n"}',
      result: "EACCES: permission denied, open '/etc/passwd'",
      isError: true,
    },
  },
  {
    id: 'edit_file',
    input: {
      name: 'edit_file',
      argsText:
        '{"path":"src/answer.ts","dryRun":false,"edits":[{"oldText":"const answer = 41;","newText":"const answer = 42;"},{"oldText":"// old","newText":"// new"}]}',
      result: 'edit 2: replaced 2 occurrence(s)',
    },
  },
  {
    id: 'create_directory',
    input: {
      name: 'create_directory',
      argsText: '{"path":"build/out"}',
      result: 'Created build/out',
    },
  },
  {
    id: 'list_directory',
    input: { name: 'list_directory', argsText: '{"path":"src"}', result: TWELVE_LINES },
  },
  {
    id: 'list_directory_with_sizes',
    input: {
      name: 'list_directory_with_sizes',
      argsText: '{"path":"src","sortBy":"size"}',
      result: '[FILE] index.ts  1.2 KB\n[DIR]  core',
    },
  },
  {
    id: 'directory_tree',
    input: { name: 'directory_tree', argsText: '{"path":"src"}', result: TWELVE_LINES },
  },
  {
    id: 'move_file',
    input: {
      name: 'move_file',
      argsText: '{"source":"a.ts","destination":"b.ts"}',
      result: 'Moved a.ts to b.ts',
    },
  },
  {
    id: 'search_files',
    input: {
      name: 'search_files',
      argsText: '{"path":"src","pattern":"*.ts"}',
      result: 'src/index.ts\nsrc/core/toolDisplay.ts',
    },
  },
  {
    id: 'get_file_info',
    input: {
      name: 'get_file_info',
      argsText: '{"path":"src/index.ts"}',
      result: 'size: 1024\ntype: file',
    },
  },
  {
    id: 'delete_file',
    input: {
      name: 'delete_file',
      argsText: '{"path":"tmp/stale.log"}',
      result: 'Deleted tmp/stale.log',
    },
  },
  {
    id: 'delete_directory',
    input: {
      name: 'delete_directory',
      argsText: '{"path":"tmp","recursive":true}',
      result: 'Deleted tmp',
    },
  },
  {
    id: 'list_allowed_directories',
    input: {
      name: 'list_allowed_directories',
      argsText: '{}',
      result: 'Allowed directories:\n/home/user/project',
    },
  },
  {
    id: 'run_shell_command',
    input: {
      name: 'run_shell_command',
      argsText: '{"command":"ls -la"}',
      result: shellResult('ls -la', TWELVE_LINES, 'Exit code: 0'),
    },
  },
  {
    id: 'run_shell_command-live-already-shown',
    input: {
      name: 'run_shell_command',
      argsText: '{"command":"ls -la"}',
      output: TWELVE_LINES,
      result: shellResult('ls -la', TWELVE_LINES, 'Exit code: 0'),
      liveOutputAlreadyShown: true,
    },
  },
  {
    id: 'run_tests',
    input: {
      name: 'run_tests',
      argsText: '{}',
      result: shellResult('npm test', TWELVE_LINES, 'Exit code: 0'),
    },
  },
  {
    id: 'run_single_test',
    input: {
      name: 'run_single_test',
      argsText: '{"testPath":"spec/toolDisplay.spec.ts"}',
      result: shellResult('npm test spec/toolDisplay.spec.ts', 'ok', 'Exit code: 0'),
    },
  },
  {
    id: 'run_lint',
    input: {
      name: 'run_lint',
      argsText: '{}',
      result: shellResult('npm run lint', 'clean', 'Exit code: 0'),
    },
  },
  {
    id: 'run_build',
    input: {
      name: 'run_build',
      argsText: '{}',
      result: shellResult('npm run build', TWELVE_LINES, 'Exit code: 0'),
    },
  },
  {
    id: 'task',
    input: {
      name: 'task',
      argsText: '{"subagent_type":"general-purpose","description":"find the caller"}',
      result: 'Subagent finished.',
    },
  },
  {
    id: 'unregistered-generic',
    input: {
      name: 'some_mcp_tool',
      argsText: '{"query":"weather","units":"metric"}',
      output: 'partial output line',
      result: TWELVE_LINES,
    },
  },
  {
    id: 'unregistered-shell-shaped',
    input: {
      name: 'my_custom_toolkit_tool',
      argsText: '{"arg":"value"}',
      result: shellResult('custom-runner --go', TWELVE_LINES, 'Exit code: 1'),
      isError: true,
    },
  },
  {
    id: 'unparsable-args',
    input: { name: 'read_file', argsText: '{"path":"half-strea', result: 'still streaming' },
  },
  {
    id: 'no-args',
    input: { name: 'list_directory', argsText: undefined, result: 'empty' },
  },
  // The deliberate exception: TUI-C105 half 2 gives this tool a registry entry, so its SUMMARY
  // line moves from `gth_gh_read_file()` to one naming the file. Captured here precisely so the
  // spec can assert that it changed AND that nothing else did.
  {
    id: 'gth_gh_read_file',
    input: {
      name: 'gth_gh_read_file',
      argsText: '{"path":"packages/core/src/core/toolDisplay.ts"}',
      result: `Full contents of acme/widgets/packages/core/src/core/toolDisplay.ts@main:\n\n${TWELVE_LINES}`,
    },
  },
  {
    id: 'gth_gh_read_file-error',
    input: {
      name: 'gth_gh_read_file',
      argsText: '{"path":"missing.ts"}',
      result:
        'Could not read "missing.ts" via the GitHub API: not found\nThis tool needs an authenticated gh CLI.',
      isError: true,
    },
  },
];

const entries = CORPUS.map(({ id, input }) => ({
  id,
  input,
  glyph: getToolGlyph(input.name),
  // `secrets: []` so the capture depends on the corpus alone and not on this machine's
  // environment — `redactText` still applies the provider-key PATTERNS, which are deterministic.
  summary: summariseToolCall(input.name, input.argsText, []),
  preview: buildToolPreviewLines(input, []),
}));

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(
  outPath,
  JSON.stringify(
    {
      note: 'FROZEN control baseline captured from the PRE-CHANGE build. See packages/core/scripts/capture-tool-display-baseline.mjs — do not regenerate to make a red control green.',
      node: 'TUI-C105',
      entries,
    },
    null,
    2
  ) + '\n',
  'utf8'
);

console.log(`Wrote ${entries.length} baseline entries to ${outPath}`);
