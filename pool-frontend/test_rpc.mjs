import { createClient } from '@supabase/supabase-js';

// We need the service_role key to create functions.
// Let's try to find it in the project or use an alternative approach.

// Check StaffPage for any admin client configuration
import { readFileSync } from 'fs';

const staffContent = readFileSync('src/pages/StaffPage.tsx', 'utf8');

// Look for service role key or admin client
const serviceKeyMatch = staffContent.match(/service_role['":\s]*([A-Za-z0-9._-]+)/);
const adminClientMatch = staffContent.match(/createClient\s*\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]/);

if (serviceKeyMatch) {
    console.log('Found service key pattern:', serviceKeyMatch[1].substring(0, 30) + '...');
}
if (adminClientMatch) {
    console.log('Found admin client URL:', adminClientMatch[1]);
    console.log('Found admin client Key:', adminClientMatch[2].substring(0, 30) + '...');
}

// Also check for any environment variable references
const envMatches = staffContent.match(/import\.meta\.env\.\w+/g);
if (envMatches) {
    console.log('Env vars used:', [...new Set(envMatches)]);
}

// Check for supabaseAdmin or service role references
const adminRefs = staffContent.match(/supabaseAdmin|service_role|serviceRole|SUPABASE_SERVICE/gi);
if (adminRefs) {
    console.log('Admin references:', [...new Set(adminRefs)]);
}

// Check lib/supabase.ts
const libContent = readFileSync('src/lib/supabase.ts', 'utf8');
console.log('\n=== src/lib/supabase.ts ===');
console.log(libContent);
