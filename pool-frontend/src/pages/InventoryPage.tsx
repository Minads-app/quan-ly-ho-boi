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

const UNIT_OPTIONS = ['cái', 'chai', 'ly', 'hộp', 'bộ', 'đôi', 'gói', 'lon', 'tuýp', 'cặp'];

export default function InventoryPage() {
    const { profile } = useAuth();
    const [products, setProducts] = useState<RetailProduct[]>([]);
    const [logs, setLogs] = useState<InventoryLog[]>([]);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState<'STOCK' | 'HISTORY' | 'CATALOG'>('STOCK');

    // Slip state
    const [slipMode, setSlipMode] = useState<'IMPORT' | 'EXPORT' | null>(null);
    const [slipItems, setSlipItems] = useState<SlipItem[]>([]);
    const [slipNote, setSlipNote] = useState('');
    const [searchTerm, setSearchTerm] = useState('');
    const [isSaving, setIsSaving] = useState(false);

    // Product CRUD state
    const [showProductModal, setShowProductModal] = useState(false);
    const [editingProduct, setEditingProduct] = useState<RetailProduct | null>(null);
    const [prodName, setProdName] = useState('');
    const [prodPrice, setProdPrice] = useState(0);
    const [prodUnit, setProdUnit] = useState('cái');
    const [saving, setSaving] = useState(false);

    // Variant management state
    const [showVariantModal, setShowVariantModal] = useState(false);
    const [variantParent, setVariantParent] = useState<RetailProduct | null>(null);
    const [varSku, setVarSku] = useState('');
    const [varPrice, setVarPrice] = useState(0);
    const [editingVariant, setEditingVariant] = useState<RetailProduct | null>(null);

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

    // --- SLIP FUNCTIONS ---
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

    // --- PRODUCT CRUD FUNCTIONS ---
    function openNewProductModal() {
        setEditingProduct(null);
        setProdName('');
        setProdPrice(0);
        setProdUnit('cái');
        setShowProductModal(true);
    }

    function openEditProductModal(p: RetailProduct) {
        setEditingProduct(p);
        setProdName(p.name);
        setProdPrice(p.price);
        setProdUnit(p.unit || 'cái');
        setShowProductModal(true);
    }

    async function toggleProductActive(id: string, currentStatus: boolean) {
        await supabase.from('products').update({ is_active: !currentStatus }).eq('id', id);
        fetchProducts();
    }

    async function handleSaveProduct(e: React.FormEvent) {
        e.preventDefault();
        setSaving(true);
        const payload = { name: prodName, price: prodPrice, unit: prodUnit };
        if (editingProduct) {
            await supabase.from('products').update(payload).eq('id', editingProduct.id);
        } else {
            await supabase.from('products').insert([payload]);
        }
        setShowProductModal(false);
        setSaving(false);
        fetchProducts();
    }

    async function handleDeleteProduct(id: string) {
        if (!window.confirm('Bạn có chắc chắn muốn xóa sản phẩm này? Lưu ý: Không thể xóa nếu đã có phát sinh giao dịch/nhập kho.')) return;
        const { error } = await supabase.from('products').delete().eq('id', id);
        if (error) {
            alert('Không thể xóa: Sản phẩm này đã có giao dịch mua bán hoặc lịch sử nhập/xuất kho. Vui lòng chuyển sang "Đã ẩn".');
        } else {
            fetchProducts();
        }
    }

    // --- VARIANT FUNCTIONS ---
    function openAddVariant(parent: RetailProduct) {
        setVariantParent(parent);
        setEditingVariant(null);
        setVarSku('');
        setVarPrice(parent.price);
        setShowVariantModal(true);
    }

    function openEditVariant(variant: RetailProduct, parent: RetailProduct) {
        setVariantParent(parent);
        setEditingVariant(variant);
        setVarSku(variant.sku || '');
        setVarPrice(variant.price);
        setShowVariantModal(true);
    }

    async function handleSaveVariant(e: React.FormEvent) {
        e.preventDefault();
        if (!variantParent) return;
        setSaving(true);

        const variantName = `${variantParent.name} — ${varSku}`;
        const payload = {
            name: variantName,
            sku: varSku,
            price: varPrice,
            unit: variantParent.unit,
            parent_id: variantParent.id,
        };

        if (editingVariant) {
            await supabase.from('products').update({ ...payload }).eq('id', editingVariant.id);
        } else {
            await supabase.from('products').insert([payload]);
        }

        setShowVariantModal(false);
        setSaving(false);
        fetchProducts();
    }

    async function handleDeleteVariant(id: string) {
        if (!window.confirm('Xóa biến thể này?')) return;
        const { error } = await supabase.from('products').delete().eq('id', id);
        if (error) {
            alert('Không thể xóa biến thể này: đã có giao dịch. Vui lòng chuyển sang "Đã ẩn".');
        } else {
            fetchProducts();
        }
    }

    // --- HELPERS ---
    const parentProducts = products.filter(p => !p.parent_id);
    const getVariants = (parentId: string) => products.filter(p => p.parent_id === parentId);
    const hasVariants = (parentId: string) => products.some(p => p.parent_id === parentId);

    // For slip / stock views: show leaf products (standalone + variants, but not parents that have variants)
    const leafProducts = products.filter(p => {
        if (p.parent_id) return true; // Is a variant — show it
        return !hasVariants(p.id); // Show standalone products (no variants)
    });

    const filteredProducts = leafProducts.filter(p => {
        if (!searchTerm.trim()) return true;
        return p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
            (p.sku || '').toLowerCase().includes(searchTerm.toLowerCase());
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
                                            <div style={{ fontSize: '13px', fontWeight: 700, color: '#1a1d27', lineHeight: 1.3, flex: 1 }}>
                                                {p.name}
                                                {p.sku && <span style={{ color: '#64748b', fontWeight: 400 }}> ({p.sku})</span>}
                                            </div>
                                        </div>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 'auto' }}>
                                            <span style={{ fontSize: '12px', color: '#64748b' }}>Kho: <strong>{p.stock_quantity}</strong> {p.unit}</span>
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
                                                Tồn kho: {item.product.stock_quantity} → <strong>{isImport ? item.product.stock_quantity + item.quantity : item.product.stock_quantity - item.quantity}</strong> {item.product.unit}
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

    // ===================== MAIN VIEW =====================
    return (
        <div className="page-container">
            <div className="page-header flex-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                    <h1>📦 Quản lý Kho Hàng</h1>
                    <p>Theo dõi tồn kho, nhập hàng, xuất hủy và quản lý danh mục sản phẩm</p>
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
                <button
                    className={`btn ${activeTab === 'CATALOG' ? 'btn-primary' : 'btn-ghost'}`}
                    style={{ borderRadius: '8px 8px 0 0', padding: '12px 24px', margin: 0 }}
                    onClick={() => setActiveTab('CATALOG')}
                >
                    🛍️ Danh mục Sản phẩm
                </button>
            </div>

            {loading ? (
                <div className="page-loading">Đang tải...</div>
            ) : (
                <div className="dashboard-content-card">
                    {/* ===================== STOCK TAB ===================== */}
                    {activeTab === 'STOCK' && (
                        <div className="table-responsive">
                            <table className="data-table">
                                <thead>
                                    <tr>
                                        <th>Sản phẩm</th>
                                        <th>Tồn kho hiện tại</th>
                                        <th>Đơn vị</th>
                                        <th>Trạng thái bán</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {parentProducts.map(parent => {
                                        const variants = getVariants(parent.id);
                                        const isParentWithVariants = variants.length > 0;
                                        const totalStock = isParentWithVariants
                                            ? variants.reduce((s, v) => s + v.stock_quantity, 0)
                                            : parent.stock_quantity;

                                        return isParentWithVariants ? (
                                            // Parent with variants: show parent row + indented variant rows
                                            <tbody key={parent.id}>
                                                <tr style={{ background: '#f8fafc', fontWeight: 600 }}>
                                                    <td>
                                                        <span style={{ fontSize: '15px' }}>📦 {parent.name}</span>
                                                        <span style={{ fontSize: '11px', color: '#64748b', marginLeft: '8px' }}>({variants.length} biến thể)</span>
                                                    </td>
                                                    <td>
                                                        <span className="badge badge-outline" style={{ fontSize: '13px', padding: '4px 8px' }}>
                                                            Tổng: {totalStock.toLocaleString('vi-VN')}
                                                        </span>
                                                    </td>
                                                    <td>{parent.unit}</td>
                                                    <td>{parent.is_active ? 'Đang bán' : 'Ngừng bán'}</td>
                                                </tr>
                                                {variants.map(v => (
                                                    <tr key={v.id} style={{ opacity: v.is_active ? 1 : 0.6 }}>
                                                        <td style={{ paddingLeft: '40px' }}>
                                                            <span style={{ color: '#64748b', marginRight: '4px' }}>↳</span>
                                                            {v.sku && <span style={{ background: '#e0f2fe', color: '#0369a1', padding: '2px 6px', borderRadius: '6px', fontSize: '11px', fontWeight: 600, marginRight: '6px' }}>{v.sku}</span>}
                                                            {v.name}
                                                        </td>
                                                        <td>
                                                            <span className={`badge ${v.stock_quantity <= 5 ? 'badge-error' : 'badge-success'}`} style={{ fontSize: '14px', padding: '4px 8px' }}>
                                                                {v.stock_quantity.toLocaleString('vi-VN')}
                                                            </span>
                                                        </td>
                                                        <td>{v.unit}</td>
                                                        <td>{v.is_active ? 'Đang bán' : 'Ngừng bán'}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        ) : (
                                            // Standalone product
                                            <tr key={parent.id} style={{ opacity: parent.is_active ? 1 : 0.6 }}>
                                                <td><strong>{parent.name}</strong></td>
                                                <td>
                                                    <span className={`badge ${parent.stock_quantity <= 5 ? 'badge-error' : 'badge-success'}`} style={{ fontSize: '14px', padding: '4px 8px' }}>
                                                        {parent.stock_quantity.toLocaleString('vi-VN')}
                                                    </span>
                                                </td>
                                                <td>{parent.unit}</td>
                                                <td>{parent.is_active ? 'Đang bán' : 'Ngừng bán'}</td>
                                            </tr>
                                        );
                                    })}
                                    {parentProducts.length === 0 && (
                                        <tr><td colSpan={4} style={{ textAlign: 'center' }}>Chưa có sản phẩm nào.</td></tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    )}

                    {/* ===================== HISTORY TAB ===================== */}
                    {activeTab === 'HISTORY' && (
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

                    {/* ===================== CATALOG TAB ===================== */}
                    {activeTab === 'CATALOG' && (
                        <div style={{ animation: 'fadeIn 0.3s ease' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                                <h2 style={{ fontSize: '18px', margin: 0 }}>Danh sách Sản phẩm bán lẻ</h2>
                                <button className="btn btn-primary btn-sm" onClick={openNewProductModal}>
                                    ➕ Thêm Sản phẩm
                                </button>
                            </div>

                            <div className="table-responsive">
                                <table className="data-table">
                                    <thead>
                                        <tr>
                                            <th>Tên sản phẩm</th>
                                            <th>Giá bán</th>
                                            <th>Đơn vị</th>
                                            <th>Tồn kho</th>
                                            <th>Biến thể</th>
                                            <th>Trạng thái</th>
                                            <th>Thao tác</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {parentProducts.map(p => {
                                            const variants = getVariants(p.id);
                                            return (
                                                <tbody key={p.id}>
                                                    <tr style={{ opacity: p.is_active ? 1 : 0.5, background: variants.length > 0 ? '#f8fafc' : undefined }}>
                                                        <td><strong>{p.name}</strong></td>
                                                        <td style={{ fontWeight: 600, color: 'var(--accent-green)' }}>
                                                            {p.price.toLocaleString('vi-VN')}đ
                                                        </td>
                                                        <td>{p.unit}</td>
                                                        <td>
                                                            {variants.length > 0
                                                                ? <span style={{ color: '#64748b', fontSize: '12px' }}>Xem biến thể ↓</span>
                                                                : p.stock_quantity.toLocaleString('vi-VN')
                                                            }
                                                        </td>
                                                        <td>
                                                            <button className="btn btn-ghost btn-sm" style={{ fontSize: '12px' }} onClick={() => openAddVariant(p)}>
                                                                ➕ Thêm biến thể
                                                            </button>
                                                            {variants.length > 0 && (
                                                                <span style={{ fontSize: '11px', color: '#64748b', marginLeft: '4px' }}>({variants.length})</span>
                                                            )}
                                                        </td>
                                                        <td>
                                                            <button
                                                                className={`badge ${p.is_active ? 'badge-success' : 'badge-error'}`}
                                                                onClick={() => toggleProductActive(p.id, p.is_active)}
                                                                style={{ cursor: 'pointer', border: 'none' }}
                                                            >
                                                                {p.is_active ? 'Đang bán' : 'Đã ẩn'}
                                                            </button>
                                                        </td>
                                                        <td>
                                                            <button className="btn btn-ghost btn-sm" onClick={() => openEditProductModal(p)}>
                                                                ✏️ Sửa
                                                            </button>
                                                            <button
                                                                className="btn btn-ghost btn-sm"
                                                                style={{ color: 'var(--alert-red)', marginLeft: '8px' }}
                                                                onClick={() => handleDeleteProduct(p.id)}
                                                            >
                                                                🗑️ Xóa
                                                            </button>
                                                        </td>
                                                    </tr>
                                                    {/* Variant rows */}
                                                    {variants.map(v => (
                                                        <tr key={v.id} style={{ opacity: v.is_active ? 1 : 0.5, background: '#fafbfc' }}>
                                                            <td style={{ paddingLeft: '36px' }}>
                                                                <span style={{ color: '#94a3b8', marginRight: '6px' }}>↳</span>
                                                                {v.sku && <span style={{ background: '#e0f2fe', color: '#0369a1', padding: '2px 6px', borderRadius: '6px', fontSize: '11px', fontWeight: 600, marginRight: '6px' }}>{v.sku}</span>}
                                                                {v.name}
                                                            </td>
                                                            <td style={{ fontWeight: 600, color: 'var(--accent-green)' }}>
                                                                {v.price.toLocaleString('vi-VN')}đ
                                                            </td>
                                                            <td>{v.unit}</td>
                                                            <td>{v.stock_quantity.toLocaleString('vi-VN')}</td>
                                                            <td></td>
                                                            <td>
                                                                <button
                                                                    className={`badge ${v.is_active ? 'badge-success' : 'badge-error'}`}
                                                                    onClick={() => toggleProductActive(v.id, v.is_active)}
                                                                    style={{ cursor: 'pointer', border: 'none' }}
                                                                >
                                                                    {v.is_active ? 'Đang bán' : 'Đã ẩn'}
                                                                </button>
                                                            </td>
                                                            <td>
                                                                <button className="btn btn-ghost btn-sm" onClick={() => openEditVariant(v, p)}>
                                                                    ✏️ Sửa
                                                                </button>
                                                                <button
                                                                    className="btn btn-ghost btn-sm"
                                                                    style={{ color: 'var(--alert-red)', marginLeft: '4px' }}
                                                                    onClick={() => handleDeleteVariant(v.id)}
                                                                >
                                                                    🗑️
                                                                </button>
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            );
                                        })}
                                        {parentProducts.length === 0 && (
                                            <tr><td colSpan={7} style={{ textAlign: 'center' }}>Chưa có sản phẩm nào.</td></tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* ===================== PRODUCT MODAL ===================== */}
            {showProductModal && (
                <div className="modal-overlay">
                    <div className="modal-card" style={{ maxWidth: '450px' }}>
                        <h2>{editingProduct ? 'Sửa Sản phẩm' : 'Thêm Sản phẩm mới'}</h2>
                        <form onSubmit={handleSaveProduct}>
                            <div className="form-group">
                                <label>Tên sản phẩm (VD: Nước khoáng Aquafina)</label>
                                <input type="text" required value={prodName} onChange={e => setProdName(e.target.value)} />
                            </div>
                            <div className="form-row">
                                <div className="form-group">
                                    <label>Giá bán (VND)</label>
                                    <input type="number" min="0" required value={prodPrice} onChange={e => setProdPrice(Number(e.target.value))} />
                                </div>
                                <div className="form-group">
                                    <label>Đơn vị tính</label>
                                    <div style={{ position: 'relative' }}>
                                        <input
                                            list="unitOptions"
                                            type="text"
                                            required
                                            value={prodUnit}
                                            onChange={e => setProdUnit(e.target.value)}
                                            placeholder="cái, chai, ly..."
                                        />
                                        <datalist id="unitOptions">
                                            {UNIT_OPTIONS.map(u => (
                                                <option key={u} value={u} />
                                            ))}
                                        </datalist>
                                    </div>
                                </div>
                            </div>
                            <div className="modal-actions" style={{ marginTop: '24px' }}>
                                <button type="button" className="btn btn-ghost" style={{ flex: 1 }} onClick={() => setShowProductModal(false)} disabled={saving}>Hủy</button>
                                <button type="submit" className="btn btn-primary" style={{ flex: 1 }} disabled={saving}>{saving ? 'Đang lưu...' : 'Lưu sản phẩm'}</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* ===================== VARIANT MODAL ===================== */}
            {showVariantModal && variantParent && (
                <div className="modal-overlay">
                    <div className="modal-card" style={{ maxWidth: '420px' }}>
                        <h2>{editingVariant ? 'Sửa biến thể' : 'Thêm biến thể'}</h2>
                        <p style={{ color: '#64748b', fontSize: '13px', marginBottom: '16px' }}>
                            Sản phẩm gốc: <strong>{variantParent.name}</strong> · Đơn vị: {variantParent.unit}
                        </p>
                        <form onSubmit={handleSaveVariant}>
                            <div className="form-group">
                                <label>Mã biến thể / SKU (VD: "Size 3", "XL", "500ml"...)</label>
                                <input type="text" required value={varSku} onChange={e => setVarSku(e.target.value)} placeholder="VD: Size 3" />
                            </div>
                            <div className="form-group">
                                <label>Giá bán riêng (VND) — để giá gốc nếu giống</label>
                                <input type="number" min="0" required value={varPrice} onChange={e => setVarPrice(Number(e.target.value))} />
                            </div>
                            <div style={{ fontSize: '12px', color: '#64748b', marginBottom: '16px', background: '#f8fafc', padding: '10px 12px', borderRadius: '8px' }}>
                                💡 Tên biến thể sẽ tự động tạo: <strong>"{variantParent.name} — {varSku || '...'}"</strong>
                            </div>
                            <div className="modal-actions">
                                <button type="button" className="btn btn-ghost" style={{ flex: 1 }} onClick={() => setShowVariantModal(false)} disabled={saving}>Hủy</button>
                                <button type="submit" className="btn btn-primary" style={{ flex: 1 }} disabled={saving}>{saving ? 'Đang lưu...' : 'Lưu biến thể'}</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
