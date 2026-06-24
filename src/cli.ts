export function hasFlag(name: string, argv = process.argv.slice(2)): boolean {
  return argv.includes(name);
}

export function optionValue(name: string, fallback?: string, argv = process.argv.slice(2)): string | undefined {
  const prefix = `${name}=`;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === name) return argv[i + 1] ?? fallback;
    if (arg.startsWith(prefix)) return arg.slice(prefix.length);
  }
  return fallback;
}

export function numberOption(name: string, fallback: number, argv = process.argv.slice(2)): number {
  const raw = optionValue(name, undefined, argv);
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function printHelpAndExit(text: string): void {
  console.log(text.trim());
  process.exit(0);
}
