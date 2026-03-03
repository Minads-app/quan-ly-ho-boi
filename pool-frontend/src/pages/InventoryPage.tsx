import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import type { RetailProduct, InventoryAudit } from '../types';
import * as XLSX from 'xlsx';

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

const DEFAULT_UNIT_OPTIONS = ['cái', 'chai', 'ly', 'hộp', 'bộ', 'đôi', 'gói', 'lon', 'tuýp', 'cặp'];

export default function InventoryPage() {
    const { profile } = useAuth();
    const [products, setProducts] = useState<RetailProduct[]>([]);
    const [logs, setLogs] = useState<InventoryLog[]>([]);
    const [audits, setAudits] = useState<InventoryAudit[]>([]);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState<'STOCK' | 'HISTORY' | 'CATALOG' | 'AUDITS'>('STOCK');

    // Slip state
    const [slipMode, setSlipMode] = useState<'IMPORT' | 'EXPORT' | 'AUDIT' | null>(null);
    const [slipItems, setSlipItems] = useState<SlipItem[]>([]);
    const [auditItems, setAuditItems] = useState<{ product: RetailProduct, actual: number }[]>([]);
    const [showAuditProductSelect, setShowAuditProductSelect] = useState(false);
    const [searchAuditTerm, setSearchAuditTerm] = useState('');
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

    // Variant selection for Slip (Import/Export)
    const [selectingVariantFor, setSelectingVariantFor] = useState<RetailProduct | null>(null);
    const [bizInfo, setBizInfo] = useState<any>({});

    useEffect(() => {
        fetchProducts();
        if (activeTab === 'HISTORY') fetchLogs();
        if (activeTab === 'AUDITS') fetchAudits();
        fetchBizInfo();
    }, [activeTab]);

    async function fetchBizInfo() {
        const { data } = await supabase.from('system_settings').select('*');
        if (data) {
            const info: any = {};
            data.forEach(item => {
                info[item.key] = item.value;
            });
            setBizInfo(info);
        }
    }

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

    async function fetchAudits() {
        const { data } = await supabase
            .from('inventory_audits')
            .select(`*, profiles(full_name)`)
            .order('created_at', { ascending: false })
            .limit(50);
        if (data) setAudits(data as any);
    }

    const printInventorySlip = (mode: 'IMPORT' | 'EXPORT', items: SlipItem[], note: string) => {
        const isA5 = bizInfo.print_format === 'A5';
        const win = window.open('', '_blank', 'width=1024,height=768,scrollbars=yes,resizable=no');
        if (!win) return;

        const slipId = (mode === 'IMPORT' ? 'NK-' : 'XK-') + Date.now().toString().slice(-6);
        const slipTitle = mode === 'IMPORT' ? 'PHIẾU NHẬP KHO' : 'PHIẾU XUẤT KHO';
        const currentDate = new Date().toLocaleString('vi-VN');

        const trs = items.map((it, i) => `
            <tr>
                <td style="text-align: center;">${i + 1}</td>
                <td>${it.product.name}</td>
                <td style="text-align: center;">${it.product.unit || 'cái'}</td>
                <td style="text-align: right; font-weight: bold;">${it.quantity}</td>
            </tr>
        `).join('');

        const htmlParts = [
            '<!DOCTYPE html>',
            '<html>',
            '<head>',
            '<meta charset="utf-8">',
            '<title>In Phiếu Kho</title>',
            '<style>',
            '@page { size: ' + (isA5 ? 'A5 relative' : '80mm auto') + '; margin: 0; }',
            '@media screen { body { width: ' + (isA5 ? '100%' : '80mm') + '; aspect-ratio: 4/3; margin: 0 auto; overflow: hidden; } }',
            '@media print { * { color: #000 !important; background: transparent !important; filter: grayscale(100%) !important; } }',
            '* { margin: 0; padding: 0; box-sizing: border-box; }',
            'body { font-family: "Times New Roman", Times, serif; width: 100%; max-width: ' + (isA5 ? '148mm' : '320px') + '; margin: 0 auto; padding: ' + (isA5 ? '20px' : '16px') + '; font-size: ' + (isA5 ? '18px' : '13px') + '; color: #000; background: #fff; }',
            '.text-center { text-align: center; }',
            '.mb-2 { margin-bottom: 8px; }',
            '.mb-4 { margin-bottom: 16px; }',
            'h1 { font-size: ' + (isA5 ? '24px' : '18px') + '; text-transform: uppercase; margin-bottom: 4px; }',
            'h2 { font-size: ' + (isA5 ? '20px' : '16px') + '; text-transform: uppercase; margin-bottom: 16px; border-bottom: 2px dashed #000; padding-bottom: 8px; }',
            '.info-row { display: flex; justify-content: space-between; margin-bottom: 6px; }',
            '.items-table { width: 100%; border-collapse: collapse; margin-top: 16px; margin-bottom: 16px; font-size: 14px; }',
            '.items-table th, .items-table td { border: 1px solid #000; padding: 6px; }',
            '.items-table th { font-weight: bold; background: #eee; }',
            '.footer { text-align: center; margin-top: 32px; font-size: 14px; font-style: italic; display: flex; justify-content: space-around; }',
            '.footer div { width: 45%; }',
            '</style>',
            '</head>',
            '<body>',
            '<div class="text-center mb-4">',
            bizInfo.business_logo ? '<img src="' + bizInfo.business_logo + '" style="max-height: 50px; margin-bottom: 8px;" />' : '',
            '<h1>' + (bizInfo.business_name || 'Hệ Thống Vé Bơi') + '</h1>',
            bizInfo.business_address ? '<div style="font-size: 12px;">' + bizInfo.business_address + '</div>' : '',
            '</div>',
            '<h2 class="text-center">' + slipTitle + '</h2>',
            '<div class="info-row"><span>Mã phiếu:</span> <strong>' + slipId + '</strong></div>',
            '<div class="info-row"><span>Thời gian:</span> <span>' + currentDate + '</span></div>',
            '<div class="info-row"><span>Người lập:</span> <span>' + (profile?.full_name || 'Admin') + '</span></div>',
            note ? '<div class="info-row"><span>Ghi chú:</span> <span>' + note + '</span></div>' : '',
            '<table class="items-table">',
            '<thead><tr><th>STT</th><th>Sản phẩm</th><th>ĐVT</th><th>Số lượng</th></tr></thead>',
            '<tbody>' + trs + '</tbody>',
            '</table>',
            '<div class="footer">',
            '<div><p>Người giao/nhận</p><br><br><p>(Ký, ghi rõ họ tên)</p></div>',
            '<div><p>Người lập phiếu</p><br><br><p>' + (profile?.full_name || 'Admin') + '</p></div>',
            '</div>',
            '<div style="text-align: center; margin-top: 32px; font-size: 10px; color: #888; font-style: italic;">Phần mềm quản lý bởi Minads Soft</div>',
            '<script>setTimeout(function(){window.print();},500);</' + 'script>',
            '</body>',
            '</html>'
        ];
        win.document.write(htmlParts.join('\\n'));
        win.document.close();
    };

    const fetchAuditDetails = async (auditId: string) => {
        const { data, error } = await supabase
            .from('inventory_audit_items')
            .select(`*, products ( name, unit, sku )`)
            .eq('audit_id', auditId);
        if (error) {
            alert('Lỗi khi tải chi tiết phiếu kiểm kho');
            return null;
        }
        return data as any[];
    };

    const printAuditSlipWithData = async (auditId: string, note: string | null) => {
        const items = await fetchAuditDetails(auditId);
        if (!items) return;

        const win = window.open('', '_blank', 'width=1024,height=768,scrollbars=yes,resizable=no');
        if (!win) return;

        const slipTitle = 'PHIẾU KIỂM KHO';
        const currentDate = new Date().toLocaleString('vi-VN');

        const trs = items.map((it, i) => {
            const diff = it.difference;
            const diffColor = diff > 0 ? '#10b981' : (diff < 0 ? '#ef4444' : '#000');
            const diffText = diff > 0 ? '+' + diff : diff;
            return `
            <tr>
                <td style="text-align: center;">${i + 1}</td>
                <td>${it.products.name} ${it.products.sku ? `(SKU: ${it.products.sku})` : ''}</td>
                <td style="text-align: center;">${it.products.unit || 'cái'}</td>
                <td style="text-align: right;">${it.system_quantity}</td>
                <td style="text-align: right; font-weight: bold;">${it.actual_quantity}</td>
                <td style="text-align: right; color: ${diffColor}; font-weight: bold;">${diffText}</td>
            </tr>
        `}).join('');

        const htmlParts = [
            '<!DOCTYPE html>',
            '<html>',
            '<head>',
            '<meta charset="utf-8">',
            '<title>In Phiếu Kiểm Kho</title>',
            '<style>',
            '@page { size: landscape; margin: 0; }',
            '@media screen { body { width: 100%; max-width: 297mm; margin: 0 auto; overflow: hidden; } }',
            '@media print { * { color: #000 !important; background: transparent !important; filter: grayscale(100%) !important; } }',
            '* { margin: 0; padding: 0; box-sizing: border-box; }',
            'body { font-family: "Times New Roman", Times, serif; width: 100%; max-width: 297mm; margin: 0 auto; padding: 20px; font-size: 14px; color: #000; background: #fff; }',
            '.text-center { text-align: center; }',
            '.mb-2 { margin-bottom: 8px; }',
            '.mb-4 { margin-bottom: 16px; }',
            'h1 { font-size: 24px; text-transform: uppercase; margin-bottom: 4px; }',
            'h2 { font-size: 20px; text-transform: uppercase; margin-bottom: 16px; border-bottom: 2px dashed #000; padding-bottom: 8px; }',
            '.info-row { display: flex; justify-content: space-between; margin-bottom: 6px; }',
            '.items-table { width: 100%; border-collapse: collapse; margin-top: 16px; margin-bottom: 16px; font-size: 14px; }',
            '.items-table th, .items-table td { border: 1px solid #000; padding: 8px; }',
            '.items-table th { font-weight: bold; background: #eee; }',
            '.footer { text-align: center; margin-top: 32px; font-size: 14px; font-style: italic; display: flex; justify-content: space-around; }',
            '.footer div { width: 45%; }',
            '</style>',
            '</head>',
            '<body>',
            '<div class="text-center mb-4">',
            bizInfo.business_logo ? '<img src="' + bizInfo.business_logo + '" style="max-height: 50px; margin-bottom: 8px;" />' : '',
            '<h1>' + (bizInfo.business_name || 'Hệ Thống Vé Bơi') + '</h1>',
            bizInfo.business_address ? '<div style="font-size: 12px;">' + bizInfo.business_address + '</div>' : '',
            '</div>',
            '<h2 class="text-center">' + slipTitle + '</h2>',
            '<div class="info-row"><span>Mã phiếu:</span> <strong>' + auditId.substring(0, 8).toUpperCase() + '</strong></div>',
            '<div class="info-row"><span>Thời gian:</span> <span>' + currentDate + '</span></div>',
            '<div class="info-row"><span>Người lập:</span> <span>' + (profile?.full_name || 'Admin') + '</span></div>',
            note ? '<div class="info-row"><span>Ghi chú:</span> <span>' + note + '</span></div>' : '',
            '<table class="items-table">',
            '<thead><tr><th>STT</th><th>Sản phẩm</th><th>ĐVT</th><th>Tồn hệ thống</th><th>Tồn thực tế</th><th>Chênh lệch</th></tr></thead>',
            '<tbody>' + trs + '</tbody>',
            '</table>',
            '<div class="footer">',
            '<div><p>Quản lý</p><br><br><p>(Ký, ghi rõ họ tên)</p></div>',
            '<div><p>Người lập phiếu</p><br><br><p>' + (profile?.full_name || 'Admin') + '</p></div>',
            '</div>',
            '<div style="text-align: center; margin-top: 32px; font-size: 10px; color: #888; font-style: italic;">Phần mềm quản lý bởi Minads Soft</div>',
            '<script>setTimeout(function(){window.print();},500);</' + 'script>',
            '</body>',
            '</html>'
        ];
        win.document.write(htmlParts.join('\\n'));
        win.document.close();
    };

    const exportAuditToExcel = async (auditId: string, note: string | null) => {
        const items = await fetchAuditDetails(auditId);
        if (!items) return;

        const dataRows = items.map((it, i) => ({
            'STT': i + 1,
            'Mã Phiếu': auditId.substring(0, 8).toUpperCase(),
            'Sản Phẩm': it.products.name,
            'SKU': it.products.sku || '',
            'ĐVT': it.products.unit,
            'Tồn Hệ Thống': it.system_quantity,
            'Tồn Thực Tế': it.actual_quantity,
            'Chênh Lệch': it.difference,
            'Ghi chú phiếu': note || ''
        }));

        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.json_to_sheet(dataRows);
        XLSX.utils.book_append_sheet(wb, ws, "Phieu_Kiem_Kho");
        XLSX.writeFile(wb, `Kiem_Kho_${auditId.substring(0, 8)}.xlsx`);
    };

    // --- SLIP FUNCTIONS ---
    function openSlip(mode: 'IMPORT' | 'EXPORT' | 'AUDIT') {
        setSlipMode(mode);
        setSlipItems([]);
        setAuditItems([]);
        setSlipNote('');
        setSearchTerm('');
        setSearchAuditTerm('');
    }

    function closeSlip() {
        setSlipMode(null);
        setSlipItems([]);
        setAuditItems([]);
        setSlipNote('');
        setSearchTerm('');
        setSearchAuditTerm('');
        setSelectingVariantFor(null);
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
            if (window.confirm('Bạn có muốn in phiếu này không?')) {
                printInventorySlip(slipMode as 'IMPORT' | 'EXPORT', slipItems, slipNote);
            }
            closeSlip();
            fetchProducts();
        }
    }

    // --- AUDIT FUNCTIONS ---
    function handleAddAllProductsToAudit() {
        const items = products.filter(p => p.is_active).map(p => ({ product: p, actual: p.stock_quantity }));
        setAuditItems(items);
        setShowAuditProductSelect(false);
    }

    function toggleAuditProductSelect(product: RetailProduct, forceState?: boolean) {
        setAuditItems(prev => {
            const exists = prev.some(x => x.product.id === product.id);
            if (forceState === true && !exists) {
                return [...prev, { product, actual: product.stock_quantity }];
            }
            if (forceState === false && exists) {
                return prev.filter(x => x.product.id !== product.id);
            }
            if (forceState === undefined) {
                if (exists) return prev.filter(x => x.product.id !== product.id);
                return [...prev, { product, actual: product.stock_quantity }];
            }
            return prev;
        });
    }

    function updateAuditItemActual(productId: string, actual: number) {
        setAuditItems(prev => prev.map(x => x.product.id === productId ? { ...x, actual } : x));
    }

    function removeAuditItem(productId: string) {
        setAuditItems(prev => prev.filter(x => x.product.id !== productId));
    }

    async function handleSubmitAudit() {
        if (!profile || auditItems.length === 0) return;
        setIsSaving(true);

        const payload = auditItems.map(item => ({
            product_id: item.product.id,
            system_quantity: item.product.stock_quantity,
            actual_quantity: item.actual
        }));

        const { data, error } = await supabase.rpc('balance_inventory_audit', {
            p_note: slipNote || null,
            p_user_id: profile.id,
            p_items: payload
        });

        setIsSaving(false);

        if (error) {
            alert('Lỗi tạo phiếu kiểm kho: ' + error.message);
            return;
        }

        if (data && !data.success) {
            alert('Lỗi xử lý cân bằng kho: ' + data.error);
            return;
        }

        alert('✅ Cân bằng kho & lưu phiếu kiểm kê thành công!');
        closeSlip();
        fetchProducts();
        if (activeTab === 'AUDITS') fetchAudits();
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

    // Dynamic unit options from existing products
    const existingUnits = Array.from(new Set(products.map(p => p.unit).filter(Boolean)));
    const unitOptions = Array.from(new Set([...DEFAULT_UNIT_OPTIONS, ...existingUnits])).sort();

    // For slip views: show ONLY parent products (which have variants grouped inside) or standalone products
    const gridProducts = products.filter(p => p.parent_id === null);

    const filteredProducts = gridProducts.filter(p => {
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
                                const variants = getVariants(p.id);
                                const hasVars = variants.length > 0;
                                const totalStock = hasVars ? variants.reduce((s, v) => s + v.stock_quantity, 0) : p.stock_quantity;

                                // check if ANY variant of this parent is in the slip
                                const inSlipCount = slipItems.filter(x => x.product.parent_id === p.id || x.product.id === p.id).reduce((s, x) => s + x.quantity, 0);
                                const inSlip = inSlipCount > 0;

                                const isDisabled = !isImport && totalStock <= 0;

                                return (
                                    <button key={p.id} onClick={() => {
                                        if (isDisabled) return;
                                        if (hasVars) {
                                            setSelectingVariantFor(p);
                                        } else {
                                            addToSlip(p);
                                        }
                                    }} disabled={isDisabled}
                                        style={{
                                            background: inSlip ? (isImport ? '#f0fdf4' : '#fffbeb') : '#fff',
                                            border: inSlip ? `2px solid ${modeColor}` : '1px solid #e2e8f0',
                                            borderRadius: '12px', padding: '14px',
                                            cursor: isDisabled ? 'not-allowed' : 'pointer', textAlign: 'left' as const,
                                            boxShadow: '0 1px 4px rgba(0,0,0,0.04)', transition: 'all 0.15s',
                                            borderTop: `3px solid ${inSlip ? modeColor : '#e2e8f0'}`,
                                            opacity: isDisabled ? 0.5 : 1,
                                            display: 'flex', flexDirection: 'column' as const, gap: '8px', minHeight: '110px',
                                        }}
                                        onMouseEnter={e => { if (!isDisabled) { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 6px 16px rgba(0,0,0,0.08)'; e.currentTarget.style.borderColor = modeColor; e.currentTarget.style.borderTopColor = modeColor; } }}
                                        onMouseLeave={e => { if (!isDisabled && !inSlip) { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = '0 1px 4px rgba(0,0,0,0.04)'; e.currentTarget.style.borderColor = '#e2e8f0'; e.currentTarget.style.borderTopColor = '#e2e8f0'; } else if (!isDisabled && inSlip) { e.currentTarget.style.transform = ''; } }}
                                    >
                                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                                            <span style={{ fontSize: '18px' }}>📦</span>
                                            <div style={{ fontSize: '14px', fontWeight: 600, color: '#1e293b', lineHeight: 1.3, flex: 1, textOverflow: 'ellipsis', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as const }}>
                                                {p.name}
                                                {p.sku && !hasVars && <div style={{ color: '#64748b', fontWeight: 400, fontSize: '12px', marginTop: '2px' }}>{p.sku}</div>}
                                            </div>
                                        </div>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 'auto', width: '100%' }}>
                                            {hasVars ? (
                                                <div style={{ background: '#f8fafc', padding: '4px 8px', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
                                                    <div style={{ fontSize: '12px', fontWeight: 700, color: '#0f172a' }}>{variants.length} Lựa chọn</div>
                                                    <div style={{ fontSize: '11px', color: '#64748b' }}>Tổng kho: {totalStock}</div>
                                                </div>
                                            ) : (
                                                <div style={{ fontSize: '13px', color: '#64748b' }}>
                                                    Kho: <strong style={{ color: '#1e293b' }}>{totalStock}</strong> {p.unit}
                                                </div>
                                            )}
                                            {inSlip && (
                                                <span style={{ background: modeColor, color: '#fff', padding: '4px 10px', borderRadius: '12px', fontSize: '12px', fontWeight: 700 }}>
                                                    x{inSlipCount}
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

                {/* SLIP VARIANT SELECTION MODAL */}
                {selectingVariantFor && (
                    <div className="modal-overlay" style={{ zIndex: 1100 }}>
                        <div className="modal-card" style={{ maxWidth: '450px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                                <h2 style={{ fontSize: '18px', margin: 0 }}>Chọn phân loại: {selectingVariantFor.name}</h2>
                                <button onClick={() => setSelectingVariantFor(null)} style={{ background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer', color: '#64748b' }}>&times;</button>
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '60vh', overflowY: 'auto', paddingRight: '4px' }}>
                                {getVariants(selectingVariantFor.id).filter(v => v.is_active).map(variant => {
                                    const isDisabled = slipMode === 'EXPORT' && variant.stock_quantity <= 0;
                                    const inSlipObj = slipItems.find(x => x.product.id === variant.id);

                                    return (
                                        <button
                                            key={variant.id}
                                            disabled={isDisabled}
                                            onClick={() => {
                                                addToSlip(variant);
                                                // Optional: Don't close immediately so user can pick multiple variants
                                                // setSelectingVariantFor(null);
                                            }}
                                            style={{
                                                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                                padding: '14px 16px', borderRadius: '12px', border: `1px solid ${!isDisabled ? '#e2e8f0' : '#f1f5f9'}`,
                                                background: !isDisabled ? (inSlipObj ? (slipMode === 'IMPORT' ? '#f0fdf4' : '#fffbeb') : '#fff') : '#f8fafc',
                                                cursor: !isDisabled ? 'pointer' : 'not-allowed',
                                                opacity: !isDisabled ? 1 : 0.6,
                                                boxShadow: !isDisabled ? '0 1px 2px rgba(0,0,0,0.05)' : 'none',
                                                transition: 'all 0.2s ease', textAlign: 'left'
                                            }}
                                            onMouseEnter={e => {
                                                if (!isDisabled) {
                                                    e.currentTarget.style.borderColor = modeColor;
                                                    e.currentTarget.style.boxShadow = `0 4px 12px ${modeColor}22`;
                                                    e.currentTarget.style.transform = 'translateY(-1px)';
                                                }
                                            }}
                                            onMouseLeave={e => {
                                                if (!isDisabled) {
                                                    e.currentTarget.style.borderColor = '#e2e8f0';
                                                    e.currentTarget.style.boxShadow = '0 1px 2px rgba(0,0,0,0.05)';
                                                    e.currentTarget.style.transform = 'translateY(0)';
                                                }
                                            }}
                                        >
                                            <div>
                                                <div style={{ fontWeight: 700, fontSize: '15px', color: '#1e293b', marginBottom: '4px' }}>
                                                    {variant.sku || variant.name.replace(selectingVariantFor.name + ' — ', '')}
                                                </div>
                                                <div style={{ fontSize: '13px', color: '#64748b' }}>
                                                    {variant.price.toLocaleString('vi-VN')}đ / {variant.unit}
                                                </div>
                                            </div>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                                {inSlipObj && (
                                                    <span style={{ background: modeColor, color: '#fff', padding: '4px 10px', borderRadius: '12px', fontSize: '12px', fontWeight: 700 }}>
                                                        Đã chọn: x{inSlipObj.quantity}
                                                    </span>
                                                )}
                                                <div style={{ textAlign: 'right' }}>
                                                    {!isDisabled ? (
                                                        <span style={{ background: '#e2e8f0', color: '#334155', padding: '4px 8px', borderRadius: '8px', fontSize: '12px', fontWeight: 600 }}>
                                                            Kho: {variant.stock_quantity}
                                                        </span>
                                                    ) : (
                                                        <span style={{ background: '#fee2e2', color: '#991b1b', padding: '4px 8px', borderRadius: '8px', fontSize: '12px', fontWeight: 600 }}>
                                                            Hết hàng
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>
                            <div style={{ marginTop: '16px', textAlign: 'right', borderTop: '1px solid #e2e8f0', paddingTop: '16px' }}>
                                <button className="btn btn-primary" onClick={() => setSelectingVariantFor(null)} style={{ background: modeColor, borderColor: modeColor }}>
                                    Xong
                                </button>
                            </div>
                        </div>
                    </div>
                )
                }
            </div >
        );
    }

    // ===================== AUDIT MODE (Full-width form) =====================
    if (slipMode === 'AUDIT') {
        const filteredAuditProducts = parentProducts.filter(p => {
            if (!searchAuditTerm.trim()) return true;
            return p.name.toLowerCase().includes(searchAuditTerm.toLowerCase()) ||
                (p.sku || '').toLowerCase().includes(searchAuditTerm.toLowerCase());
        });

        return (
            <div className="page-container" style={{ maxWidth: '1000px' }}>
                <div className="page-header flex-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                        <h1>📝 Tạo Phiếu Kiểm Kho</h1>
                        <p>Cập nhật số lượng tồn thực tế để cân bằng với hệ thống</p>
                    </div>
                    <button className="btn btn-ghost" onClick={closeSlip} style={{ fontSize: '14px' }}>
                        ← Quay lại Kho
                    </button>
                </div>

                <div style={{ background: '#fff', borderRadius: '16px', boxShadow: '0 4px 20px rgba(0,0,0,0.06)', padding: '24px', animation: 'fadeIn 0.3s ease', display: 'flex', flexDirection: 'column', gap: '24px' }}>

                    {/* Header Controls: Search & Add All */}
                    <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
                        <div style={{ flex: 1, position: 'relative' }}>
                            <span style={{ position: 'absolute', left: '16px', top: '50%', transform: 'translateY(-50%)', fontSize: '18px', color: '#94a3b8' }}>🔍</span>
                            <div
                                style={{ width: '100%', padding: '14px 16px 14px 48px', border: '1px solid #e2e8f0', borderRadius: '12px', fontSize: '15px', color: '#64748b', cursor: 'text', background: '#f8fafc' }}
                                onClick={() => setShowAuditProductSelect(true)}
                            >
                                Bấm để tìm và chọn sản phẩm kiểm kê...
                            </div>
                        </div>
                        <button className="btn btn-outline" style={{ padding: '14px 24px', borderRadius: '12px', color: '#0ea5e9', borderColor: '#0ea5e9', background: '#f0f9ff' }} onClick={handleAddAllProductsToAudit}>
                            <span style={{ fontSize: '18px', marginRight: '8px' }}>📋</span> Thêm tất cả sản phẩm
                        </button>
                    </div>

                    {/* Check List Table */}
                    <div className="table-responsive" style={{ border: '1px solid #e2e8f0', borderRadius: '12px', overflow: 'hidden' }}>
                        <table className="data-table" style={{ margin: 0 }}>
                            <thead style={{ background: '#f8fafc' }}>
                                <tr>
                                    <th style={{ width: '40px' }}>STT</th>
                                    <th>Sản phẩm</th>
                                    <th style={{ width: '15%', textAlign: 'right' }}>Tồn hệ thống</th>
                                    <th style={{ width: '20%', textAlign: 'center' }}>Tồn thực tế</th>
                                    <th style={{ width: '15%', textAlign: 'right' }}>Chênh lệch</th>
                                    <th style={{ width: '60px', textAlign: 'center' }}>Xoá</th>
                                </tr>
                            </thead>
                            <tbody>
                                {auditItems.length > 0 ? auditItems.map((item, idx) => {
                                    const diff = item.actual - item.product.stock_quantity;
                                    const diffColor = diff > 0 ? '#10b981' : (diff < 0 ? '#ef4444' : '#64748b');
                                    return (
                                        <tr key={item.product.id}>
                                            <td style={{ textAlign: 'center', color: '#64748b' }}>{idx + 1}</td>
                                            <td>
                                                <div style={{ fontWeight: 600, color: '#1e293b' }}>{item.product.name}</div>
                                                <div style={{ fontSize: '12px', color: '#94a3b8' }}>ĐVT: {item.product.unit} {item.product.sku ? `· SKU: ${item.product.sku}` : ''}</div>
                                            </td>
                                            <td style={{ textAlign: 'right' }}>
                                                <span style={{ fontWeight: 600, color: '#334155' }}>{item.product.stock_quantity.toLocaleString('vi-VN')}</span>
                                            </td>
                                            <td style={{ textAlign: 'center' }}>
                                                <input
                                                    type="number"
                                                    min="0"
                                                    value={item.actual.toString()}
                                                    onChange={e => updateAuditItemActual(item.product.id, Math.max(0, parseInt(e.target.value) || 0))}
                                                    style={{ width: '100px', padding: '8px 12px', border: '1px solid #cbd5e1', borderRadius: '8px', fontSize: '15px', fontWeight: 600, background: '#f8fafc', color: '#0f172a', outline: 'none', textAlign: 'center' }}
                                                    onFocus={e => e.currentTarget.select()}
                                                />
                                            </td>
                                            <td style={{ textAlign: 'right' }}>
                                                <span style={{ fontWeight: 700, color: diffColor, background: diffColor + '15', padding: '4px 8px', borderRadius: '6px' }}>
                                                    {diff > 0 ? '+' : ''}{diff.toLocaleString('vi-VN')}
                                                </span>
                                            </td>
                                            <td style={{ textAlign: 'center' }}>
                                                <button onClick={() => removeAuditItem(item.product.id)} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '18px', opacity: 0.6 }} onMouseEnter={e => e.currentTarget.style.opacity = '1'} onMouseLeave={e => e.currentTarget.style.opacity = '0.6'}>&times;</button>
                                            </td>
                                        </tr>
                                    );
                                }) : (
                                    <tr>
                                        <td colSpan={6} style={{ textAlign: 'center', padding: '40px 0', color: '#94a3b8' }}>
                                            <div style={{ fontSize: '40px', marginBottom: '8px' }}>🛒</div>
                                            <p>Chưa có sản phẩm nào trong danh sách kiểm kê.</p>
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>

                    {/* Note & Submit */}
                    <div style={{ display: 'flex', gap: '24px', alignItems: 'flex-start', background: '#f8fafc', padding: '20px', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
                        <div style={{ flex: 1 }}>
                            <label style={{ display: 'block', fontWeight: 600, color: '#334155', marginBottom: '8px' }}>Ghi chú kiểm kho</label>
                            <input
                                type="text"
                                placeholder="Nhập ghi chú (VD: Kiểm kê định kỳ tháng...)"
                                value={slipNote}
                                onChange={e => setSlipNote(e.target.value)}
                                style={{
                                    width: '100%', padding: '12px 16px', border: '1px solid #cbd5e1',
                                    borderRadius: '8px', fontSize: '14px', outline: 'none'
                                }}
                            />
                        </div>
                        <div style={{ width: '250px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '15px', fontWeight: 600, color: '#334155', paddingBottom: '8px', borderBottom: '1px dashed #cbd5e1' }}>
                                <span>Tổng mặt hàng:</span>
                                <span style={{ color: '#0ea5e9' }}>{auditItems.length}</span>
                            </div>
                            <div style={{ display: 'flex', gap: '8px' }}>
                                <button className="btn btn-ghost" style={{ flex: 1 }} onClick={closeSlip}>Hủy</button>
                                <button
                                    className="btn btn-primary"
                                    style={{ flex: 2, background: '#0ea5e9', borderColor: '#0ea5e9' }}
                                    disabled={auditItems.length === 0 || isSaving}
                                    onClick={handleSubmitAudit}
                                >
                                    {isSaving ? 'Đang lưu...' : 'Cân Bằng Kho'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>

                {/* PRODUCT SELECTION MODAL for AUDIT */}
                {showAuditProductSelect && (
                    <div className="modal-overlay" style={{ zIndex: 1200 }}>
                        <div className="modal-card" style={{ width: '800px', maxWidth: '90vw', height: '80vh', padding: 0, display: 'flex', flexDirection: 'column' }}>
                            <div style={{ padding: '20px 24px', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#f8fafc', borderTopLeftRadius: '16px', borderTopRightRadius: '16px' }}>
                                <h2 style={{ fontSize: '20px', margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <button onClick={() => setShowAuditProductSelect(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '20px', color: '#64748b' }}>&lt;</button>
                                    Tất cả sản phẩm
                                </h2>
                                <button onClick={() => setShowAuditProductSelect(false)} style={{ background: 'none', border: 'none', fontSize: '24px', cursor: 'pointer', color: '#94a3b8' }}>&times;</button>
                            </div>

                            <div style={{ padding: '16px 24px', borderBottom: '1px solid #e2e8f0' }}>
                                <div style={{ position: 'relative' }}>
                                    <span style={{ position: 'absolute', left: '16px', top: '50%', transform: 'translateY(-50%)', fontSize: '16px', color: '#94a3b8' }}>🔍</span>
                                    <input
                                        type="text"
                                        placeholder="Tìm tên sản phẩm hoặc SKU..."
                                        value={searchAuditTerm}
                                        onChange={e => setSearchAuditTerm(e.target.value)}
                                        autoFocus
                                        style={{ width: '100%', padding: '12px 16px 12px 42px', border: '1px solid #cbd5e1', borderRadius: '10px', fontSize: '15px', outline: 'none' }}
                                    />
                                    {searchAuditTerm && <button onClick={() => setSearchAuditTerm('')} style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', fontSize: '18px', color: '#94a3b8' }}>&times;</button>}
                                </div>
                            </div>

                            <div style={{ flex: 1, overflowY: 'auto', padding: '0' }}>
                                <table className="data-table" style={{ margin: 0, borderTop: 'none' }}>
                                    <thead style={{ position: 'sticky', top: 0, zIndex: 1, background: '#f8fafc', boxShadow: '0 1px 2px rgba(0,0,0,0.05)' }}>
                                        <tr>
                                            <th style={{ width: '40px', textAlign: 'center', padding: '12px 8px' }}></th>
                                            <th style={{ padding: '12px 16px' }}>Sản phẩm</th>
                                            <th style={{ width: '15%', padding: '12px 16px' }}>SKU</th>
                                            <th style={{ width: '20%', textAlign: 'right', padding: '12px 24px' }}>Tồn kho</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {filteredAuditProducts.map(parent => {
                                            const variants = getVariants(parent.id);
                                            const hasVars = variants.length > 0;
                                            const totalStock = hasVars ? variants.reduce((s, v) => s + v.stock_quantity, 0) : parent.stock_quantity;

                                            // Check selection states
                                            const isParentSelected = !hasVars ? auditItems.some(x => x.product.id === parent.id) : variants.every(v => auditItems.some(x => x.product.id === v.id));
                                            const isIndeterminate = hasVars && !isParentSelected && variants.some(v => auditItems.some(x => x.product.id === v.id));

                                            return (
                                                <React.Fragment key={parent.id}>
                                                    <tr style={{ background: isParentSelected ? '#f0f9ff' : '#fff', cursor: 'pointer' }} onClick={() => {
                                                        if (hasVars) {
                                                            variants.forEach(v => toggleAuditProductSelect(v, !isParentSelected));
                                                        } else {
                                                            toggleAuditProductSelect(parent, !isParentSelected);
                                                        }
                                                    }}>
                                                        <td style={{ textAlign: 'center', padding: '16px 8px' }}>
                                                            <input
                                                                type="checkbox"
                                                                checked={isParentSelected}
                                                                ref={el => { if (el) el.indeterminate = isIndeterminate; }}
                                                                readOnly
                                                                style={{ width: '18px', height: '18px', cursor: 'pointer', accentColor: '#0ea5e9' }}
                                                            />
                                                        </td>
                                                        <td style={{ padding: '16px' }}>
                                                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                                                <div style={{ width: '40px', height: '40px', background: '#f1f5f9', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '20px', color: '#94a3b8' }}>
                                                                    📦
                                                                </div>
                                                                <span style={{ fontWeight: 600, fontSize: '15px', color: '#1e293b' }}>{parent.name.toUpperCase()}</span>
                                                            </div>
                                                        </td>
                                                        <td style={{ color: '#64748b' }}>{parent.sku || '-'}</td>
                                                        <td style={{ textAlign: 'right', padding: '16px 24px', fontWeight: 600, color: '#334155' }}>
                                                            {totalStock.toLocaleString('vi-VN')} {parent.unit}
                                                        </td>
                                                    </tr>
                                                    {/* Variant rows */}
                                                    {hasVars && variants.map(variant => {
                                                        const isVarSelected = auditItems.some(x => x.product.id === variant.id);
                                                        return (
                                                            <tr key={variant.id} style={{ background: isVarSelected ? '#f8fafc' : '#fff', cursor: 'pointer' }} onClick={(e) => { e.stopPropagation(); toggleAuditProductSelect(variant, !isVarSelected); }}>
                                                                <td style={{ textAlign: 'center', padding: '12px 8px' }}>
                                                                    <div style={{ marginLeft: '24px' }}>
                                                                        <input
                                                                            type="checkbox"
                                                                            checked={isVarSelected}
                                                                            readOnly
                                                                            style={{ width: '16px', height: '16px', cursor: 'pointer', accentColor: '#0ea5e9' }}
                                                                        />
                                                                    </div>
                                                                </td>
                                                                <td style={{ padding: '12px 16px', paddingLeft: '70px', color: '#334155', fontSize: '14px' }}>
                                                                    {variant.sku || variant.name.replace(parent.name + ' — ', '')}
                                                                </td>
                                                                <td style={{ color: '#64748b', fontSize: '13px' }}>{variant.sku || '-'}</td>
                                                                <td style={{ textAlign: 'right', padding: '12px 24px', color: '#64748b', fontSize: '14px' }}>
                                                                    {variant.stock_quantity.toLocaleString('vi-VN')} {variant.unit}
                                                                </td>
                                                            </tr>
                                                        );
                                                    })}
                                                </React.Fragment>
                                            );
                                        })}
                                        {filteredAuditProducts.length === 0 && (
                                            <tr><td colSpan={4} style={{ textAlign: 'center', padding: '40px', color: '#94a3b8' }}>Không tìm thấy sản phẩm.</td></tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>

                            <div style={{ padding: '16px 24px', borderTop: '1px solid #e2e8f0', background: '#f8fafc', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottomLeftRadius: '16px', borderBottomRightRadius: '16px' }}>
                                <div style={{ fontSize: '14px', color: '#64748b' }}>
                                    Đã chọn <strong>{auditItems.length}</strong> sản phẩm
                                </div>
                                <div style={{ display: 'flex', gap: '8px' }}>
                                    <button className="btn btn-ghost" onClick={() => setShowAuditProductSelect(false)}>Hủy</button>
                                    <button className="btn btn-primary" style={{ background: '#0ea5e9', borderColor: '#0ea5e9', padding: '10px 24px' }} onClick={() => setShowAuditProductSelect(false)}>Hoàn tất chọn</button>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

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
                    <button className="btn btn-primary" style={{ background: '#0ea5e9', borderColor: '#0ea5e9' }} onClick={() => openSlip('AUDIT')}>
                        📝 Kiểm Kho
                    </button>
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
                    className={`btn ${activeTab === 'AUDITS' ? 'btn-primary' : 'btn-ghost'}`}
                    style={{ borderRadius: '8px 8px 0 0', padding: '12px 24px', margin: 0 }}
                    onClick={() => { setActiveTab('AUDITS'); fetchAudits(); }}
                >
                    Phiếu Kiểm Kho
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
                                                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '4px' }}>
                                                            <span className="badge badge-outline" style={{ fontSize: '13px', padding: '4px 8px' }}>
                                                                Tổng: {totalStock.toLocaleString('vi-VN')}
                                                            </span>
                                                            <span style={{ color: '#0ea5e9', fontSize: '12px', textDecoration: 'underline', cursor: 'pointer' }} onClick={() => { setActiveTab('CATALOG'); setTimeout(() => openEditProductModal(parent), 100); }}>Xem chi tiết →</span>
                                                        </div>
                                                    </td>
                                                    <td>{parent.unit}</td>
                                                    <td>{parent.is_active ? 'Đang bán' : 'Ngừng bán'}</td>
                                                </tr>
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

                    {/* ===================== AUDITS TAB ===================== */}
                    {activeTab === 'AUDITS' && (
                        <div className="table-responsive">
                            <table className="data-table">
                                <thead>
                                    <tr>
                                        <th>Mã Phiếu</th>
                                        <th>Thời gian</th>
                                        <th>Người lập</th>
                                        <th>Trạng thái</th>
                                        <th>Ghi chú</th>
                                        <th style={{ textAlign: 'center' }}>Thao tác</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {audits.map(audit => (
                                        <tr key={audit.id}>
                                            <td><strong>{audit.id.substring(0, 8).toUpperCase()}</strong></td>
                                            <td>{new Date(audit.created_at).toLocaleString('vi-VN')}</td>
                                            <td>{audit.profiles?.full_name || 'Hệ thống'}</td>
                                            <td><span className="badge badge-success">Đã cân bằng</span></td>
                                            <td style={{ maxWidth: '200px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                                {audit.note || '-'}
                                            </td>
                                            <td style={{ textAlign: 'center' }}>
                                                <button className="btn btn-ghost btn-sm" onClick={() => printAuditSlipWithData(audit.id, audit.note)} title="In Phiếu Khổ A4 Ngang">
                                                    🖨️ In
                                                </button>
                                                <button className="btn btn-ghost btn-sm" onClick={() => exportAuditToExcel(audit.id, audit.note)} title="Xuất file Excel" style={{ marginLeft: '4px' }}>
                                                    📊 Excel
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                    {audits.length === 0 && (
                                        <tr><td colSpan={6} style={{ textAlign: 'center' }}>Chưa có phiếu kiểm kho nào.</td></tr>
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
                                                <React.Fragment key={p.id}>
                                                    <tr style={{ opacity: p.is_active ? 1 : 0.5, background: variants.length > 0 ? '#f8fafc' : undefined }}>
                                                        <td><strong>{p.name}</strong></td>
                                                        <td style={{ fontWeight: 600, color: 'var(--accent-green)' }}>
                                                            {p.price.toLocaleString('vi-VN')}đ
                                                        </td>
                                                        <td>{p.unit}</td>
                                                        <td>
                                                            {variants.length > 0
                                                                ? <span style={{ color: '#0ea5e9', fontSize: '13px', textDecoration: 'underline', cursor: 'pointer' }} onClick={() => openEditProductModal(p)}>Xem biến thể ↓</span>
                                                                : p.stock_quantity.toLocaleString('vi-VN')
                                                            }
                                                        </td>
                                                        <td>
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
                                                </React.Fragment>
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
            )
            }

            {/* ===================== PRODUCT MODAL ===================== */}
            {
                showProductModal && (
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
                                                {unitOptions.map(u => (
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

                            {/* Variants Management inside Product Modal */}
                            {editingProduct && (
                                <div style={{ marginTop: '32px', borderTop: '1px solid #e2e8f0', paddingTop: '20px' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                                        <h3 style={{ fontSize: '15px', margin: 0 }}>Quản lý biến thể ({getVariants(editingProduct.id).length})</h3>
                                        <button type="button" className="btn btn-outline btn-sm" onClick={() => openAddVariant(editingProduct)}>
                                            ➕ Thêm biến thể
                                        </button>
                                    </div>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                        {getVariants(editingProduct.id).map(v => (
                                            <div key={v.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px', background: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0', opacity: v.is_active ? 1 : 0.6 }}>
                                                <div>
                                                    <div style={{ fontWeight: 600, fontSize: '14px', color: '#1e293b' }}>
                                                        {v.sku && <span style={{ background: '#e0f2fe', color: '#0369a1', padding: '2px 6px', borderRadius: '4px', fontSize: '11px', marginRight: '6px' }}>{v.sku}</span>}
                                                        {v.name.replace(editingProduct.name + ' — ', '')}
                                                    </div>
                                                    <div style={{ fontSize: '12px', color: '#64748b', marginTop: '4px' }}>
                                                        Giá: {v.price.toLocaleString('vi-VN')}đ · Tồn kho: <strong>{v.stock_quantity.toLocaleString('vi-VN')}</strong> {v.unit}
                                                    </div>
                                                </div>
                                                <div style={{ display: 'flex', gap: '4px' }}>
                                                    <button type="button" className="btn btn-ghost btn-sm" style={{ padding: '4px 8px' }} onClick={() => toggleProductActive(v.id, v.is_active)} title={v.is_active ? "Ngừng bán" : "Mở bán lại"}>
                                                        {v.is_active ? '👁️' : '🙈'}
                                                    </button>
                                                    <button type="button" className="btn btn-ghost btn-sm" style={{ padding: '4px 8px' }} onClick={() => openEditVariant(v, editingProduct)}>✏️</button>
                                                    <button type="button" className="btn btn-ghost btn-sm" style={{ padding: '4px 8px', color: '#ef4444' }} onClick={() => handleDeleteVariant(v.id)}>🗑️</button>
                                                </div>
                                            </div>
                                        ))}
                                        {getVariants(editingProduct.id).length === 0 && (
                                            <div style={{ textAlign: 'center', padding: '16px', color: '#94a3b8', fontSize: '13px', fontStyle: 'italic', background: '#f8fafc', borderRadius: '8px', border: '1px dashed #cbd5e1' }}>
                                                Sản phẩm này chưa có biến thể nào.
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                )
            }

            {/* ===================== VARIANT MODAL ===================== */}
            {
                showVariantModal && variantParent && (
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
                )
            }
        </div >
    );
}
