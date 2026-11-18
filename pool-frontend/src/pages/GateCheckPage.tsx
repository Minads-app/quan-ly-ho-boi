/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useRef, useEffect } from 'react';
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { Badge, EmptyState, PageHeader, SegmentedTabs, StatCard } from '../components/ui';
import type { CheckQrResult } from '../types';

export default function GateCheckPage() {
  const { profile } = useAuth();
  const [ticketId, setTicketId] = useState('');
  const [direction, setDirection] = useState<'IN' | 'OUT'>('IN');
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<CheckQrResult | null>(null);
  const [history, setHistory] = useState<CheckQrResult[]>([]);
  const [showCamera, setShowCamera] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const checkingRef = useRef(checking);
  const handleCheckRef = useRef<(codeOverride?: string) => void>(() => {});

  useEffect(() => {
    checkingRef.current = checking;
  }, [checking]);

  // Re-initialize or destroy scanner when toggle changes
  useEffect(() => {
    let isMounted = true;

    if (showCamera) {
      const html5QrCode = new Html5Qrcode('qr-reader', {
        formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE],
        verbose: false,
      });
      scannerRef.current = html5QrCode;

      html5QrCode
        .start(
          { facingMode: 'environment' },
          {
            fps: 10,
            qrbox: { width: 250, height: 250 },
            aspectRatio: 1.0,
          },
          (decodedText) => {
            if (!checkingRef.current && isMounted) {
              if (scannerRef.current) {
                try {
                  scannerRef.current.pause(true);
                } catch {
                  // Ignore pause error
                }
              }
              handleCheckRef.current(decodedText);
            }
          },
          () => {
            // Ignore background scan noise
          }
        )
        .catch((err) => {
          console.error('Camera start error:', err);
        });
    }

    return () => {
      isMounted = false;
      if (scannerRef.current) {
        const scanner = scannerRef.current;
        scannerRef.current = null;
        try {
          scanner
            .stop()
            .then(() => {
              scanner.clear();
            })
            .catch(() => {
              try {
                scanner.clear();
              } catch {
                // Ignore
              }
            });
        } catch {
          try {
            scanner.clear();
          } catch {
            // Ignore
          }
        }
      }
    };
  }, [showCamera]);

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

  async function handleCheck(codeOverride?: string) {
    const id = (codeOverride ?? ticketId).trim();
    if (!id || checkingRef.current) return;

    if (id.length < 3) {
      const invalidRes: CheckQrResult = {
        success: false,
        error: 'INVALID_FORMAT',
        message: 'Mã QR quá ngắn. Vui lòng quét lại.',
      };
      setResult(invalidRes);
      setHistory((prev) => [invalidRes, ...prev].slice(0, 20));
      return;
    }

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(id)) {
      const notAllowedRes: CheckQrResult = {
        success: false,
        error: 'CARD_CODE_NOT_ALLOWED',
        message: 'Soát vé chỉ hỗ trợ quét mã QR trên vé. Không hỗ trợ nhập mã thẻ khách hàng.',
      };
      setResult(notAllowedRes);
      setHistory((prev) => [notAllowedRes, ...prev].slice(0, 20));
      return;
    }

    setChecking(true);
    setResult(null);

    const { data, error } = await supabase.rpc('check_qr_ticket_text', {
      p_ticket_code: id,
      p_direction: direction,
      p_scanned_by: profile?.id ?? null,
    });

    if (error) {
      const errResult: CheckQrResult = {
        success: false,
        error: 'RPC_ERROR',
        message: 'Lỗi hệ thống: ' + error.message,
      };
      setResult(errResult);
      setHistory((prev) => [errResult, ...prev].slice(0, 20));
    } else {
      const resData: any = data;
      let finalResult: CheckQrResult;
      if (resData.success && resData.ticket) {
        finalResult = {
          success: resData.success,
          message: resData.message,
          type_name: resData.ticket.type_name,
          category: resData.ticket.category,
          customer_name: resData.ticket.customer_name,
          remaining_sessions: resData.ticket.remaining_sessions,
        };
      } else {
        finalResult = resData as CheckQrResult;
      }

      setResult(finalResult);
      setHistory((prev) => [finalResult, ...prev].slice(0, 20));
    }

    setTicketId('');
    setChecking(false);
    if (scannerRef.current && showCamera) {
      setTimeout(() => {
        try {
          scannerRef.current?.resume();
        } catch {
          // Ignore resume error
        }
      }, 1500);
    }
  }

  useEffect(() => {
    handleCheckRef.current = handleCheck;
  });

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') handleCheck();
  }

  const successCount = history.filter((h) => h.success).length;
  const failCount = history.filter((h) => !h.success).length;

  return (
    <div className="page-container">
      <PageHeader
        title="Soát Vé Cổng Kiểm Soát"
        subtitle="Quét mã QR trên vé giấy của khách để mở cổng (không hỗ trợ quẹt mã thẻ thành viên)"
        actions={
          (profile as any)?.can_use_camera === true ? (
            <button
              type="button"
              className={`btn ${showCamera ? 'btn-danger' : 'btn-outline'}`}
              onClick={() => setShowCamera(!showCamera)}
            >
              {showCamera ? '❌ Đóng Camera' : '📷 Mở Camera quét nhanh'}
            </button>
          ) : undefined
        }
      />

      <div className="gate-layout">
        {/* LEFT: Scanner + Result Hero */}
        <div>
          {showCamera && (
            <div className="gate-scanner-card" style={{ marginBottom: '16px' }}>
              <div
                id="qr-reader"
                style={{ width: '100%', maxWidth: '460px', margin: '0 auto', overflow: 'hidden', borderRadius: '10px' }}
              />
              <p style={{ textAlign: 'center', fontSize: '12px', color: 'var(--text-secondary)', marginTop: '10px', marginBottom: 0 }}>
                * Vui lòng cấp quyền sử dụng máy ảnh cho trình duyệt nếu được yêu cầu.
              </p>
            </div>
          )}

          <div className="gate-scanner-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px', marginBottom: '8px' }}>
              <h3 style={{ margin: 0 }}>Máy quét mã QR vé lượt</h3>
              <SegmentedTabs
                size="sm"
                tabs={[
                  { key: 'IN', label: 'Cổng VÀO (IN)', icon: '🟢' },
                  { key: 'OUT', label: 'Cổng RA (OUT)', icon: '🟠' },
                ]}
                activeKey={direction}
                onChange={(k) => {
                  setDirection(k as 'IN' | 'OUT');
                  inputRef.current?.focus();
                }}
              />
            </div>
            <p>Ô nhập tự động nhận diện thao tác Enter từ đầu đọc cầm tay / cổng xoay ({direction === 'IN' ? 'Chiều VÀO hồ' : 'Chiều RA về'})</p>
            <div className="scanner-input-group">
              <input
                ref={inputRef}
                type="text"
                value={ticketId}
                onChange={(e) => setTicketId(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Đưa mã QR trên vé vào máy quét..."
                className="scanner-input"
                autoFocus
              />
              <button
                type="button"
                className="btn btn-primary btn-check"
                onClick={() => handleCheck()}
                disabled={checking || !ticketId.trim()}
              >
                {checking ? '⏳' : '✓ Kiểm tra'}
              </button>
            </div>
          </div>

          {result ? (
            <div className={`gate-hero-result ${result.success ? 'success' : 'error'}`}>
              <div className="gate-hero-badge">{result.success ? '✓' : '✕'}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="gate-hero-title">{result.message}</div>
                {result.success && result.type_name && (
                  <div className="gate-hero-meta">
                    <span>
                      Loại vé: <strong>{result.type_name}</strong>
                    </span>
                    {result.customer_name && (
                      <span>
                        Khách: <strong>{result.customer_name}</strong>
                      </span>
                    )}
                    {result.pool_close_time && (
                      <span>
                        Đóng cửa lúc: <strong>{result.pool_close_time}</strong>
                      </span>
                    )}
                    {result.remaining_sessions !== undefined && result.remaining_sessions !== null && (
                      <span style={{ color: result.remaining_sessions < 3 ? 'var(--accent-red)' : undefined }}>
                        Còn lại: <strong>{result.remaining_sessions} lượt</strong>
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="ui-card" style={{ marginTop: '16px' }}>
              <EmptyState
                icon="🔍"
                title="Sẵn sàng soát vé"
                description="Mời quét mã QR trên vé của khách để hiển thị trạng thái hợp lệ ngay lập tức."
              />
            </div>
          )}
        </div>

        {/* RIGHT: Session Counters + Recent Live Feed */}
        <div>
          <div className="gate-stats-row">
            <StatCard
              label="Hợp lệ (phiên này)"
              value={successCount}
              tone="green"
              subtext="Lượt quét thành công"
            />
            <StatCard
              label="Từ chối (phiên này)"
              value={failCount}
              tone="red"
              subtext="Vé lỗi / đã dùng"
            />
          </div>

          <div className="gate-feed-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <h3 style={{ fontSize: '13.5px', fontWeight: 700 }}>Lịch sử quét gần nhất</h3>
              <Badge variant="neutral">{history.length} / 20</Badge>
            </div>

            {history.length === 0 ? (
              <p style={{ fontSize: '13px', color: 'var(--text-muted)', textAlign: 'center', padding: '24px 0' }}>
                Chưa có lượt quét nào trong phiên làm việc.
              </p>
            ) : (
              <div className="history-list">
                {history.map((h, i) => (
                  <div key={i} className={`history-item ${h.success ? 'success' : 'error'}`}>
                    <span className="history-icon">{h.success ? '✅' : '❌'}</span>
                    <span className="history-msg">{h.message}</span>
                    {h.type_name && <Badge variant="blue">{h.type_name}</Badge>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
