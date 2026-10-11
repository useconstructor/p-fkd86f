CREATE TABLE IF NOT EXISTS workspace (id TEXT PRIMARY KEY, currency TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS session (id TEXT PRIMARY KEY, secret_hash TEXT NOT NULL UNIQUE, workspace_id TEXT NOT NULL REFERENCES workspace(id), created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS category (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspace(id), name TEXT NOT NULL, name_key TEXT NOT NULL, archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0,1)), UNIQUE(workspace_id,name_key), UNIQUE(id,workspace_id));
CREATE TABLE IF NOT EXISTS expense (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspace(id), category_id TEXT NOT NULL, concept TEXT NOT NULL CHECK(length(concept) BETWEEN 1 AND 120), amount_minor INTEGER NOT NULL CHECK(amount_minor>0), date TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, FOREIGN KEY(category_id,workspace_id) REFERENCES category(id,workspace_id));
CREATE INDEX IF NOT EXISTS expense_month ON expense(workspace_id,date);
CREATE INDEX IF NOT EXISTS expense_category ON expense(workspace_id,category_id);
CREATE TABLE IF NOT EXISTS schema_migration (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
