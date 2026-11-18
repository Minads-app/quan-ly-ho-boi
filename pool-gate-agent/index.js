require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { SerialPort } = require('serialport');

// 1. Config (Ưu tiên SUPABASE_SERVICE_ROLE_KEY cho dịch vụ chạy nền tại máy cổng)
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY;
const COM_PORT = process.env.COM_PORT || 'COM3';
const BAUD_RATE = parseInt(process.env.BAUD_RATE || '9600', 10);
const ALLOWED_DIRECTIONS = (process.env.GATE_DIRECTIONS || 'IN')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);

if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('❌ Missing Supabase credentials in .env');
    process.exit(1);
}

if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.warn('⚠️  TIP: Khuyến nghị cấu hình SUPABASE_SERVICE_ROLE_KEY trong .env cho Gate Agent để không bị chặn bởi RLS.');
}

// 2. Setup Supabase
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
    realtime: {
        params: {
            eventsPerSecond: 20,
        },
    },
});

// 3. Setup Serial Port với cơ chế tự động kết nối lại khi tuột cáp USB/COM
let port = null;
let serialReconnectTimer = null;

function connectSerialPort() {
    if (serialReconnectTimer) {
        clearTimeout(serialReconnectTimer);
        serialReconnectTimer = null;
    }

    try {
        const candidatePort = new SerialPort({
            path: COM_PORT,
            baudRate: BAUD_RATE,
            autoOpen: false,
        });

        candidatePort.on('close', () => {
            console.warn(`⚠️  Serial Port ${COM_PORT} closed. Đang thử kết nối lại sau 5 giây...`);
            port = null;
            scheduleSerialReconnect(5000);
        });

        candidatePort.on('error', (err) => {
            console.error(`⚠️  Serial Port error (${COM_PORT}):`, err.message);
        });

        candidatePort.open((err) => {
            if (err) {
                console.warn(`⚠️  WARNING: Could not open Serial Port ${COM_PORT} (${err.message}). Chạy ở chế độ MOCK và thử lại sau 15s.`);
                port = null;
                scheduleSerialReconnect(15000);
            } else {
                port = candidatePort;
                console.log(`🔌 Connected to hardware relay on ${COM_PORT} at ${BAUD_RATE} baud.`);
            }
        });
    } catch (error) {
        console.error('Serial port init error:', error.message);
        port = null;
        scheduleSerialReconnect(15000);
    }
}

function scheduleSerialReconnect(delayMs) {
    if (serialReconnectTimer) return;
    serialReconnectTimer = setTimeout(() => {
        serialReconnectTimer = null;
        connectSerialPort();
    }, delayMs);
}

connectSerialPort();

// 4. Function to Open Gate
function openGate(ticketId, direction) {
    const cmd = direction === 'OUT' ? (process.env.OPEN_OUT_CMD || 'OPEN\n') : 'OPEN\n';
    console.log(`\n🔔 [GATE COMMAND] Opening turnstile (${direction}) for ticket: ${ticketId}`);

    if (port && port.isOpen) {
        port.write(cmd, (err) => {
            if (err) {
                console.error('Error on writing to serial port:', err.message);
                return;
            }
            console.log('-> ⚡ Relay triggered successfully via Hardware!');
        });
    } else {
        console.log(`-> ⚡ (MOCK MODE) Relay triggered! Sent: "${cmd.trim()}" to virtual COM port.`);
    }
}

// 5. Listen to Supabase Realtime với cơ chế Auto-Reconnect (Exponential Backoff)
console.log('\n=============================================');
console.log('🏊 POOL GATE AGENT STARTED');
console.log(`📡 Listening for valid scans (${ALLOWED_DIRECTIONS.join(', ')}) from Supabase...`);
console.log('=============================================\n');

let activeChannel = null;
let reconnectAttempts = 0;
let realtimeReconnectTimer = null;

function subscribeGateChannel() {
    if (realtimeReconnectTimer) {
        clearTimeout(realtimeReconnectTimer);
        realtimeReconnectTimer = null;
    }

    if (activeChannel) {
        supabase.removeChannel(activeChannel).catch(() => {});
        activeChannel = null;
    }

    activeChannel = supabase
        .channel(`gate-scans-${Date.now()}`)
        .on(
            'postgres_changes',
            {
                event: 'INSERT',
                schema: 'public',
                table: 'scan_logs',
            },
            (payload) => {
                const log = payload.new;
                if (log.success === true && ALLOWED_DIRECTIONS.includes(String(log.direction).toUpperCase())) {
                    openGate(log.ticket_id, log.direction);
                } else if (log.success === false) {
                    console.log(`❌ Scan rejected: ${log.failure_reason} (Ticket: ${log.ticket_id})`);
                }
            }
        )
        .subscribe((status, err) => {
            if (status === 'SUBSCRIBED') {
                reconnectAttempts = 0;
                console.log('✅ Realtime Subscribed: Waiting for QR scans...');
            } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
                reconnectAttempts += 1;
                const delayMs = Math.min(30000, 2000 * Math.pow(1.5, reconnectAttempts - 1));
                console.warn(`❌ Realtime ${status}${err ? ': ' + err.message : ''}. Tự động kết nối lại sau ${Math.round(delayMs / 1000)}s...`);
                scheduleRealtimeReconnect(delayMs);
            }
        });
}

function scheduleRealtimeReconnect(delayMs) {
    if (realtimeReconnectTimer) return;
    realtimeReconnectTimer = setTimeout(() => {
        realtimeReconnectTimer = null;
        subscribeGateChannel();
    }, delayMs);
}

subscribeGateChannel();

// Keep alive
setInterval(() => {}, 1000 * 60 * 60);
