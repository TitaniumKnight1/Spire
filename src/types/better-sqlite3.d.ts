declare module "better-sqlite3" {
  namespace BetterSqlite3 {
    interface RunResult {
      changes: number;
      lastInsertRowid: number | bigint;
    }

    interface Statement {
      get(...params: unknown[]): unknown;
      all(...params: unknown[]): unknown[];
      run(...params: unknown[]): RunResult;
    }

    interface Database {
      pragma(source: string, options?: unknown): unknown;
      exec(source: string): void;
      prepare(source: string): Statement;
      close(): void;
    }
  }

  interface BetterSqlite3Constructor {
    new (filename: string): BetterSqlite3.Database;
  }

  const Database: BetterSqlite3Constructor;
  export default Database;
}
