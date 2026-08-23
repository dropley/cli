import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgv, type CommandSpec, type ParsedArgs } from './args.js';
import { ApiError } from './api.js';
import { EXIT, AuthError, UsageError } from './errors.js';
import { createIo, formatApiError, type Io } from './output.js';
import { publish } from './commands/publish.js';
import { status } from './commands/status.js';
import { update } from './commands/update.js';
import { del } from './commands/delete.js';
import { pack } from './commands/pack.js';

type Handler = (parsed: ParsedArgs, io: Io) => Promise<number>;

interface DropleyCommandSpec extends CommandSpec {
  handler: Handler;
}

const COMMANDS: Record<string, DropleyCommandSpec> = {
  publish: {
    summary: 'Publish a file or directory and print its public URL + token.',
    flags: { expiry: 'value', tags: 'value', source: 'value' },
    positionals: [{ name: '<path>', required: true, description: 'File or directory to publish' }],
    handler: publish,
  },
  status: {
    summary: 'Show metadata for a published artifact.',
    flags: {},
    positionals: [{ name: '<url-or-shortId>', required: true }],
    handler: status,
  },
  update: {
    summary: 'Update an artifact (expiry, source, tags).',
    flags: { expiry: 'value', source: 'value', tags: 'value' },
    positionals: [{ name: '<url-or-shortId>', required: true }],
    handler: update,
  },
  delete: {
    summary: 'Permanently delete an artifact.',
    flags: {},
    positionals: [{ name: '<url-or-shortId>', required: true }],
    handler: del,
  },
  pack: {
    summary: 'Create a byte-reproducible zip archive of a directory.',
    flags: { out: 'value' },
    positionals: [{ name: '<dir>', required: true }],
    handler: pack,
  },
};

export const VERSION: string = (() => {
  try {
    // cli.js sits at <pkgroot>/dist/cli.js in both the repo and installed layout.
    const pkgUrl = new URL('../package.json', import.meta.url);
    return (
      (JSON.parse(readFileSync(fileURLToPath(pkgUrl), 'utf8')) as { version?: string }).version ??
      '0.0.0-dev'
    );
  } catch {
    return '0.0.0-dev';
  }
})();

function usage(): string {
  const lines = [
    `dropley ${VERSION} — publish files and static sites from your terminal`,
    '',
    'Usage:',
    ...Object.entries(COMMANDS).map(
      ([name, spec]) =>
        `  dropley ${name} ${spec.positionals.map((p) => p.name).join(' ')}${Object.keys(spec.flags).length ? ' [options]' : ''}`,
    ),
    '',
    'Commands:',
  ];
  for (const [name, spec] of Object.entries(COMMANDS)) {
    lines.push(`  ${name.padEnd(10)} ${spec.summary}`);
  }
  lines.push(
    '',
    'Options:',
    '  --json          Machine-readable output',
    '  --api <url>     API base URL (default https://dropley.app; env DROPLEY_API)',
    '  --token <tok>   Artifact token (env DROPLEY_TOKEN)',
    '  --no-retry      Disable automatic retries on HTTP 429',
    '  --expiry <t>    server-validated: 1d, 3d, or 7d',
    '  --tags <a,b,c>  Comma-separated tags (max 10, each ≤ 50 chars)',
    '  --source <s>    claude-code, chatgpt, cursor, lovable, bolt, storybook, figma, other',
    '',
    'Exit codes: 0 success · 1 failure · 2 usage error',
    'Docs: https://github.com/dropley/cli',
  );
  return lines.join('\n');
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<number> {
  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h' || argv[0] === 'help') {
    process.stdout.write(`${usage()}\n`);
    return argv.length === 0 ? EXIT.usage : EXIT.ok;
  }
  if (argv[0] === '--version' || argv[0] === '-v' || argv[0] === 'version') {
    process.stdout.write(`dropley ${VERSION}\n`);
    return EXIT.ok;
  }

  try {
    const parsed = parseArgv(argv, COMMANDS);
    if (parsed.flags.has('help')) {
      process.stdout.write(`${usage()}\n`);
      return EXIT.ok;
    }
    if (parsed.flags.has('version')) {
      process.stdout.write(`dropley ${VERSION}\n`);
      return EXIT.ok;
    }
    const spec = COMMANDS[parsed.command];
    if (!spec) throw new UsageError(`Unknown command: ${parsed.command}`);
    const io = createIo(parsed.flags.has('json'));
    return await spec.handler(parsed, io);
  } catch (err) {
    if (err instanceof UsageError) {
      process.stderr.write(`${usage()}\n\nerror: ${(err as Error).message}\n`);
      return EXIT.usage;
    }
    if (err instanceof AuthError) {
      process.stderr.write(`${err.message}\n`);
      return EXIT.failure;
    }
    if (err instanceof ApiError) {
      process.stderr.write(`${formatApiError(err)}\n`);
      return EXIT.failure;
    }
    process.stderr.write(
      `error: ${(err as Error).message ?? String(err)}\nRun \`dropley --help\` for usage.\n`,
    );
    return EXIT.failure;
  }
}