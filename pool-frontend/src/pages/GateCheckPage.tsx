import { useState, useRef, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import type { CheckQrResult } from '../types';

export default function GateCheckPage() {
    const { profile } = useAuth();
    const [ticketId, setTicketId] = useState('');
    const [checking, setChecking] = useState(false);
    const [result, setResult] = useState<CheckQrResult | null>(null);
    const [history, setHistory] = useState<CheckQrResult[]>([]);
    const inputRef = useRef<HTMLInputElement>(null);

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
                message: 'Mã QR/Mã thẻ quá ngắn. Vui lòng quét lại.'
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

        const speak = (text: string) => {
            if ('speechSynthesis' in window) {
                // Cancel any ongoing speech
                window.speechSynthesis.cancel();
                const utterance = new SpeechSynthesisUtterance(text);
                utterance.lang = 'vi-VN';
                utterance.rate = 1.1; // Slightly faster for gate checking
                window.speechSynthesis.speak(utterance);
            }
        };

        if (error) {
            const errResult: CheckQrResult = {
                success: false,
                error: 'RPC_ERROR',
                message: 'Lỗi hệ thống: ' + error.message
            };
            setResult(errResult);
            setHistory(prev => [errResult, ...prev].slice(0, 20));
            speak('Lỗi hệ thống');
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

            // Speak the result message
            if (finalResult.message) {
                speak(finalResult.message);
            }
        }

        setTicketId('');
        setChecking(false);
    }

    function handleKeyDown(e: React.KeyboardEvent) {
        if (e.key === 'Enter') handleCheck();
    }

    return (
        <div className="page-container">
            <div className="page-header">
                <h1>🔍 Soát Vé</h1>
                <p>Quét hoặc nhập mã QR trên vé của khách</p>
            </div>

            {/* Scanner input */}
            <div className="gate-scanner">
                <div className="scanner-input-group">
                    <input
                        ref={inputRef}
                        type="text"
                        value={ticketId}
                        onChange={e => setTicketId(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder="Quét mã QR hoặc nhập mã vé..."
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
