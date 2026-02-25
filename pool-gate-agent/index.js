require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { SerialPort } = require('serialport');

// 1. Config
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_KEY;
const COM_PORT = process.env.COM_PORT || 'COM3';
const BAUD_RATE = parseInt(process.env.BAUD_RATE || '9600', 10);

if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('❌ Missing Supabase credentials in .env');
    process.exit(1);
}

// 2. Setup Supabase
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// 3. Setup Serial Port (Hardware Relay)
let port;
try {
    port = new SerialPort({
        path: COM_PORT,
        baudRate: BAUD_RATE,
        autoOpen: false,
    });

    port.open((err) => {
        if (err) {
            console.warn(`\n⚠️  WARNING: Could not open Serial Port ${COM_PORT}.`);
            console.warn(`   (If you don't have hardware connected yet, this is normal. We will mock the output).`);
            port = null; // Set to null so we know to mock it
        } else {
            console.log(`🔌 Connected to hardware relay on ${COM_PORT} at ${BAUD_RATE} baud.`);
        }
    });
} catch (error) {
    console.error('Serial port error:', error);
}

// 4. Function to Open Gate
function openGate(ticketId, ticketType) {
    const cmd = 'OPEN\n'; // Command that Arduino/ESP32 expects
    console.log(`\n🔔 [GATE COMMAND] Opening turnstile for ticket: ${ticketId} (${ticketType})`);

    if (port && port.isOpen) {
        port.write(cmd, (err) => {
            if (err) {
                return console.error('Error on writing to serial port:', err.message);
            }
            console.log('-> ⚡ Relay triggered successfully via Hardware!');
        });
    } else {
        // Mock mode
        console.log(`-> ⚡ (MOCK MODE) Relay triggered successfully! sent: "${cmd.trim()}" to virtual COM port.`);
    }
}

// 5. Listen to Supabase Realtime
console.log('\n=============================================');
console.log('🏊 POOL GATE AGENT STARTED');
console.log('📡 Listening for valid scans from Supabase...');
console.log('=============================================\n');

supabase
    .channel('gate-scans')
    .on(
        'postgres_changes',
        {
            event: 'INSERT',
            schema: 'public',
            table: 'scan_logs',
        },
        (payload) => {
            const log = payload.new;

            // We only care about SUCCESSFUL entries going IN
            if (log.success === true && log.direction === 'IN') {
                openGate(log.ticket_id, 'Scanned Ticket');
            } else if (log.success === false) {
                console.log(`❌ Scan rejected: ${log.failure_reason} (Ticket: ${log.ticket_id})`);
            }
        }
    )
    .subscribe((status, err) => {
        if (status === 'SUBSCRIBED') {
            console.log('✅ Realtime Subscribed: Waiting for QR scans...');
        } else if (status === 'CLOSED') {
            console.log('❌ Realtime Disconnected.');
        } else if (status === 'CHANNEL_ERROR') {
            console.log('❌ Realtime Error.', err ? err : '');
        }
    });

// Keep alive
setInterval(() => { }, 1000 * 60 * 60);
