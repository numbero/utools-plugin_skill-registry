export class RegistryError extends Error {
  constructor(public code: string, message: string, public details?: unknown) { super(message); this.name = 'RegistryError'; }
}
export function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }
export function fail(condition: unknown, text: string, code = 'VALIDATION'): asserts condition { if (!condition) throw new RegistryError(code, text); }
