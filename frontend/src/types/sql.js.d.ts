/** sql.js 类型声明 */

declare module 'sql.js' {
  interface SqlJsStatic {
    Database: new (data?: ArrayLike<number> | Buffer | null) => Database;
  }

  interface Database {
    run(sql: string, params?: Record<string, unknown>): Database;
    exec(sql: string): QueryExecResult[];
    prepare(sql: string): Statement;
    export(): Uint8Array;
    close(): void;
    getRowsModified(): number;
  }

  interface Statement {
    bind(params?: Record<string, unknown>): boolean;
    step(): boolean;
    getAsObject(): Record<string, unknown>;
    free(): boolean;
    reset(): void;
    getColumnNames(): string[];
  }

  interface QueryExecResult {
    columns: string[];
    values: Array<Array<number | string | null>>;
  }

  interface InitSqlJsConfig {
    locateFile?: (file: string) => string;
  }

  function initSqlJs(config?: InitSqlJsConfig): Promise<SqlJsStatic>;

  export default initSqlJs;
  export type { Database, SqlJsStatic, Statement, QueryExecResult };
}
