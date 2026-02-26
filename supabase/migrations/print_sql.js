const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Load environment variables from frontend .env.local
const envPath = path.resolve(__dirname, '../../pool-frontend/.env.local');
const envContent = fs.readFileSync(envPath, 'utf-8');

let supabaseUrl = '';
let supabaseServiceKey = '';

envContent.split('\n').forEach(line => {
    if (line.startsWith('VITE_SUPABASE_URL=')) supabaseUrl = line.split('=')[1].trim();
    if (line.startsWith('VITE_SUPABASE_SERVICE_ROLE_KEY=')) supabaseServiceKey = line.split('=')[1].trim();
});

if (!supabaseUrl || !supabaseServiceKey) {
    console.error('Missing Supabase credentials in .env.local');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function applyMigration() {
    const sqlPath = path.resolve(__dirname, '018_add_camera_permission.sql');
    const sqlQuery = fs.readFileSync(sqlPath, 'utf8');

    // Due to the lack of direct RPC execution for raw SQL on the standard Supabase JS client,
    // we use a workaround if rpc('exec_sql') is not enabled.
    // An alternative is to just insert using standard REST or tell the user to run it.
    console.log("Adding column `can_use_camera` via standard REST if possible or manual output...");
    console.log("Please run this in the Supabase SQL Editor:");
    console.log("-----------------------------------------");
    console.log(sqlQuery);
    console.log("-----------------------------------------");
}

applyMigration();
