import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import type { RetailProduct } from '../types';

interface InventoryLog {
    id: string;
    product_id: string;
    type: 'IMPORT' | 'EXPORT_ADJUST' | 'SALE';
    quantity: number;
    note: string | null;
    created_by: string;
    created_at: string;
    products?: { name: string };
    profiles?: { full_name: string };
}

interface SlipItem {
    product: RetailProduct;
    quantity: number;
}

export default function InventoryPage() {
    const { profile } = useAuth();
    const [products, setProducts] = useState<RetailProduct[]>([]);
    const [logs, setLogs] = useState<InventoryLog[]>([]);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState<'STOCK' | 'HISTORY'>('STOCK');

    // Slip state
    const [slipMode, setSlipMode] = useState<'IMPORT' | 'EXPORT' | null>(null);
    const [slipItems, setSlipItems] = useState<SlipItem[]>([]);
    const [slipNote, setSlipNote] = useState('');
    const [searchTerm, setSearchTerm] = useState('');
    const [isSaving, setIsSaving] = useState(false);

    useEffect(() => {
        fetchProducts();
        if (activeTab === 'HISTORY') fetchLogs();
    }, [activeTab]);

    async function fetchProducts() {
        setLoading(true);
        const { data } = await supabase.from('products').select('*').order('name');
        if (data) setProducts(data);
        setLoading(false);
    }

    async function fetchLogs() {
        const { data } = await supabase
            .from('inventory_logs')
            .select(`*, products ( name ), profiles ( full_name )`)
            .order('created_at', { ascending: false })
            .limit(100);
        if (data) setLogs(data as any);
    }

    function openSlip(mode: 'IMPORT' | 'EXPORT') {
        setSlipMode(mode);
        setSlipItems([]);
        setSlipNote('');
        setSearchTerm('');
    }

    function closeSlip() {
        setSlipMode(null);
        setSlipItems([]);
        setSlipNote('');
        setSearchTerm('');
    }

    function addToSlip(product: RetailProduct) {
        setSlipItems(prev => {
            const existing = prev.find(x => x.product.id === product.id);
            if (existing) {
                return prev.map(x => x.product.id === product.id ? { ...x, quantity: x.quantity + 1 } : x);
            }
            return [...prev, { product, quantity: 1 }];
        });
    }

    function updateSlipQty(productId: string, qty: number) {
        if (qty <= 0) {
            setSlipItems(prev => prev.filter(x => x.product.id !== productId));
        } else {
            setSlipItems(prev => prev.map(x => x.product.id === productId ? { ...x, quantity: qty } : x));
        }
    }

    function removeFromSlip(productId: string) {
        setSlipItems(prev => prev.filter(x => x.product.id !== productId));
    }

    async function handleSubmitSlip() {
        if (!profile || slipItems.length === 0) return;
        if (slipMode === 'EXPORT' && !slipNote.trim()) {
            alert('Vui lòng nhập ghi chú cho phiếu xuất kho!');
            return;
        }

        setIsSaving(true);
        let hasError = false;

        for (const item of slipItems) {
            const finalQty = slipMode === 'IMPORT' ? item.quantity : -item.quantity;
            const type = slipMode === 'IMPORT' ? 'IMPORT' : 'EXPORT_ADJUST';

            const { data, error } = await supabase.rpc('adjust_inventory', {
                p_product_id: item.product.id,
                p_quantity: finalQty,
                p_type: type,
                p_note: slipNote || null,
                p_user_id: profile.id
            });

            if (error) {
                alert(`Lỗi xử lý "${item.product.name}": ${error.message}`);
                hasError = true;
                break;
            } else if (data && !data.success) {
                alert(`Lỗi "${item.product.name}": ${data.error}`);
                hasError = true;
                break;
            }
        }

        setIsSaving(false);
        if (!hasError) {
            alert(`✅ ${slipMode === 'IMPORT' ? 'Nhập kho' : 'Xuất kho'} ${slipItems.length} sản phẩm thành công!`);
            closeSlip();
            fetchProducts();
        }
    }

    const filteredProducts = products.filter(p => {
        if (!searchTerm.trim()) return true;
        return p.name.toLowerCase().includes(searchTerm.toLowerCase());
    });

    if (!profile?.can_manage_inventory && profile?.role !== 'ADMIN') {
        return (
            <div className="page-container">
                <div className="alert alert-error">Bạn không có quyền truy cập Quản lý Kho.</div>
            </div>
        );
    }

    // ===================== SLIP MODE (like POS cart) =====================
    if (slipMode) {
        const isImport = slipMode === 'IMPORT';
        const modeColor = isImport ? '#10b981' : '#f59e0b';
        const modeLabel = isImport ? 'Nhập Kho' : 'Xuất Kho';
        const modeIcon = isImport ? '📥' : '📤';

        return (
            <div className="page-container" style={{ maxWidth: '1200px' }}>
                <div className="page-header flex-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                        <h1>{modeIcon} Phiếu {modeLabel}</h1>
                        <p>Tìm sản phẩm và thêm vào phiếu để {isImport ? 'nhập' : 'xuất'} hàng loạt</p>
                    </div>
                    <button className="btn btn-ghost" onClick={closeSlip} style={{ fontSize: '14px' }}>
                        ← Quay lại Kho
                    </button>
                </div>

                <div style={{ display: 'flex', gap: '24px', animation: 'fadeIn 0.3s ease', alignItems: 'flex-start' }}>
                    {/* LEFT: Product search + grid */}
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '16px' }}>
                        {/* Search */}
                        <div style={{ position: 'relative' }}>
                            <span style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', fontSize: '17px', color: '#94a3b8' }}>🔍</span>
                            <input
                                type="text"
                                placeholder="Tìm sản phẩm..."
                                value={searchTerm}
                                onChange={e => setSearchTerm(e.target.value)}
                                autoFocus
                                style={{
                                    width: '100%', padding: '12px 16px 12px 44px', border: '1px solid #e2e8f0',
                                    borderRadius: '12px', fontSize: '14px', background: '#fff',
                                    boxShadow: '0 1px 3px rgba(0,0,0,0.04)', outline: 'none',
                                    transition: 'border-color 0.2s',
                                }}
                                onFocus={e => e.currentTarget.style.borderColor = modeColor}
                                onBlur={e => e.currentTarget.style.borderColor = '#e2e8f0'}
                            />
                            {searchTerm && (
                                <button onClick={() => setSearchTerm('')}
                                    style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', fontSize: '16px', color: '#94a3b8' }}>✕</button>
                            )}
                        </div>

                        {/* Product grid */}
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '12px', alignContent: 'start' }}>
                            {filteredProducts.length > 0 ? filteredProducts.map(p => {
                                const inSlip = slipItems.find(x => x.product.id === p.id);
                                const isDisabled = !isImport && p.stock_quantity <= 0;
                                return (
                                    <button key={p.id} onClick={() => !isDisabled && addToSlip(p)} disabled={isDisabled}
                                        style={{
                                            background: inSlip ? (isImport ? '#f0fdf4' : '#fffbeb') : '#fff',
                                            border: inSlip ? `2px solid ${modeColor}` : '1px solid #f1f5f9',
                                            borderRadius: '12px', padding: '14px',
                                            cursor: isDisabled ? 'not-allowed' : 'pointer', textAlign: 'left' as const,
                                            boxShadow: '0 1px 4px rgba(0,0,0,0.04)', transition: 'all 0.15s',
                                            borderTop: `3px solid ${modeColor}`,
                                            opacity: isDisabled ? 0.5 : 1,
                                            display: 'flex', flexDirection: 'column' as const, gap: '6px', minHeight: '100px',
                                        }}
                                        onMouseEnter={e => { if (!isDisabled) { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 4px 16px rgba(0,0,0,0.1)'; } }}
                                        onMouseLeave={e => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = '0 1px 4px rgba(0,0,0,0.04)'; }}
                                    >
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                            <span style={{ fontSize: '17px' }}>📦</span>
                                            <div style={{ fontSize: '13px', fontWeight: 700, color: '#1a1d27', lineHeight: 1.3, flex: 1 }}>{p.name}</div>
                                        </div>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 'auto' }}>
                                            <span style={{ fontSize: '12px', color: '#64748b' }}>Kho: <strong>{p.stock_quantity}</strong></span>
                                            {inSlip && (
                                                <span style={{ background: modeColor, color: '#fff', padding: '2px 8px', borderRadius: '10px', fontSize: '11px', fontWeight: 700 }}>
                                                    x{inSlip.quantity}
                                                </span>
                                            )}
                                        </div>
                                    </button>
                                );
                            }) : (
                                <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '40px 0', color: '#94a3b8' }}>
                                    <div style={{ fontSize: '40px', marginBottom: '8px' }}>🔍</div>
                                    <p>Không tìm thấy sản phẩm "{searchTerm}"</p>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* RIGHT: Slip (cart) */}
                    <div style={{ width: '360px', background: '#fff', borderRadius: '16px', boxShadow: '0 4px 20px rgba(0,0,0,0.06)', display: 'flex', flexDirection: 'column', maxHeight: 'calc(100vh - 120px)', position: 'sticky', top: '24px' }}>
                        {/* Header */}
                        <div style={{ padding: '20px', borderBottom: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <h2 style={{ fontSize: '18px', margin: 0 }}>{modeIcon} Phiếu {modeLabel}</h2>
                            <span style={{ background: modeColor + '22', color: modeColor, padding: '4px 12px', borderRadius: '20px', fontSize: '13px', fontWeight: 600 }}>{slipItems.length} SP</span>
                        </div>

                        {/* Items */}
                        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                            {slipItems.length === 0 ? (
                                <div style={{ textAlign: 'center', color: 'var(--text-muted)', margin: '40px 0' }}>
                                    <div style={{ fontSize: '40px', marginBottom: '12px' }}>📋</div>
                                    <p>Chưa có sản phẩm nào</p>
                                    <p style={{ fontSize: '12px', color: '#94a3b8', marginTop: '4px' }}>Nhấn vào sản phẩm bên trái để thêm</p>
                                </div>
                            ) : (
                                slipItems.map(item => (
                                    <div key={item.product.id} style={{ display: 'flex', gap: '12px', paddingBottom: '12px', borderBottom: '1px dashed #e2e8f0', alignItems: 'center' }}>
                                        <div style={{ flex: 1 }}>
                                            <div style={{ fontWeight: 600, fontSize: '14px', marginBottom: '4px', display: 'flex', justifyContent: 'space-between' }}>
                                                <span>{item.product.name}</span>
                                                <button onClick={() => removeFromSlip(item.product.id)} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', padding: '0 4px', fontSize: '16px' }}>&times;</button>
                                            </div>
                                            <div style={{ fontSize: '11px', color: '#64748b', marginBottom: '6px' }}>
                                                Tồn kho: {item.product.stock_quantity} → <strong>{isImport ? item.product.stock_quantity + item.quantity : item.product.stock_quantity - item.quantity}</strong>
                                            </div>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '0', background: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                                                    <button onClick={() => updateSlipQty(item.product.id, item.quantity - 1)}
                                                        style={{ border: 'none', background: 'none', width: '32px', height: '32px', cursor: 'pointer', fontWeight: 'bold', fontSize: '16px' }}>−</button>
                                                    <input type="number" min="1" value={item.quantity}
                                                        onChange={e => updateSlipQty(item.product.id, Math.max(1, Number(e.target.value)))}
                                                        style={{ width: '50px', textAlign: 'center', border: 'none', background: 'transparent', fontSize: '14px', fontWeight: 700, outline: 'none' }}
                                                    />
                                                    <button onClick={() => updateSlipQty(item.product.id, item.quantity + 1)}
                                                        style={{ border: 'none', background: 'none', width: '32px', height: '32px', cursor: 'pointer', fontWeight: 'bold', fontSize: '16px' }}>+</button>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>

                        {/* Footer */}
                        <div style={{ padding: '16px 20px', background: '#f8fafc', borderTop: '1px solid #e2e8f0', borderBottomLeftRadius: '16px', borderBottomRightRadius: '16px' }}>
                            {/* Note input */}
                            <div style={{ marginBottom: '12px' }}>
                                <input
                                    type="text"
                                    placeholder={isImport ? 'Ghi chú (VD: Nhập từ NCC X)' : 'Ghi chú bắt buộc (VD: Hàng hỏng, hết HSD...)'}
                                    value={slipNote}
                                    onChange={e => setSlipNote(e.target.value)}
                                    required={!isImport}
                                    style={{
                                        width: '100%', padding: '10px 12px', border: '1px solid #e2e8f0',
                                        borderRadius: '8px', fontSize: '13px', outline: 'none',
                                    }}
                                />
                            </div>

                            {/* Total items summary */}
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px', fontSize: '15px', fontWeight: 700 }}>
                                <span>Tổng số lượng:</span>
                                <span style={{ color: modeColor }}>{slipItems.reduce((s, i) => s + i.quantity, 0)} sản phẩm</span>
                            </div>

                            <button
                                className="btn btn-primary"
                                style={{ width: '100%', padding: '14px', fontSize: '15px', background: modeColor, borderColor: modeColor }}
                                disabled={slipItems.length === 0 || isSaving}
                                onClick={handleSubmitSlip}
                            >
                                {isSaving ? 'Đang xử lý...' : `${modeIcon} Xác nhận ${modeLabel}`}
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    // ===================== MAIN VIEW (Stock table / History) =====================
    return (
        <div className="page-container">
            <div className="page-header flex-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                    <h1>📦 Quản lý Kho Hàng</h1>
                    <p>Theo dõi tồn kho, nhập hàng và xuất hủy</p>
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                    <button className="btn btn-primary" style={{ background: '#10b981', borderColor: '#10b981' }} onClick={() => openSlip('IMPORT')}>
                        📥 Nhập Kho
                    </button>
                    <button className="btn btn-primary" style={{ background: '#f59e0b', borderColor: '#f59e0b' }} onClick={() => openSlip('EXPORT')}>
                        📤 Xuất Kho
                    </button>
                </div>
            </div>

            <div style={{ display: 'flex', gap: '16px', borderBottom: '1px solid var(--border-color)', marginBottom: '24px' }}>
                <button
                    className={`btn ${activeTab === 'STOCK' ? 'btn-primary' : 'btn-ghost'}`}
                    style={{ borderRadius: '8px 8px 0 0', padding: '12px 24px', margin: 0 }}
                    onClick={() => setActiveTab('STOCK')}
                >
                    Danh sách Tồn kho
                </button>
                <button
                    className={`btn ${activeTab === 'HISTORY' ? 'btn-primary' : 'btn-ghost'}`}
                    style={{ borderRadius: '8px 8px 0 0', padding: '12px 24px', margin: 0 }}
                    onClick={() => { setActiveTab('HISTORY'); fetchLogs(); }}
                >
                    Lịch sử Nhập/Xuất
                </button>
            </div>

            {loading ? (
                <div className="page-loading">Đang tải...</div>
            ) : (
                <div className="dashboard-content-card">
                    {activeTab === 'STOCK' ? (
                        <div className="table-responsive">
                            <table className="data-table">
                                <thead>
                                    <tr>
                                        <th>Sản phẩm</th>
                                        <th>Tồn kho hiện tại</th>
                                        <th>Trạng thái bán</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {products.map(p => (
                                        <tr key={p.id} style={{ opacity: p.is_active ? 1 : 0.6 }}>
                                            <td><strong>{p.name}</strong></td>
                                            <td>
                                                <span className={`badge ${p.stock_quantity <= 5 ? 'badge-error' : 'badge-success'}`} style={{ fontSize: '14px', padding: '4px 8px' }}>
                                                    {p.stock_quantity.toLocaleString('vi-VN')}
                                                </span>
                                            </td>
                                            <td>{p.is_active ? 'Đang bán' : 'Ngừng bán'}</td>
                                        </tr>
                                    ))}
                                    {products.length === 0 && (
                                        <tr><td colSpan={3} style={{ textAlign: 'center' }}>Chưa có sản phẩm nào.</td></tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    ) : (
                        <div className="table-responsive">
                            <table className="data-table">
                                <thead>
                                    <tr>
                                        <th>Thời gian</th>
                                        <th>Sản phẩm</th>
                                        <th>Loại Giao Dịch</th>
                                        <th>Số lượng</th>
                                        <th>Người thực hiện</th>
                                        <th>Ghi chú</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {logs.map(log => (
                                        <tr key={log.id}>
                                            <td>{new Date(log.created_at).toLocaleString('vi-VN')}</td>
                                            <td><strong>{log.products?.name}</strong></td>
                                            <td>
                                                {log.type === 'IMPORT' && <span className="badge badge-success">Nhập kho</span>}
                                                {log.type === 'EXPORT_ADJUST' && <span className="badge badge-warning">Xuất/Điều chỉnh</span>}
                                                {log.type === 'SALE' && <span className="badge badge-outline">Bán hàng</span>}
                                            </td>
                                            <td style={{ color: log.quantity > 0 ? 'var(--accent-green)' : 'var(--alert-red)', fontWeight: 'bold' }}>
                                                {log.quantity > 0 ? `+${log.quantity}` : log.quantity}
                                            </td>
                                            <td>{log.profiles?.full_name || 'Hệ thống'}</td>
                                            <td style={{ maxWidth: '200px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                                {log.note || '-'}
                                            </td>
                                        </tr>
                                    ))}
                                    {logs.length === 0 && (
                                        <tr><td colSpan={6} style={{ textAlign: 'center' }}>Chưa có lịch sử.</td></tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
