
import { QRCodeSVG } from 'qrcode.react';

export interface PrintTicketData {
    id: string; // QR code
    customer_name: string | null;
    customer_name_2?: string | null;
    customer_birth_year_2?: number | null;
    guardian_name?: string | null;
    guardian_phone?: string | null;
    category: string;
    type_name: string;
    price_paid?: number;
    sold_at: string;
    valid_from?: string | null;
    valid_until?: string | null;
    remaining_sessions?: number | null;
}

interface PrintTicketModalProps {
    isOpen: boolean;
    onClose: () => void;
    ticket: PrintTicketData | null;
    bizInfo: { name: string; address: string; phone: string; logo: string; pool_close_time?: string };
}

export default function PrintTicketModal({ isOpen, onClose, ticket, bizInfo }: PrintTicketModalProps) {
    if (!isOpen || !ticket) return null;

    const formatPrice = (p: number) => new Intl.NumberFormat('vi-VN').format(p) + 'đ';
    const formatTime = (d: string) => {
        const dt = new Date(d);
        return dt.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) + ' ' +
            dt.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
    };

    const handlePrint = () => {
        const win = window.open('', '_blank', 'width=800,height=600');
        if (!win) return;

        const content = document.getElementById('ticket-print-area')?.innerHTML || '';
        const htmlParts = [
            '<!DOCTYPE html>',
            '<html>',
            '<head>',
            '<meta charset="utf-8">',
            '<title>In Vé</title>',
            '<style>',
            '@media print {',
            '  * { color: #000 !important; background: transparent !important; filter: grayscale(100%) !important; }',
            '  .no-print { display: none !important; }',
            '}',
            'body { font-family: "Times New Roman", Times, serif; width: 80mm; margin: 0 auto; padding: 16px; text-align: center; }',
            'h2 { font-size: 16px; margin: 8px 0; border-bottom: 2px dashed #000; padding-bottom: 8px; }',
            '.subtitle { font-size: 10px; text-transform: uppercase; font-weight: bold; }',
            '.info-row { display: flex; justify-content: space-between; font-size: 12px; margin-bottom: 4px; }',
            '.qr-wrapper { margin: 16px 0; }',
            '.footer { font-size: 11px; margin-top: 16px; border-top: 1px dashed #ccc; padding-top: 8px; }',
            '</style>',
            '</head>',
            '<body>',
            content,
            '<script>setTimeout(function(){window.print();},500);</' + 'script>',
            '</body>',
            '</html>'
        ];

        win.document.write(htmlParts.join('\\n'));
        win.document.close();
        // Optional: close the modal after print command is sent
        // setTimeout(onClose, 500); 
    };

    const isLesson = ticket.category === 'LESSON';
    const isPass = ticket.category === 'MONTHLY' || ticket.category === 'MULTI';

    return (
        <div className="modal-overlay">
            <div className="modal-card" style={{ maxWidth: '350px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                    <h2 style={{ fontSize: '18px', margin: 0 }}>Xem QR / In Lại Vé</h2>
                    <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: '24px', cursor: 'pointer', color: '#64748b' }}>&times;</button>
                </div>

                {/* Printable Area - also visible on screen */}
                <div id="ticket-print-area" style={{ border: '1px solid #e2e8f0', padding: '16px', borderRadius: '12px', background: '#fff', color: '#000', textAlign: 'center' }}>
                    <div style={{ marginBottom: '8px' }}>
                        {bizInfo.logo && <img src={bizInfo.logo} alt="Logo" style={{ maxHeight: '40px', marginBottom: '4px' }} />}
                        <div className="subtitle" style={{ fontSize: '10px', textTransform: 'uppercase', fontWeight: 600 }}>{bizInfo.name || 'Hệ Thống Vé Bơi'}</div>
                    </div>

                    <h2 style={{ fontSize: '16px', margin: '8px 0', borderBottom: '2px dashed #000', paddingBottom: '8px', textTransform: 'uppercase' }}>
                        {isLesson ? '📚 VÉ HỌC BƠI' : isPass ? '🏊 VÉ BƠI TRẢ TRƯỚC' : '🏊 VÉ BƠI'}
                    </h2>

                    <div style={{ textAlign: 'left', fontSize: '13px', lineHeight: '1.6' }}>
                        <div><strong>{isLesson ? 'Học viên 1:' : 'Khách hàng:'}</strong> {ticket.customer_name || 'Khách Vãng Lai'}</div>
                        {ticket.customer_name_2 && (
                            <div><strong>Học viên 2:</strong> {ticket.customer_name_2} - NS: {ticket.customer_birth_year_2 || 'N/A'}</div>
                        )}
                        {ticket.guardian_name && (
                            <div style={{ fontSize: '11px', marginTop: '2px' }}><strong>Giám hộ:</strong> {ticket.guardian_name} - {ticket.guardian_phone}</div>
                        )}

                        {(isPass || isLesson) && (
                            <div><strong>Hiệu lực:</strong> {ticket.valid_from === ticket.valid_until ? 'Trong ngày' : `${ticket.valid_from || '—'} → ${ticket.valid_until || '—'} `}</div>
                        )}

                        {ticket.remaining_sessions !== undefined && ticket.remaining_sessions !== null && (
                            <div style={{ marginTop: '6px', fontWeight: 'bold', borderTop: '1px dashed #ccc', paddingTop: '6px', fontSize: '14px' }}>
                                {isLesson ? 'Số buổi học còn lại' : 'Số buổi bơi còn lại'}: {ticket.remaining_sessions} buổi
                            </div>
                        )}

                        {!isPass && !isLesson && ticket.price_paid !== undefined && (
                            <div className="info-row" style={{ display: 'flex', justifyContent: 'space-between', marginTop: '8px' }}>
                                <span>Giá vé:</span>
                                <strong>{formatPrice(ticket.price_paid)}</strong>
                            </div>
                        )}

                        <div className="info-row" style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span>Bán lúc:</span>
                            <span>{formatTime(ticket.sold_at)}</span>
                        </div>
                        {bizInfo.pool_close_time && (
                            <div className="info-row" style={{ display: 'flex', justifyContent: 'space-between' }}>
                                <span>Hết hạn trong ngày:</span>
                                <span>{bizInfo.pool_close_time}</span>
                            </div>
                        )}
                    </div>

                    <div className="qr-wrapper" style={{ margin: '16px 0', display: 'flex', justifyContent: 'center' }}>
                        <QRCodeSVG
                            value={ticket.id}
                            size={160}
                            level="H"
                            includeMargin
                        />
                    </div>

                    <p className="footer" style={{ fontSize: '11px', marginTop: '16px', borderTop: '1px dashed #ccc', paddingTop: '8px', color: '#666' }}>
                        Mã vé: {ticket.id.substring(0, 8).toUpperCase()}<br />
                        <span style={{ fontSize: '9px', fontStyle: 'italic', marginTop: '4px', display: 'block' }}>Phần mềm quản lý bởi Minads Soft</span>
                    </p>
                </div>

                <div style={{ display: 'flex', gap: '12px', marginTop: '24px' }}>
                    <button className="btn btn-primary" style={{ flex: 1, padding: '12px' }} onClick={handlePrint}>
                        🖨️ In Vé Này
                    </button>
                    <button className="btn btn-secondary" style={{ flex: 1, padding: '12px' }} onClick={onClose}>
                        Đóng
                    </button>
                </div>
            </div>
        </div>
    );
}
