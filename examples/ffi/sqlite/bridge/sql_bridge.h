/*
 * Pure C ABI for SQLite (no MnWord). JSON is the interchange format for
 * query rows; Menard decodes with std/json. Not part of the Runtime ABI.
 *
 * query JSON: array of objects, one per row. Column names are keys.
 * Values: number / string / null (BLOB → null in this proving ground).
 */
#ifndef SQL_BRIDGE_H
#define SQL_BRIDGE_H

#ifdef __cplusplus
extern "C" {
#endif

typedef enum {
  SQL_OK = 0,
  SQL_ERR = 1,
  SQL_BAD_STATE = 2
} SqlStatus;

/* Open a database file (or ":memory:"). Closes any prior connection. */
SqlStatus sql_bridge_open(const char *path);

SqlStatus sql_bridge_close(void);

/* Run SQL that does not return rows (DDL/DML). */
SqlStatus sql_bridge_exec(const char *sql);

/*
 * Run a SELECT (or anything that yields rows). On SQL_OK, *json_out is a
 * heap UTF-8 JSON array; caller frees with free(3).
 */
SqlStatus sql_bridge_query(const char *sql, char **json_out);

/* Last SQLite / bridge error message (never NULL; may be ""). */
const char *sql_bridge_errmsg(void);

#ifdef __cplusplus
}
#endif

#endif /* SQL_BRIDGE_H */
