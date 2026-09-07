/**
 * What the database actually has, asked at boot.
 *
 * The alternative is a hand-written list of tables and their columns, which
 * is correct on the day it is written and wrong the first time a migration
 * lands. Introspecting instead means a new column is exposed by the next
 * restart and a removed one stops being accepted, with nothing to remember.
 *
 * This is a validation aid, not a security boundary: it decides what is a
 * plausible request, and row-level security decides what is an allowed one.
 */

import { pool } from "./db.js";

export interface TableInfo {
  name: string;
  columns: Set<string>;
  /** Columns the database fills in itself; accepted but never required. */
  generated: Set<string>;
  hasId: boolean;
}

const tables = new Map<string, TableInfo>();

/** Tables this API deliberately does not expose over CRUD. */
const HIDDEN = new Set(["platform_settings"]);

export async function loadSchema(): Promise<void> {
  const { rows } = await pool.query<{
    table_name: string;
    column_name: string;
    has_default: boolean;
    is_identity: string;
  }>(
    `select c.table_name, c.column_name,
            (c.column_default is not null) as has_default,
            c.is_identity
       from information_schema.columns c
       join information_schema.tables t
         on t.table_schema = c.table_schema and t.table_name = c.table_name
      where c.table_schema = 'public'
        and t.table_type in ('BASE TABLE', 'VIEW')`,
  );
  tables.clear();
  for (const r of rows) {
    if (HIDDEN.has(r.table_name)) continue;
    let info = tables.get(r.table_name);
    if (!info) {
      info = { name: r.table_name, columns: new Set(), generated: new Set(), hasId: false };
      tables.set(r.table_name, info);
    }
    info.columns.add(r.column_name);
    if (r.has_default || r.is_identity === "YES") info.generated.add(r.column_name);
    if (r.column_name === "id") info.hasId = true;
  }
}

export function tableInfo(name: string): TableInfo | undefined {
  return tables.get(name);
}

export function tableNames(): string[] {
  return [...tables.keys()].sort();
}
