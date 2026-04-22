import { createClient } from '@supabase/supabase-js';
const supabase = createClient('https://klpayzugfmjvgzshbgch.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtscGF5enVnZm1qdmd6c2hiZ2NoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIwMjQ2MzAsImV4cCI6MjA4NzYwMDYzMH0.sM09bom4hlvJqgFSRrWAiGWRW788QP5q9ODb45nmuAg');
async function run() {
    const { data, error } = await supabase.from('tickets').select('id, ticket_types(name, category, lesson_class_type, student_count)').order('created_at', {ascending: false}).limit(10);
    console.log(JSON.stringify(data, null, 2) || error);
}
run();
