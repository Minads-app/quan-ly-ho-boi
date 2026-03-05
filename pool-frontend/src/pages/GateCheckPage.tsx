/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars, no-empty, react-hooks/immutability, react-hooks/exhaustive-deps */
import { useState, useRef, useEffect } from 'react';
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import type { CheckQrResult } from '../types';

export default function GateCheckPage() {
    const { profile } = useAuth();
    const [ticketId, setTicketId] = useState('');
    const [checking, setChecking] = useState(false);
    const [result, setResult] = useState<CheckQrResult | null>(null);
    const [history, setHistory] = useState<CheckQrResult[]>([]);
    const [showCamera, setShowCamera] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);
    const scannerRef = useRef<Html5Qrcode | null>(null);
    const checkingRef = useRef(checking);

    useEffect(() => {
        checkingRef.current = checking;
    }, [checking]);

    // Re-initialize or destroy scanner when toggle changes
    useEffect(() => {
        let isMounted = true;

        if (showCamera) {
            const html5QrCode = new Html5Qrcode("qr-reader", { formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE], verbose: false });
            scannerRef.current = html5QrCode;

            html5QrCode.start(
                { facingMode: "environment" },
                {
                    fps: 10,
                    qrbox: { width: 250, height: 250 },
                    aspectRatio: 1.0,
                },
                (decodedText) => {
                    // Prevent crazy loops if already checking
                    if (!checkingRef.current && isMounted) {
                        setTicketId(decodedText);
                        // Briefly pause scanner to prevent double scans
                        if (scannerRef.current) {
                            try { scannerRef.current.pause(true); } catch (e) { }
                        }
                    }
                },
                (_errorMessage) => {
                    // Ignore background scan noise
                }
            ).catch(err => {
                console.error("Camera start error:", err);
            });
        }

        return () => {
            isMounted = false;
            if (scannerRef.current) {
                const scanner = scannerRef.current;
                scannerRef.current = null;
                try {
                    scanner.stop().then(() => {
                        scanner.clear();
                    }).catch(() => {
                        try { scanner.clear(); } catch (e) { }
                    });
                } catch (e) {
                    try { scanner.clear(); } catch (e) { }
                }
            }
        };
    }, [showCamera]);

    // Triggers handleCheck when ticketId is scanned from camera
    useEffect(() => {
        if (showCamera && ticketId && !checking) {
            handleCheck();
        }
    }, [ticketId]);

    useEffect(() => {
        inputRef.current?.focus();
    }, []);

    // Re-focus input after each result
    useEffect(() => {
        if (result) {
            const timer = setTimeout(() => inputRef.current?.focus(), 100);
            return () => clearTimeout(timer);
        }
    }, [result]);

    async function handleCheck() {
        const id = ticketId.trim();
        if (!id || checking) return;

        // Validate input is not empty
        if (id.length < 3) {
            setResult({
                success: false,
                error: 'INVALID_FORMAT',
                message: 'Mã QR quá ngắn. Vui lòng quét lại.'
            });
            return;
        }

        // Chỉ cho phép mã QR (UUID), không cho phép mã thẻ khách hàng
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (!uuidRegex.test(id)) {
            setResult({
                success: false,
                error: 'CARD_CODE_NOT_ALLOWED',
                message: 'Soát vé chỉ hỗ trợ quét mã QR trên vé. Không hỗ trợ nhập mã thẻ khách hàng.'
            });
            return;
        }

        setChecking(true);
        setResult(null);

        const { data, error } = await supabase.rpc('check_qr_ticket_text', {
            p_ticket_code: id,
            p_direction: 'IN',
            p_scanned_by: profile?.id ?? null
        });




        if (error) {
            const errResult: CheckQrResult = {
                success: false,
                error: 'RPC_ERROR',
                message: 'Lỗi hệ thống: ' + error.message
            };
            setResult(errResult);
            setHistory(prev => [errResult, ...prev].slice(0, 20));

        } else {
            // New RPC returns data.ticket for success
            const resData: any = data;

            let finalResult: CheckQrResult;
            if (resData.success && resData.ticket) {
                finalResult = {
                    success: resData.success,
                    message: resData.message,
                    type_name: resData.ticket.type_name,
                    category: resData.ticket.category,
                    customer_name: resData.ticket.customer_name,
                    remaining_sessions: resData.ticket.remaining_sessions
                }
            } else {
                finalResult = resData as CheckQrResult;
            }

            setResult(finalResult);
            setHistory(prev => [finalResult, ...prev].slice(0, 20));


        }

        setTicketId('');
        setChecking(false);
        if (scannerRef.current && showCamera) {
            // Resume camera scanning after processing
            setTimeout(() => {
                try { scannerRef.current?.resume(); } catch (e) { }
            }, 1500);
        }
    }

    function handleKeyDown(e: React.KeyboardEvent) {
        if (e.key === 'Enter') handleCheck();
    }

    return (
        <div className="page-container">
            <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                <div>
                    <h1>🔍 Soát Vé</h1>
                    <p>Quét mã QR trên vé của khách (không hỗ trợ mã thẻ)</p>
                </div>
                {(profile as any)?.can_use_camera === true && (
                    <button
                        className={`btn ${showCamera ? 'btn-danger' : 'btn-secondary'}`}
                        onClick={() => setShowCamera(!showCamera)}
                        style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
                    >
                        {showCamera ? '❌ Đóng Camera' : '📷 Mở Camera quét nhanh'}
                    </button>
                )}
            </div>

            {/* Camera View */}
            {showCamera && (
                <div style={{ marginBottom: '24px', background: 'var(--bg-card)', padding: '16px', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
                    <div id="qr-reader" style={{ width: '100%', maxWidth: '500px', margin: '0 auto', overflow: 'hidden', borderRadius: '8px' }}></div>
                    <p style={{ textAlign: 'center', fontSize: '12px', color: 'var(--text-secondary)', marginTop: '8px' }}>
                        * Vui lòng cấp quyền sử dụng máy ảnh cho trình duyệt nếu được yêu cầu.
                    </p>
                </div>
            )}

            {/* Scanner input */}
            <div className="gate-scanner">
                <div className="scanner-input-group">
                    <input
                        ref={inputRef}
                        type="text"
                        value={ticketId}
                        onChange={e => setTicketId(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder="Quét mã QR trên vé..."
                        className="scanner-input"
                        autoFocus
                    />
                    <button
                        className="btn btn-primary btn-check"
                        onClick={handleCheck}
                        disabled={checking || !ticketId.trim()}
                    >
                        {checking ? '⏳' : '✓ Kiểm tra'}
                    </button>
                </div>
            </div>

            {/* Result display */}
            {result && (
                <div className={`gate-result ${result.success ? 'success' : 'error'}`}>
                    <div className="gate-result-icon">
                        {result.success ? '✅' : '❌'}
                    </div>
                    <div className="gate-result-message">
                        {result.message}
                    </div>
                    {result.success && result.type_name && (
                        <div className="gate-result-details">
                            <div className="detail-row">
                                <span>Loại vé:</span>
                                <strong>{result.type_name}</strong>
                            </div>
                            {result.customer_name && (
                                <div className="detail-row">
                                    <span>Khách:</span>
                                    <strong>{result.customer_name}</strong>
                                </div>
                            )}
                            {result.pool_close_time && (
                                <div className="detail-row">
                                    <span>Đóng cửa lúc:</span>
                                    <strong>{result.pool_close_time}</strong>
                                </div>
                            )}
                            {result.remaining_sessions !== undefined && result.remaining_sessions !== null && (
                                <div className="detail-row" style={{ color: result.remaining_sessions < 3 ? 'var(--error-red)' : '' }}>
                                    <span>Số lượt còn lại:</span>
                                    <strong>{result.remaining_sessions} lượt</strong>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}

            {/* History */}
            {history.length > 0 && (
                <div className="gate-history">
                    <h3>Lịch sử kiểm tra</h3>
                    <div className="history-list">
                        {history.map((h, i) => (
                            <div key={i} className={`history-item ${h.success ? 'success' : 'error'}`}>
                                <span className="history-icon">{h.success ? '✅' : '❌'}</span>
                                <span className="history-msg">{h.message}</span>
                                {h.type_name && <span className="history-type">{h.type_name}</span>}
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
