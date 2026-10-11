import 'server-only';
import {createClient, type Client} from '@libsql/client';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
let client:Client|undefined;
export function getDb() { if(!process.env.TURSO_DATABASE_URL)throw new Error('Database unavailable');return client ??=createClient({url:process.env.TURSO_DATABASE_URL,authToken:process.env.TURSO_AUTH_TOKEN}); }
let ready:Promise<void>|undefined;
export function migrate() {
 return ready ??= (async()=>{
  const db=getDb();
  await db.execute('PRAGMA foreign_keys = ON');
  const sql=await readFile(path.join(process.cwd(),'migrations/001_initial.sql'),'utf8');
  const tx=await db.transaction('write');
  try {
   for(const statement of sql.split(';').filter(s=>s.trim()))await tx.execute(statement);
   // Upgrade the existing database additively: CREATE IF NOT EXISTS does not add columns.
   const categoryColumns=await tx.execute('PRAGMA table_info(category)');
   if(!categoryColumns.rows.some(r=>r.name==='name_key')) {
    await tx.execute('ALTER TABLE category ADD COLUMN name_key TEXT');
    const {rows}=await tx.execute('SELECT id,name FROM category');
    for(const row of rows)await tx.execute({sql:'UPDATE category SET name_key=? WHERE id=?',args:[String(row.name).toLocaleLowerCase('es'),row.id]});
   }
   await tx.execute('CREATE UNIQUE INDEX IF NOT EXISTS category_workspace_name_key ON category(workspace_id,name_key)');
   const migrationColumns=await tx.execute('PRAGMA table_info(schema_migration)');
   if(!migrationColumns.rows.some(r=>r.name==='applied_at'))await tx.execute('ALTER TABLE schema_migration ADD COLUMN applied_at TEXT');
   await tx.execute({sql:'INSERT OR IGNORE INTO schema_migration(version,applied_at) VALUES (1,?)',args:[new Date().toISOString()]});
   await tx.execute({sql:'INSERT OR IGNORE INTO schema_migration(version,applied_at) VALUES (2,?)',args:[new Date().toISOString()]});
   await tx.commit();
  } finally {tx.close();}
 })().catch(e=>{ready=undefined;throw e;});
}
