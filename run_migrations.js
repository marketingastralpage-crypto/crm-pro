const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const MIGRATIONS_DIR = path.join(__dirname, 'supabase', 'migrations');

async function run() {
  const client = new Client({
    host: 'db.qabqqizrlzsswuervggx.supabase.co',
    port: 5432,
    database: 'postgres',
    user: 'postgres',
    password: 'JSzC3mE!qxRr(?L',
    ssl: { rejectUnauthorized: false }
  });

  await client.connect();
  console.log('✓ Connesso al database\n');

  const files = fs.readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    try {
      await client.query(sql);
      console.log('✓', file);
    } catch (e) {
      console.error('✗', file + ':', e.message);
    }
  }

  await client.end();
  console.log('\nDone.');
}

run().catch(e => {
  console.error('Connessione fallita:', e.message);
  process.exit(1);
});
