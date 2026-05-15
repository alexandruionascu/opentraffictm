declare module "better-sqlite3" {
  namespace Database {
    interface Statement<T> {
      all(...params: unknown[]): T[];
      run(...params: unknown[]): void;
      get(...params: unknown[]): T;
    }
  }

  class Database {
    constructor(filename: string, options?: { readonly?: boolean } | undefined);
    prepare<T = unknown>(sql: string): Database.Statement<T>;
    close(): void;
  }

  export = Database;
}