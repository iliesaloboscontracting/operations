// Minimal ambient typing for node:sqlite (stable in this project's Node
// version, but not yet covered by the @types/node version this project
// pins) - just enough surface for scripts/backup-db.ts's integrity check.
// Remove this once @types/node includes it.
declare module "node:sqlite" {
  export class DatabaseSync {
    constructor(path: string, options?: { readOnly?: boolean });
    prepare(sql: string): {
      get(...params: unknown[]): Record<string, unknown> | undefined;
    };
    close(): void;
  }
}
