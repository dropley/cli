import { UsageError } from './errors.js';

export type FlagKind = 'boolean' | 'value';

export interface PositionalSpec {
  name: string;
  required: boolean;
  description?: string;
}

export interface CommandSpec {
  summary: string;
  flags: Record<string, FlagKind>;
  positionals: PositionalSpec[];
}

export const GLOBAL_FLAGS: Record<string, FlagKind> = {
  json: 'boolean',
  api: 'value',
  token: 'value',
  help: 'boolean',
  version: 'boolean',
};

export interface ParsedInvocation {
  command: string;
  positionals: string[];
  values: Record<string, string>;
  flags: Set<string>;
}

/** Shape handed to command handlers (everything except the command name). */
export type ParsedArgs = Omit<ParsedInvocation, 'command'>;

const VALUE_RE = /^(--[A-Za-z0-9][A-Za-z0-9-]*)=(.*)$/;

export function parseArgv(
  argv: readonly string[],
  specs: Record<string, CommandSpec>,
): ParsedInvocation {
  const commandArg = argv[0];
  if (commandArg === undefined || commandArg === '') {
    throw new UsageError('Missing command. Run `dropley --help` for usage.');
  }

  const spec = specs[commandArg];
  if (!spec) {
    throw new UsageError(`Unknown command: ${commandArg}. Run \`dropley --help\` for usage.`);
  }

  const flagKinds: Record<string, FlagKind> = { ...GLOBAL_FLAGS, ...spec.flags };
  const positionals: string[] = [];
  const values: Record<string, string> = {};
  const flags = new Set<string>();

  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined) break;

    if (!arg.startsWith('-')) {
      positionals.push(arg);
      continue;
    }
    if (arg === '--') {
      for (const rest of argv.slice(i + 1)) positionals.push(rest);
      break;
    }
    if (arg === '-') {
      throw new UsageError("Unexpected argument '-'.");
    }

    let name: string;
    let inlineValue: string | undefined;
    const eqMatch = VALUE_RE.exec(arg);
    if (eqMatch && eqMatch[1] !== undefined) {
      name = eqMatch[1].slice(2);
      inlineValue = eqMatch[2] ?? '';
    } else {
      name = arg.slice(2);
    }

    const kind = flagKinds[name];
    if (!kind) {
      throw new UsageError(`Unknown option --${name} for '${commandArg}'.`);
    }
    flags.add(name);

    if (kind === 'boolean') {
      if (inlineValue !== undefined && inlineValue !== 'true' && inlineValue !== 'false') {
        throw new UsageError(`Option --${name} does not take a value.`);
      }
      if (inlineValue === 'false') flags.delete(name);
      continue;
    }

    const next = argv[i + 1];
    const value =
      inlineValue ??
      (next !== undefined && !next.startsWith('--') ? ((i++, next)) : undefined);
    if (value === undefined) {
      throw new UsageError(`Option --${name} requires a value.`);
    }
    values[name] = value;
  }

  if (flags.has('help') || flags.has('version')) {
    return { command: commandArg, positionals, values, flags };
  }

  const requiredCount = spec.positionals.filter((p) => p.required).length;
  if (positionals.length < requiredCount) {
    const missing = spec.positionals[positionals.length];
    throw new UsageError(`Missing argument: ${missing?.name ?? '<arg>'}.`);
  }
  if (positionals.length > spec.positionals.length) {
    throw new UsageError(
      `Too many arguments for '${commandArg}' (expected ${spec.positionals.length}).`,
    );
  }

  return { command: commandArg, positionals, values, flags };
}
