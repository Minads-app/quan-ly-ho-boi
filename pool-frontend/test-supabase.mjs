async function run() {
    const res = await fetch('https://klpayzugfmjvgzshbgch.supabase.co/rest/v1/', {
        headers: {
            'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtscGF5enVnZm1qdmd6c2hiZ2NoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIwMjQ2MzAsImV4cCI6MjA4NzYwMDYzMH0.sM09bom4hlvJqgFSRrWAiGWRW788QP5q9ODb45nmuAg'
        }
    });
    const data = await res.json();
    
    // find ticket_types
    const ticketTypes = data.definitions.ticket_types;
    console.log(ticketTypes.properties.lesson_class_type);
}
run();
