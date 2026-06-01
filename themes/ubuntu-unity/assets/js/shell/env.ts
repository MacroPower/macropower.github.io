// Shell variable store and the source for parameter expansion. Holds regular
// variables (each optionally exported) and resolves the special parameters
// $?, $$, and $RANDOM. DOM-free, like the rest of the shell core.

export interface EnvHooks {
  /** Exit status of the last command, for $?. */
  status(): number;
}

export class Env {
  private readonly vars = new Map<string, string>();
  private readonly exported = new Set<string>();
  // A stable-per-session fake PID for $$.
  private readonly pid = 1000 + Math.floor(Math.random() * 9000);

  constructor(private readonly hooks: EnvHooks) {}

  get(name: string): string | undefined {
    return this.vars.get(name);
  }

  set(name: string, value: string, opts: { export?: boolean } = {}): void {
    this.vars.set(name, value);
    if (opts.export) this.exported.add(name);
  }

  /** Mark an already-set variable as exported (`export NAME`). */
  markExported(name: string): void {
    if (this.vars.has(name)) this.exported.add(name);
  }

  unset(name: string): void {
    this.vars.delete(name);
    this.exported.delete(name);
  }

  isExported(name: string): boolean {
    return this.exported.has(name);
  }

  /** Variable names, sorted -- backs $-completion. */
  names(): string[] {
    return [...this.vars.keys()].sort();
  }

  /** Every variable as [name, value], sorted -- backs `set`. */
  all(): [string, string][] {
    return this.names().map((n) => [n, this.vars.get(n) ?? ""]);
  }

  /** Exported variables only, sorted -- backs `env` and bare `export`. */
  exports(): [string, string][] {
    return [...this.exported].sort().map((n) => [n, this.vars.get(n) ?? ""]);
  }

  // Resolve a parameter name to its value during expansion. The special
  // parameters are computed; every other name reads the variable map, with an
  // unset name expanding to the empty string (bash default).
  lookup(name: string): string {
    switch (name) {
      case "?": return String(this.hooks.status());
      case "$": return String(this.pid);
      case "RANDOM": return String(Math.floor(Math.random() * 32768));
      case "!": case "#": case "*": case "@": case "-": case "0": return "";
      default: return this.vars.get(name) ?? "";
    }
  }
}
