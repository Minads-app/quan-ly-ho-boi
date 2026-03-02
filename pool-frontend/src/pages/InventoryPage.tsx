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

export default function InventoryPage() {
    const { profile } = useAuth();
    const [products, setProducts] = useState<RetailProduct[]>([]);
    const [logs, setLogs] = useState<InventoryLog[]>([]);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState<'STOCK' | 'HISTORY'>('STOCK');

    // Modal state
    const [showModal, setShowModal] = useState(false);
    const [selectedProduct, setSelectedProduct] = useState<RetailProduct | null>(null);
    const [actionType, setActionType] = useState<'IMPORT' | 'EXPORT_ADJUST'>('IMPORT');
    const [quantity, setQuantity] = useState<number | ''>('');
    const [note, setNote] = useState('');
    const [isSaving, setIsSaving] = useState(false);

    useEffect(() => {
        fetchData();
    }, [activeTab]);

    async function fetchData() {
        setLoading(true);
        if (activeTab === 'STOCK') {
            const { data } = await supabase
                .from('products')
                .select('*')
                .order('name');
            if (data) setProducts(data);
        } else {
            const { data } = await supabase
                .from('inventory_logs')
                .select(`
                    *,
                    products ( name ),
                    profiles ( full_name )
                `)
                .order('created_at', { ascending: false })
                .limit(100);
            if (data) setLogs(data as any);
        }
        setLoading(false);
    }

    function openAdjustModal(p: RetailProduct) {
        setSelectedProduct(p);
        setActionType('IMPORT');
        setQuantity('');
        setNote('');
        setShowModal(true);
    }

    async function handleSaveAdjustment(e: React.FormEvent) {
        e.preventDefault();
        if (!selectedProduct || !quantity || !profile) return;
        setIsSaving(true);

        let finalQty = Number(quantity);
        if (actionType === 'EXPORT_ADJUST') {
            finalQty = -finalQty;
        }

        const { data, error } = await supabase.rpc('adjust_inventory', {
            p_product_id: selectedProduct.id,
            p_quantity: finalQty,
            p_type: actionType,
            p_note: note || null,
            p_user_id: profile.id
        });

        if (error) {
            alert('Lỗi cập nhật kho: ' + error.message);
        } else if (data && !data.success) {
            alert('Lỗi: ' + data.error);
        } else {
            alert('Cập nhật kho thành công!');
            setShowModal(false);
            fetchData();
        }
        setIsSaving(false);
    }

    if (!profile?.can_manage_inventory && profile?.role !== 'ADMIN') {
        return (
            <div className="page-container">
                <div className="alert alert-error">Bạn không có quyền truy cập Quản lý Kho.</div>
            </div>
        );
    }

    return (
        <div className="page-container">
            <div className="page-header">
                <h1>📦 Quản lý Kho Hàng</h1>
                <p>Theo dõi tồn kho, nhập hàng và xuất hủy</p>
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
                    onClick={() => setActiveTab('HISTORY')}
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
                                        <th>Thao tác</th>
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
                                            <td>
                                                <button className="btn btn-secondary btn-sm" onClick={() => openAdjustModal(p)}>
                                                    Xuất / Nhập Kho
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                    {products.length === 0 && (
                                        <tr><td colSpan={4} style={{ textAlign: 'center' }}>Chưa có sản phẩm nào.</td></tr>
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

            {showModal && selectedProduct && (
                <div className="modal-overlay">
                    <div className="modal-card" style={{ maxWidth: '400px' }}>
                        <h2>Cập nhật Kho: {selectedProduct.name}</h2>
                        <form onSubmit={handleSaveAdjustment}>
                            <div className="form-group">
                                <label>Loại thao tác</label>
                                <select value={actionType} onChange={e => setActionType(e.target.value as any)}>
                                    <option value="IMPORT">Thêm vào kho (Nhập)</option>
                                    <option value="EXPORT_ADJUST">Trừ khỏi kho (Xuất / Hỏng)</option>
                                </select>
                            </div>
                            <div className="form-group">
                                <label>Số lượng {actionType === 'IMPORT' ? 'nhập thêm' : 'xuất đi'}</label>
                                <input type="number" min="1" required value={quantity} onChange={e => setQuantity(Number(e.target.value))} />
                                <div style={{ fontSize: '12px', color: 'gray', marginTop: '4px' }}>Tồn hiện tại: {selectedProduct.stock_quantity}. Sau cập nhật: {actionType === 'IMPORT' ? selectedProduct.stock_quantity + Number(quantity || 0) : selectedProduct.stock_quantity - Number(quantity || 0)}</div>
                            </div>
                            <div className="form-group">
                                <label>Ghi chú (Bắt buộc nếu Xuất)</label>
                                <input type="text" required={actionType === 'EXPORT_ADJUST'} value={note} onChange={e => setNote(e.target.value)} placeholder="Nhập từ nhà cc X / Bị hỏng..." />
                            </div>

                            <div className="modal-actions" style={{ marginTop: '24px' }}>
                                <button type="button" className="btn btn-ghost" style={{ flex: 1 }} onClick={() => setShowModal(false)} disabled={isSaving}>Hủy</button>
                                <button type="submit" className="btn btn-primary" style={{ flex: 1 }} disabled={isSaving}>{isSaving ? 'Đang lưu...' : 'Lưu'}</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
