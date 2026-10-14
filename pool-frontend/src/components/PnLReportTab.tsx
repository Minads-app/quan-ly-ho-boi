/* eslint-disable @typescript-eslint/no-explicit-any, react-hooks/exhaustive-deps */
import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import * as XLSX from 'xlsx';
import {
    ResponsiveContainer,
    ComposedChart,
    Bar,
    Line,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    Legend,
} from 'recharts';
import type {
    FinancialCategory,
    FixedCostTemplate,
    FinancialTransaction,
    FinancialType,
    CostType,
    PaymentMethodType,
    FundSourceType,
} from '../types';
import {
    fetchFinancialCategories,
    saveFinancialCategory,
    fetchFixedCostTemplates,
    saveFixedCostTemplate,
    deleteFixedCostTemplate,
    fetchFinancialTransactions,
    saveFinancialTransaction,
    deleteFinancialTransaction,
    applyFixedCostsForPeriod,
    getMonthsInRange,
} from '../utils/financialService';

type PnLPeriodMode = 'THIS_MONTH' | 'LAST_MONTH' | 'THIS_QUARTER' | 'THIS_YEAR' | 'MONTH_RANGE' | 'DATE_RANGE';

interface PnLReportTabProps {
    bizInfo: { name: string; address: string; phone: string; logo: string };
    onPrintReport: (title: string, tableHtml: string) => void;
}

const fmt = (n: number) => new Intl.NumberFormat('vi-VN').format(Math.round(n)) + 'đ';
const fmtDate = (d: string | null) =>
    d ? new Date(d + (d.length === 10 ? 'T00:00:00' : '')).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—';

const thS: React.CSSProperties = {
    textAlign: 'left',
    padding: '10px 12px',
    fontSize: '12px',
    fontWeight: 600,
    color: 'var(--text-secondary)',
    borderBottom: '2px solid var(--border-color)',
    whiteSpace: 'nowrap',
    background: 'var(--bg-card)',
};
const tdS: React.CSSProperties = {
    padding: '10px 12px',
    fontSize: '13px',
    borderBottom: '1px solid var(--border-color)',
};

export default function PnLReportTab({ onPrintReport }: PnLReportTabProps) {
    const { profile } = useAuth();
    const isAdmin = profile?.role === 'ADMIN';

    // Strict Admin-only enforcement
    if (!isAdmin) {
        return (
            <div className="alert alert-error" style={{ marginTop: '16px' }}>
                🔒 Chức năng Báo cáo Kết quả Kinh doanh và Hạch toán Thu - Chi bổ sung chỉ dành riêng cho Quản trị viên (ADMIN).
            </div>
        );
    }

    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const currentMonthStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
    const todayStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

    // Period filter state
    const [periodMode, setPeriodMode] = useState<PnLPeriodMode>('THIS_MONTH');
    const [fromMonth, setFromMonth] = useState<string>(`${now.getFullYear()}-01`);
    const [toMonth, setToMonth] = useState<string>(currentMonthStr);
    const [customFromDate, setCustomFromDate] = useState<string>(`${currentMonthStr}-01`);
    const [customToDate, setCustomToDate] = useState<string>(todayStr);

    // Options
    const [includeShiftExpenses, setIncludeShiftExpenses] = useState<boolean>(true);
    const [includeCoachPayroll, setIncludeCoachPayroll] = useState<boolean>(true);
    const [showMinimumGuide, setShowMinimumGuide] = useState<boolean>(false);

    // Loaded data
    const [loading, setLoading] = useState<boolean>(false);
    const [categories, setCategories] = useState<FinancialCategory[]>([]);
    const [templates, setTemplates] = useState<FixedCostTemplate[]>([]);
    const [finTransactions, setFinTransactions] = useState<FinancialTransaction[]>([]);
    const [ticketsData, setTicketsData] = useState<any[]>([]);
    const [retailData, setRetailData] = useState<any[]>([]);
    const [shiftExpenses, setShiftExpenses] = useState<any[]>([]);
    const [coachPayrollTotal, setCoachPayrollTotal] = useState<number>(0);
    const [coachPayrollByMonth, setCoachPayrollByMonth] = useState<Record<string, number>>({});

    // Filter for transaction ledger table
    const [txFilter, setTxFilter] = useState<'ALL' | 'INCOME' | 'FIXED' | 'VARIABLE' | 'SHIFT'>('ALL');
    const [txSearch, setTxSearch] = useState<string>('');

    // --- MODAL 1: ADD / EDIT TRANSACTION (THU KHÁC / ĐỊNH PHÍ / BIẾN PHÍ - CÓ CHỌN NGÀY QUÁ KHỨ) ---
    const [showTxModal, setShowTxModal] = useState<boolean>(false);
    const [editingTxId, setEditingTxId] = useState<string | null>(null);
    const [txDate, setTxDate] = useState<string>(todayStr);
    const [txType, setTxType] = useState<FinancialType>('EXPENSE');
    const [txCostType, setTxCostType] = useState<CostType>('VARIABLE');
    const [txCategoryId, setTxCategoryId] = useState<string>('');
    const [txAmount, setTxAmount] = useState<number | ''>('');
    const [txPaymentMethod, setTxPaymentMethod] = useState<PaymentMethodType>('TRANSFER');
    const [txFundSource, setTxFundSource] = useState<FundSourceType>('COMPANY_FUND');
    const [txDescription, setTxDescription] = useState<string>('');
    const [txSaving, setTxSaving] = useState<boolean>(false);

    // --- MODAL 2: FIXED COST TEMPLATES & PERIOD APPLICATION ---
    const [showFixedModal, setShowFixedModal] = useState<boolean>(false);
    const [fixedModalTab, setFixedModalTab] = useState<'APPLY' | 'TEMPLATES'>('APPLY');
    const [applyScope, setApplyScope] = useState<'CURRENT_MONTH' | 'PERIOD_RANGE'>('CURRENT_MONTH');
    const [applySingleMonth, setApplySingleMonth] = useState<string>(currentMonthStr);
    const [applyFromMonth, setApplyFromMonth] = useState<string>(`${now.getFullYear()}-01`);
    const [applyToMonth, setApplyToMonth] = useState<string>(currentMonthStr);
    const [duplicateMode, setDuplicateMode] = useState<'SKIP_EXISTING' | 'OVERWRITE_EXISTING'>('SKIP_EXISTING');
    const [selectedTemplateIds, setSelectedTemplateIds] = useState<Record<string, boolean>>({});
    const [overrideAmounts, setOverrideAmounts] = useState<Record<string, number>>({});
    const [applyingFixed, setApplyingFixed] = useState<boolean>(false);

    // Template form inside Fixed Modal
    const [editingTplId, setEditingTplId] = useState<string | null>(null);
    const [tplName, setTplName] = useState<string>('');
    const [tplCategoryId, setTplCategoryId] = useState<string>('11111111-0001-4000-8000-000000000001');
    const [tplAmount, setTplAmount] = useState<number | ''>('');
    const [tplPaymentMethod, setTplPaymentMethod] = useState<PaymentMethodType>('TRANSFER_COMPANY');
    const [tplDayOfMonth, setTplDayOfMonth] = useState<number>(1);
    const [tplNote, setTplNote] = useState<string>('');
    const [tplSaving, setTplSaving] = useState<boolean>(false);

    // --- MODAL 3: CATEGORIES MANAGER ---
    const [showCatModal, setShowCatModal] = useState<boolean>(false);
    const [newCatName, setNewCatName] = useState<string>('');
    const [newCatType, setNewCatType] = useState<FinancialType>('EXPENSE');
    const [newCatCostType, setNewCatCostType] = useState<'FIXED' | 'VARIABLE'>('VARIABLE');
    const [newCatDesc, setNewCatDesc] = useState<string>('');
    const [catSaving, setCatSaving] = useState<boolean>(false);

    function getDateBounds(): { from: string; to: string; label: string } {
        const y = now.getFullYear();
        const m = now.getMonth() + 1;

        if (periodMode === 'THIS_MONTH') {
            const first = `${y}-${pad(m)}-01`;
            const lastDay = new Date(y, m, 0).getDate();
            const last = `${y}-${pad(m)}-${pad(lastDay)}`;
            return { from: first, to: last, label: `Tháng ${pad(m)}/${y}` };
        }
        if (periodMode === 'LAST_MONTH') {
            const lm = new Date(y, m - 2, 1);
            const ly = lm.getFullYear();
            const lMonth = lm.getMonth() + 1;
            const lastDay = new Date(ly, lMonth, 0).getDate();
            return {
                from: `${ly}-${pad(lMonth)}-01`,
                to: `${ly}-${pad(lMonth)}-${pad(lastDay)}`,
                label: `Tháng ${pad(lMonth)}/${ly}`,
            };
        }
        if (periodMode === 'THIS_QUARTER') {
            const qStartMonth = Math.floor((m - 1) / 3) * 3 + 1;
            const qEndMonth = qStartMonth + 2;
            const lastDay = new Date(y, qEndMonth, 0).getDate();
            const qNum = Math.floor((m - 1) / 3) + 1;
            return {
                from: `${y}-${pad(qStartMonth)}-01`,
                to: `${y}-${pad(qEndMonth)}-${pad(lastDay)}`,
                label: `Quý ${qNum}/${y}`,
            };
        }
        if (periodMode === 'THIS_YEAR') {
            return {
                from: `${y}-01-01`,
                to: `${y}-12-31`,
                label: `Năm ${y}`,
            };
        }
        if (periodMode === 'MONTH_RANGE') {
            const fm = fromMonth || currentMonthStr;
            const tm = toMonth || currentMonthStr;
            const [ty, tMonth] = tm.split('-').map(Number);
            const lastDay = new Date(ty, tMonth, 0).getDate();
            return {
                from: `${fm}-01`,
                to: `${tm}-${pad(lastDay)}`,
                label: `Từ T${fm.split('-')[1]}/${fm.split('-')[0]} đến T${tm.split('-')[1]}/${tm.split('-')[0]}`,
            };
        }
        const f = customFromDate || `${currentMonthStr}-01`;
        const t = customToDate || todayStr;
        return { from: f, to: t, label: `${fmtDate(f)} → ${fmtDate(t)}` };
    }

    async function loadAllPnLData() {
        setLoading(true);
        const { from, to } = getDateBounds();

        try {
            const [cats, tpls, finTxs] = await Promise.all([
                fetchFinancialCategories(),
                fetchFixedCostTemplates(),
                fetchFinancialTransactions(from, to),
            ]);

            setCategories(cats);
            setTemplates(tpls);
            setFinTransactions(finTxs);

            // Initialize selection for fixed cost templates if empty
            setSelectedTemplateIds(prev => {
                if (Object.keys(prev).length > 0) return prev;
                const init: Record<string, boolean> = {};
                tpls.forEach(t => {
                    if (t.is_active) init[t.id] = true;
                });
                return init;
            });
            setOverrideAmounts(prev => {
                const next = { ...prev };
                tpls.forEach(t => {
                    if (next[t.id] === undefined) next[t.id] = t.default_amount;
                });
                return next;
            });

            // 1. Tickets sold in period
            const { data: tData } = await supabase
                .from('tickets')
                .select(`id, price_paid, sold_at, status, payment_method, ticket_types!inner(name, category)`)
                .neq('status', 'CANCELLED')
                .gte('sold_at', `${from}T00:00:00+07:00`)
                .lte('sold_at', `${to}T23:59:59+07:00`);
            setTicketsData(tData || []);

            // 2. Retail orders in period
            const { data: oData } = await supabase
                .from('orders')
                .select(`id, created_at, payment_method, order_items!inner(id, quantity, subtotal, products!inner(name))`)
                .gte('created_at', `${from}T00:00:00+07:00`)
                .lte('created_at', `${to}T23:59:59+07:00`);

            const rItems: any[] = [];
            (oData || []).forEach((order: any) => {
                (order.order_items || []).forEach((item: any) => {
                    if (item.products) {
                        rItems.push({
                            id: item.id,
                            product_name: item.products.name,
                            quantity: item.quantity,
                            subtotal: item.subtotal,
                            sold_at: order.created_at,
                            payment_method: order.payment_method || 'CASH',
                        });
                    }
                });
            });
            setRetailData(rItems);

            // 3. Shift cash expenses (from cashier `expenses` table)
            const { data: expData } = await supabase
                .from('expenses')
                .select(`id, amount, reason, created_at, profiles:created_by(full_name)`)
                .gte('created_at', `${from}T00:00:00+07:00`)
                .lte('created_at', `${to}T23:59:59+07:00`)
                .order('created_at', { ascending: false });
            setShiftExpenses(expData || []);

            // 4. Coach Payroll in period (group + private check-ins)
            const [{ data: gAtt }, { data: pCheckins }] = await Promise.all([
                supabase
                    .from('coach_attendances')
                    .select('teaching_date, amount')
                    .gte('teaching_date', from)
                    .lte('teaching_date', to),
                supabase
                    .from('coach_checkin_summary')
                    .select('checked_in_at, per_session_amount')
                    .gte('checked_in_at', `${from}T00:00:00`)
                    .lte('checked_in_at', `${to}T23:59:59`),
            ]);

            let coachSum = 0;
            const coachMonthMap: Record<string, number> = {};

            (gAtt || []).forEach((row: any) => {
                const amt = Number(row.amount) || 0;
                coachSum += amt;
                const mKey = (row.teaching_date || '').slice(0, 7);
                if (mKey) coachMonthMap[mKey] = (coachMonthMap[mKey] || 0) + amt;
            });
            (pCheckins || []).forEach((row: any) => {
                const amt = Number(row.per_session_amount) || 0;
                coachSum += amt;
                const mKey = (row.checked_in_at || '').slice(0, 7);
                if (mKey) coachMonthMap[mKey] = (coachMonthMap[mKey] || 0) + amt;
            });

            setCoachPayrollTotal(coachSum);
            setCoachPayrollByMonth(coachMonthMap);
        } catch (err) {
            console.error('Error loading PnL data:', err);
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        loadAllPnLData();
    }, [periodMode, fromMonth, toMonth, customFromDate, customToDate]);

    // ============================================================
    // COMPUTE P&L NUMBERS
    // ============================================================
    const revDailyTickets = ticketsData
        .filter(t => t.ticket_types?.category === 'DAILY')
        .reduce((s, t) => s + (Number(t.price_paid) || 0), 0);
    const countDailyTickets = ticketsData.filter(t => t.ticket_types?.category === 'DAILY' && t.price_paid > 0).length;

    const revMultiMonthlyTickets = ticketsData
        .filter(t => t.ticket_types?.category === 'MULTI' || t.ticket_types?.category === 'MONTHLY')
        .reduce((s, t) => s + (Number(t.price_paid) || 0), 0);
    const countMultiMonthlyTickets = ticketsData.filter(
        t => (t.ticket_types?.category === 'MULTI' || t.ticket_types?.category === 'MONTHLY') && t.price_paid > 0
    ).length;

    const revLessonTickets = ticketsData
        .filter(t => t.ticket_types?.category === 'LESSON')
        .reduce((s, t) => s + (Number(t.price_paid) || 0), 0);
    const countLessonTickets = ticketsData.filter(t => t.ticket_types?.category === 'LESSON' && t.price_paid > 0).length;

    const revRetail = retailData.reduce((s, r) => s + (Number(r.subtotal) || 0), 0);
    const countRetailQty = retailData.reduce((s, r) => s + (Number(r.quantity) || 0), 0);

    const totalSalesRevenue = revDailyTickets + revMultiMonthlyTickets + revLessonTickets + revRetail;

    // II. Other Income (Thu khác)
    const otherIncomeTxs = finTransactions.filter(tx => tx.type === 'INCOME');
    const totalOtherIncome = otherIncomeTxs.reduce((s, tx) => s + tx.amount, 0);

    // Group Other Income by category
    const otherIncomeByCat: Record<string, number> = {};
    otherIncomeTxs.forEach(tx => {
        const key = tx.category_name || 'Thu nhập khác';
        otherIncomeByCat[key] = (otherIncomeByCat[key] || 0) + tx.amount;
    });

    // Total Income (A = I + II)
    const totalIncome = totalSalesRevenue + totalOtherIncome;

    // III. Variable Costs (Biến phí)
    const variableCostTxs = finTransactions.filter(tx => tx.type === 'EXPENSE' && tx.cost_type === 'VARIABLE');
    const variableByCat: Record<string, number> = {};
    variableCostTxs.forEach(tx => {
        const key = tx.category_name || 'Biến phí khác';
        variableByCat[key] = (variableByCat[key] || 0) + tx.amount;
    });

    const shiftExpensesTotal = includeShiftExpenses
        ? shiftExpenses.reduce((s, e) => s + (Number(e.amount) || 0), 0)
        : 0;
    const autoCoachTotal = includeCoachPayroll ? coachPayrollTotal : 0;

    const totalVariableCost =
        variableCostTxs.reduce((s, tx) => s + tx.amount, 0) + shiftExpensesTotal + autoCoachTotal;

    // Gross Profit / Contribution Margin (Lợi nhuận gộp / Số dư đảm phí: B = A - III)
    const grossProfit = totalIncome - totalVariableCost;
    const grossMarginPct = totalIncome > 0 ? (grossProfit / totalIncome) * 100 : 0;

    // IV. Fixed Costs (Định phí)
    const fixedCostTxs = finTransactions.filter(tx => tx.type === 'EXPENSE' && tx.cost_type === 'FIXED');
    const fixedByCat: Record<string, number> = {};
    fixedCostTxs.forEach(tx => {
        const key = tx.category_name || 'Định phí khác';
        fixedByCat[key] = (fixedByCat[key] || 0) + tx.amount;
    });
    const totalFixedCost = fixedCostTxs.reduce((s, tx) => s + tx.amount, 0);

    // Total Expenses (C = III + IV)
    const totalExpenses = totalVariableCost + totalFixedCost;

    // V. Net Profit (Lợi nhuận ròng: EBT = A - C)
    const netProfit = totalIncome - totalExpenses;
    const netMarginPct = totalIncome > 0 ? (netProfit / totalIncome) * 100 : 0;

    // ============================================================
    // BUILD CHART DATA (BY MONTH OR BY DAY)
    // ============================================================
    const { from: boundFrom, to: boundTo, label: periodLabel } = getDateBounds();
    const monthsInPeriod = getMonthsInRange(boundFrom.slice(0, 7), boundTo.slice(0, 7));
    const useMonthlyChart = monthsInPeriod.length > 1;

    const chartData = React.useMemo(() => {
        if (useMonthlyChart) {
            return monthsInPeriod.map(mStr => {
                const [y, m] = mStr.split('-');
                const label = `T${m}/${y}`;

                const salesTicketM = ticketsData
                    .filter(t => (t.sold_at || '').slice(0, 7) === mStr)
                    .reduce((s, t) => s + (Number(t.price_paid) || 0), 0);
                const salesRetailM = retailData
                    .filter(r => (r.sold_at || '').slice(0, 7) === mStr)
                    .reduce((s, r) => s + (Number(r.subtotal) || 0), 0);
                const otherIncM = otherIncomeTxs
                    .filter(tx => tx.accounting_month === mStr)
                    .reduce((s, tx) => s + tx.amount, 0);

                const fixedM = fixedCostTxs
                    .filter(tx => tx.accounting_month === mStr)
                    .reduce((s, tx) => s + tx.amount, 0);
                const varTxM = variableCostTxs
                    .filter(tx => tx.accounting_month === mStr)
                    .reduce((s, tx) => s + tx.amount, 0);
                const shiftM = includeShiftExpenses
                    ? shiftExpenses
                        .filter(e => (e.created_at || '').slice(0, 7) === mStr)
                        .reduce((s, e) => s + (Number(e.amount) || 0), 0)
                    : 0;
                const coachM = includeCoachPayroll ? (coachPayrollByMonth[mStr] || 0) : 0;

                const thu = salesTicketM + salesRetailM + otherIncM;
                const bienPhi = varTxM + shiftM + coachM;
                const dinhPhi = fixedM;
                const loiNhuan = thu - (bienPhi + dinhPhi);

                return {
                    name: label,
                    'Tổng Thu': thu,
                    'Biến phí': bienPhi,
                    'Định phí': dinhPhi,
                    'Lợi nhuận ròng': loiNhuan,
                };
            });
        } else {
            // Single month -> group by Date
            const startD = new Date(boundFrom + 'T00:00:00');
            const endD = new Date(boundTo + 'T00:00:00');
            const days: { dateStr: string; label: string }[] = [];
            for (let d = new Date(startD); d <= endD; d.setDate(d.getDate() + 1)) {
                const ds = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
                days.push({ dateStr: ds, label: `${pad(d.getDate())}/${pad(d.getMonth() + 1)}` });
            }

            return days.map(({ dateStr, label }) => {
                const salesTicketD = ticketsData
                    .filter(t => (t.sold_at || '').slice(0, 10) === dateStr)
                    .reduce((s, t) => s + (Number(t.price_paid) || 0), 0);
                const salesRetailD = retailData
                    .filter(r => (r.sold_at || '').slice(0, 10) === dateStr)
                    .reduce((s, r) => s + (Number(r.subtotal) || 0), 0);
                const otherIncD = otherIncomeTxs
                    .filter(tx => tx.transaction_date === dateStr)
                    .reduce((s, tx) => s + tx.amount, 0);

                const fixedD = fixedCostTxs
                    .filter(tx => tx.transaction_date === dateStr)
                    .reduce((s, tx) => s + tx.amount, 0);
                const varTxD = variableCostTxs
                    .filter(tx => tx.transaction_date === dateStr)
                    .reduce((s, tx) => s + tx.amount, 0);
                const shiftD = includeShiftExpenses
                    ? shiftExpenses
                        .filter(e => (e.created_at || '').slice(0, 10) === dateStr)
                        .reduce((s, e) => s + (Number(e.amount) || 0), 0)
                    : 0;

                const thu = salesTicketD + salesRetailD + otherIncD;
                const bienPhi = varTxD + shiftD;
                const dinhPhi = fixedD;
                const loiNhuan = thu - (bienPhi + dinhPhi);

                return {
                    name: label,
                    'Tổng Thu': thu,
                    'Biến phí': bienPhi,
                    'Định phí': dinhPhi,
                    'Lợi nhuận ròng': loiNhuan,
                };
            });
        }
    }, [
        useMonthlyChart,
        monthsInPeriod,
        boundFrom,
        boundTo,
        ticketsData,
        retailData,
        otherIncomeTxs,
        fixedCostTxs,
        variableCostTxs,
        shiftExpenses,
        includeShiftExpenses,
        includeCoachPayroll,
        coachPayrollByMonth,
    ]);

    // ============================================================
    // HANDLERS FOR ADDING / EDITING TRANSACTIONS
    // ============================================================
    function openCreateTransactionModal(type: FinancialType, costType: CostType = 'VARIABLE', preselectedCatId?: string) {
        setEditingTxId(null);
        setTxDate(todayStr);
        setTxType(type);
        setTxCostType(type === 'INCOME' ? null : (costType || 'VARIABLE'));

        const matchingCats = categories.filter(
            c => c.is_active && c.type === type && (type === 'INCOME' || c.cost_type === costType)
        );
        const chosenCatId = preselectedCatId || matchingCats[0]?.id || '';
        setTxCategoryId(chosenCatId);
        setTxAmount('');
        setTxPaymentMethod('TRANSFER');
        setTxFundSource('COMPANY_FUND');
        setTxDescription('');
        setShowTxModal(true);
    }

    function openEditTransactionModal(tx: FinancialTransaction) {
        setEditingTxId(tx.id);
        setTxDate(tx.transaction_date);
        setTxType(tx.type);
        setTxCostType(tx.cost_type);
        setTxCategoryId(tx.category_id || '');
        setTxAmount(tx.amount);
        setTxPaymentMethod(tx.payment_method);
        setTxFundSource(tx.fund_source);
        setTxDescription(tx.description);
        setShowTxModal(true);
    }

    async function handleSaveTransaction(e: React.FormEvent) {
        e.preventDefault();
        if (!profile || !txAmount || Number(txAmount) <= 0) {
            alert('Vui lòng nhập số tiền hợp lệ (> 0).');
            return;
        }
        if (!txDate) {
            alert('Vui lòng chọn ngày hạch toán.');
            return;
        }

        const selectedCat = categories.find(c => c.id === txCategoryId);
        const categoryName =
            selectedCat?.name ||
            (txType === 'INCOME' ? 'Thu nhập khác' : txCostType === 'FIXED' ? 'Định phí khác' : 'Biến phí khác');

        setTxSaving(true);
        try {
            await saveFinancialTransaction(
                {
                    id: editingTxId || undefined,
                    transaction_date: txDate,
                    type: txType,
                    cost_type: txType === 'INCOME' ? null : txCostType,
                    category_id: txCategoryId || null,
                    category_name: categoryName,
                    amount: Number(txAmount),
                    payment_method: txPaymentMethod,
                    fund_source: txFundSource,
                    description: txDescription || categoryName,
                },
                profile.id,
                profile.full_name || 'Admin'
            );
            setShowTxModal(false);
            await loadAllPnLData();
        } catch (err: any) {
            alert('Lỗi lưu bút toán: ' + (err.message || 'Không xác định'));
        } finally {
            setTxSaving(false);
        }
    }

    async function handleDeleteTx(tx: FinancialTransaction) {
        if (!confirm(`Bạn có chắc chắn muốn xóa bút toán "${tx.category_name} — ${fmt(tx.amount)}" ngày ${fmtDate(tx.transaction_date)}?`)) {
            return;
        }
        try {
            await deleteFinancialTransaction(tx.id, profile?.id);
            await loadAllPnLData();
        } catch (err: any) {
            alert('Lỗi xóa bút toán: ' + (err.message || 'Không xác định'));
        }
    }

    // ============================================================
    // HANDLERS FOR FIXED COST TEMPLATES & PERIOD APPLICATION
    // ============================================================
    async function handleApplyFixedCosts(e: React.FormEvent) {
        e.preventDefault();
        if (!profile) return;

        const targetFromMonth = applyScope === 'CURRENT_MONTH' ? applySingleMonth : applyFromMonth;
        const targetToMonth = applyScope === 'CURRENT_MONTH' ? applySingleMonth : applyToMonth;

        if (!targetFromMonth || !targetToMonth || targetFromMonth > targetToMonth) {
            alert('Khoảng thời gian chọn không hợp lệ! Tháng bắt đầu phải nhỏ hơn hoặc bằng tháng kết thúc.');
            return;
        }

        const chosenTemplates = templates.filter(t => selectedTemplateIds[t.id]);
        if (chosenTemplates.length === 0) {
            alert('Vui lòng tick chọn ít nhất 1 khoản Chi phí cố định để áp dụng.');
            return;
        }

        const items = chosenTemplates.map(tpl => {
            const cat = categories.find(c => c.id === tpl.category_id);
            return {
                template: tpl,
                category_name: cat?.name || tpl.name,
                amount: Number(overrideAmounts[tpl.id] ?? tpl.default_amount) || 0,
            };
        });

        const zeroItems = items.filter(i => i.amount <= 0);
        if (zeroItems.length === items.length) {
            alert('Các khoản định phí đang có số tiền = 0đ. Vui lòng nhập số tiền hàng tháng lớn hơn 0đ trước khi hạch toán!');
            return;
        }

        setApplyingFixed(true);
        try {
            // Also persist any updated default amounts to templates so Admin doesn't have to re-enter next time
            for (const item of items) {
                if (item.amount > 0 && item.amount !== item.template.default_amount) {
                    await saveFixedCostTemplate(
                        {
                            ...item.template,
                            default_amount: item.amount,
                        },
                        profile.id
                    );
                }
            }

            const res = await applyFixedCostsForPeriod({
                fromMonth: targetFromMonth,
                toMonth: targetToMonth,
                items,
                duplicateMode,
                userId: profile.id,
                userName: profile.full_name || 'Admin',
            });

            alert(
                `✅ Đã hạch toán Chi phí cố định cho ${res.monthsCount} tháng (${targetFromMonth} → ${targetToMonth}):\n` +
                `• Tạo mới: ${res.createdCount} bút toán\n` +
                `• Cập nhật: ${res.updatedCount} bút toán\n` +
                `• Bỏ qua (đã có): ${res.skippedCount} bút toán`
            );
            setShowFixedModal(false);
            await loadAllPnLData();
        } catch (err: any) {
            alert('Lỗi áp dụng định phí: ' + (err.message || 'Không xác định'));
        } finally {
            setApplyingFixed(false);
        }
    }

    async function handleSaveTemplate(e: React.FormEvent) {
        e.preventDefault();
        if (!tplName.trim()) {
            alert('Vui lòng nhập tên khoản chi phí cố định.');
            return;
        }
        setTplSaving(true);
        try {
            const saved = await saveFixedCostTemplate(
                {
                    id: editingTplId || undefined,
                    name: tplName.trim(),
                    category_id: tplCategoryId,
                    default_amount: Number(tplAmount) || 0,
                    default_payment_method: tplPaymentMethod,
                    day_of_month: tplDayOfMonth,
                    note: tplNote.trim() || null,
                    is_active: true,
                },
                profile?.id
            );
            setOverrideAmounts(prev => ({ ...prev, [saved.id]: saved.default_amount }));
            setSelectedTemplateIds(prev => ({ ...prev, [saved.id]: true }));
            setEditingTplId(null);
            setTplName('');
            setTplAmount('');
            setTplNote('');
            await loadAllPnLData();
        } catch (err: any) {
            alert('Lỗi lưu mẫu định phí: ' + (err.message || 'Không xác định'));
        } finally {
            setTplSaving(false);
        }
    }

    async function handleDeleteTemplate(id: string) {
        if (!confirm('Xóa khoản định phí mẫu này khỏi danh sách cấu hình? (Các bút toán đã hạch toán trước đó vẫn được giữ nguyên)')) {
            return;
        }
        try {
            await deleteFixedCostTemplate(id, profile?.id);
            await loadAllPnLData();
        } catch (err: any) {
            alert('Lỗi xóa mẫu định phí: ' + (err.message || 'Không xác định'));
        }
    }

    // ============================================================
    // HANDLER FOR ADDING NEW CATEGORY
    // ============================================================
    async function handleSaveNewCategory(e: React.FormEvent) {
        e.preventDefault();
        if (!newCatName.trim()) return;
        setCatSaving(true);
        try {
            await saveFinancialCategory(
                {
                    name: newCatName.trim(),
                    type: newCatType,
                    cost_type: newCatType === 'INCOME' ? null : newCatCostType,
                    description: newCatDesc.trim() || null,
                },
                profile?.id
            );
            setNewCatName('');
            setNewCatDesc('');
            await loadAllPnLData();
        } catch (err: any) {
            alert('Lỗi lưu danh mục: ' + (err.message || 'Không xác định'));
        } finally {
            setCatSaving(false);
        }
    }

    // ============================================================
    // EXPORT EXCEL & PRINT A4
    // ============================================================
    function handleExportPnLExcel() {
        const wb = XLSX.utils.book_new();

        // Sheet 1: Báo cáo KQKD Tổng hợp
        const pnlRows: any[][] = [
            ['BÁO CÁO TÌNH HÌNH KẾT QUẢ KINH DOANH (P&L)'],
            [`Kỳ báo cáo: ${periodLabel} (${boundFrom} → ${boundTo})`],
            [],
            ['CHỈ TIÊU', 'PHÂN LOẠI', 'SỐ TIỀN (VNĐ)', 'TỶ TRỌNG / GHI CHÚ'],
            ['I. DOANH THU BÁN HÀNG & DỊCH VỤ', 'Doanh thu', totalSalesRevenue, totalIncome > 0 ? `${((totalSalesRevenue / totalIncome) * 100).toFixed(1)}% Tổng thu` : '0%'],
            ['  1. Doanh thu Vé bơi lẻ (Vé lượt)', 'Bán vé', revDailyTickets, `${countDailyTickets} vé`],
            ['  2. Doanh thu Vé tháng & Vé nhiều buổi', 'Bán vé', revMultiMonthlyTickets, `${countMultiMonthlyTickets} gói`],
            ['  3. Doanh thu Khóa học bơi & Bóng rổ', 'Khóa học', revLessonTickets, `${countLessonTickets} gói`],
            ['  4. Doanh thu Bán lẻ sản phẩm (POS)', 'Bán lẻ', revRetail, `${countRetailQty} sản phẩm`],
            ['II. THU NHẬP KHÁC (NGOÀI BÁN HÀNG)', 'Thu khác', totalOtherIncome, totalIncome > 0 ? `${((totalOtherIncome / totalIncome) * 100).toFixed(1)}% Tổng thu` : '0%'],
            ...Object.entries(otherIncomeByCat).map(([catName, val]) => [`  • ${catName}`, 'Thu khác', val, '']),
            ['TỔNG DOANH THU & THU NHẬP (A = I + II)', 'TỔNG THU', totalIncome, '100%'],
            [],
            ['III. CHI PHÍ BIẾN ĐỔI (BIẾN PHÍ)', 'Biến phí', totalVariableCost, totalIncome > 0 ? `${((totalVariableCost / totalIncome) * 100).toFixed(1)}% Tổng thu` : '0%'],
            ...Object.entries(variableByCat).map(([catName, val]) => [`  • ${catName}`, 'Biến phí', val, '']),
            ...(includeCoachPayroll && autoCoachTotal > 0 ? [['  • Lương & Thù lao HLV (Tự động từ bảng chấm công)', 'Biến phí', autoCoachTotal, 'Chấm công HLV']] : []),
            ...(includeShiftExpenses && shiftExpensesTotal > 0 ? [['  • Phiếu chi tiền mặt tại quầy (Lễ tân)', 'Biến phí', shiftExpensesTotal, `${shiftExpenses.length} phiếu chi`]] : []),
            ['LỢI NHUẬN GỘP / SỐ DƯ ĐẢM PHÍ (B = A - III)', 'LỢI NHUẬN GỘP', grossProfit, `Biên LN gộp: ${grossMarginPct.toFixed(1)}%`],
            [],
            ['IV. CHI PHÍ CỐ ĐỊNH HÀNG THÁNG (ĐỊNH PHÍ)', 'Định phí', totalFixedCost, totalIncome > 0 ? `${((totalFixedCost / totalIncome) * 100).toFixed(1)}% Tổng thu` : '0%'],
            ...Object.entries(fixedByCat).map(([catName, val]) => [`  • ${catName}`, 'Định phí', val, '']),
            ['TỔNG CHI PHÍ HOẠT ĐỘNG (C = III + IV)', 'TỔNG CHI', totalExpenses, totalIncome > 0 ? `${((totalExpenses / totalIncome) * 100).toFixed(1)}% Tổng thu` : '0%'],
            [],
            ['V. LỢI NHUẬN RÒNG TRƯỚC THUẾ (EBT = A - C)', netProfit >= 0 ? 'LÃI RÒNG' : 'LỖ RÒNG', netProfit, `Tỷ suất LN ròng: ${netMarginPct.toFixed(1)}%`],
        ];

        const ws1 = XLSX.utils.aoa_to_sheet(pnlRows);
        ws1['!cols'] = [{ wch: 48 }, { wch: 18 }, { wch: 20 }, { wch: 28 }];
        XLSX.utils.book_append_sheet(wb, ws1, 'Bao_Cao_KQKD');

        // Sheet 2: Chi tiết Bút toán Thu - Chi bổ sung
        const txHeaders = ['STT', 'Ngày hạch toán', 'Tháng KQKD', 'Loại', 'Nhóm chi phí', 'Danh mục', 'Nội dung chi tiết', 'H/T Thanh toán', 'Số tiền (VNĐ)', 'Người lập'];
        const txRows = finTransactions.map((tx, idx) => [
            idx + 1,
            tx.transaction_date,
            tx.accounting_month,
            tx.type === 'INCOME' ? 'Thu khác' : 'Chi phí',
            tx.type === 'INCOME' ? 'Thu ngoài bán hàng' : tx.cost_type === 'FIXED' ? 'Định phí (Cố định)' : 'Biến phí (Biến đổi)',
            tx.category_name,
            tx.description,
            tx.payment_method,
            tx.type === 'INCOME' ? tx.amount : -tx.amount,
            tx.created_by_name || 'Admin',
        ]);
        const ws2 = XLSX.utils.aoa_to_sheet([txHeaders, ...txRows]);
        ws2['!cols'] = [{ wch: 6 }, { wch: 14 }, { wch: 12 }, { wch: 12 }, { wch: 20 }, { wch: 32 }, { wch: 40 }, { wch: 16 }, { wch: 18 }, { wch: 18 }];
        XLSX.utils.book_append_sheet(wb, ws2, 'Chi_Tiet_Thu_Chi');

        XLSX.writeFile(wb, `Bao_Cao_KQKD_${boundFrom}_${boundTo}.xlsx`);
    }

    function handlePrintPnL() {
        const html = `
            <div style="margin-bottom: 16px; font-size: 13px; text-align: center;">
                <strong>Kỳ báo cáo:</strong> ${periodLabel} (${fmtDate(boundFrom)} — ${fmtDate(boundTo)})
            </div>
            <table>
                <thead>
                    <tr>
                        <th style="width: 55%;">CHỈ TIÊU KẾT QUẢ KINH DOANH</th>
                        <th style="width: 25%; text-align: right;">SỐ TIỀN (VNĐ)</th>
                        <th style="width: 20%; text-align: right;">TỶ TRỌNG / GHI CHÚ</th>
                    </tr>
                </thead>
                <tbody>
                    <tr style="font-weight: 700; background: #f8fafc;">
                        <td>I. DOANH THU BÁN HÀNG & CUNG CẤP DỊCH VỤ</td>
                        <td style="text-align: right;">${fmt(totalSalesRevenue)}</td>
                        <td style="text-align: right;">${totalIncome > 0 ? ((totalSalesRevenue / totalIncome) * 100).toFixed(1) + '%' : '—'}</td>
                    </tr>
                    <tr>
                        <td style="padding-left: 24px;">1. Doanh thu Vé bơi lẻ (Vé lượt)</td>
                        <td style="text-align: right;">${fmt(revDailyTickets)}</td>
                        <td style="text-align: right;">${countDailyTickets} vé</td>
                    </tr>
                    <tr>
                        <td style="padding-left: 24px;">2. Doanh thu Vé tháng & Vé nhiều buổi</td>
                        <td style="text-align: right;">${fmt(revMultiMonthlyTickets)}</td>
                        <td style="text-align: right;">${countMultiMonthlyTickets} gói</td>
                    </tr>
                    <tr>
                        <td style="padding-left: 24px;">3. Doanh thu Khóa học bơi & Bóng rổ</td>
                        <td style="text-align: right;">${fmt(revLessonTickets)}</td>
                        <td style="text-align: right;">${countLessonTickets} gói</td>
                    </tr>
                    <tr>
                        <td style="padding-left: 24px;">4. Doanh thu Bán lẻ sản phẩm (POS)</td>
                        <td style="text-align: right;">${fmt(revRetail)}</td>
                        <td style="text-align: right;">${countRetailQty} món</td>
                    </tr>

                    <tr style="font-weight: 700; background: #f8fafc;">
                        <td>II. THU NHẬP KHÁC (NGOÀI BÁN HÀNG)</td>
                        <td style="text-align: right;">${fmt(totalOtherIncome)}</td>
                        <td style="text-align: right;">${totalIncome > 0 ? ((totalOtherIncome / totalIncome) * 100).toFixed(1) + '%' : '—'}</td>
                    </tr>
                    ${Object.entries(otherIncomeByCat)
                        .map(
                            ([k, v]) => `<tr><td style="padding-left: 24px;">• ${k}</td><td style="text-align: right;">${fmt(v)}</td><td style="text-align: right;">Thu khác</td></tr>`
                        )
                        .join('')}

                    <tr class="total-row">
                        <td>TỔNG DOANH THU & THU NHẬP (A = I + II)</td>
                        <td style="text-align: right;">${fmt(totalIncome)}</td>
                        <td style="text-align: right;">100%</td>
                    </tr>

                    <tr style="font-weight: 700; background: #f8fafc;">
                        <td>III. CHI PHÍ BIẾN ĐỔI (BIẾN PHÍ)</td>
                        <td style="text-align: right;">-${fmt(totalVariableCost)}</td>
                        <td style="text-align: right;">${totalIncome > 0 ? ((totalVariableCost / totalIncome) * 100).toFixed(1) + '%' : '—'}</td>
                    </tr>
                    ${Object.entries(variableByCat)
                        .map(
                            ([k, v]) => `<tr><td style="padding-left: 24px;">• ${k}</td><td style="text-align: right;">-${fmt(v)}</td><td style="text-align: right;">Biến phí</td></tr>`
                        )
                        .join('')}
                    ${includeCoachPayroll && autoCoachTotal > 0 ? `<tr><td style="padding-left: 24px;">• Lương & Thù lao HLV (Từ bảng chấm công)</td><td style="text-align: right;">-${fmt(autoCoachTotal)}</td><td style="text-align: right;">Biến phí</td></tr>` : ''}
                    ${includeShiftExpenses && shiftExpensesTotal > 0 ? `<tr><td style="padding-left: 24px;">• Phiếu chi tiền mặt tại quầy (Lễ tân)</td><td style="text-align: right;">-${fmt(shiftExpensesTotal)}</td><td style="text-align: right;">${shiftExpenses.length} phiếu</td></tr>` : ''}

                    <tr style="font-weight: 700;">
                        <td>LỢI NHUẬN GỘP / SỐ DƯ ĐẢM PHÍ (B = A - III)</td>
                        <td style="text-align: right;">${fmt(grossProfit)}</td>
                        <td style="text-align: right;">Margin: ${grossMarginPct.toFixed(1)}%</td>
                    </tr>

                    <tr style="font-weight: 700; background: #f8fafc;">
                        <td>IV. CHI PHÍ CỐ ĐỊNH HÀNG THÁNG (ĐỊNH PHÍ)</td>
                        <td style="text-align: right;">-${fmt(totalFixedCost)}</td>
                        <td style="text-align: right;">${totalIncome > 0 ? ((totalFixedCost / totalIncome) * 100).toFixed(1) + '%' : '—'}</td>
                    </tr>
                    ${Object.entries(fixedByCat)
                        .map(
                            ([k, v]) => `<tr><td style="padding-left: 24px;">• ${k}</td><td style="text-align: right;">-${fmt(v)}</td><td style="text-align: right;">Định phí</td></tr>`
                        )
                        .join('')}

                    <tr style="font-weight: 700;">
                        <td>TỔNG CHI PHÍ HOẠT ĐỘNG (C = III + IV)</td>
                        <td style="text-align: right;">-${fmt(totalExpenses)}</td>
                        <td style="text-align: right;">${totalIncome > 0 ? ((totalExpenses / totalIncome) * 100).toFixed(1) + '%' : '—'}</td>
                    </tr>

                    <tr class="total-row" style="font-size: 14px;">
                        <td>V. LỢI NHUẬN RÒNG TRƯỚC THUẾ (EBT = A - C)</td>
                        <td style="text-align: right;">${fmt(netProfit)}</td>
                        <td style="text-align: right;">Tỷ suất LN: ${netMarginPct.toFixed(1)}%</td>
                    </tr>
                </tbody>
            </table>
        `;
        onPrintReport(`BÁO CÁO KẾT QUẢ KINH DOANH (${periodLabel})`, html);
    }

    // Filtered transaction list for bottom ledger
    const filteredLedger = finTransactions.filter(tx => {
        if (txFilter === 'INCOME' && tx.type !== 'INCOME') return false;
        if (txFilter === 'FIXED' && !(tx.type === 'EXPENSE' && tx.cost_type === 'FIXED')) return false;
        if (txFilter === 'VARIABLE' && !(tx.type === 'EXPENSE' && tx.cost_type === 'VARIABLE')) return false;
        if (txFilter === 'SHIFT') return false; // handled separately
        if (txSearch.trim()) {
            const q = txSearch.toLowerCase();
            return (
                tx.category_name.toLowerCase().includes(q) ||
                tx.description.toLowerCase().includes(q) ||
                tx.transaction_date.includes(q)
            );
        }
        return true;
    });

    const filteredModalCategories = categories.filter(
        c => c.is_active && c.type === txType && (txType === 'INCOME' || c.cost_type === txCostType)
    );

    return (
        <div style={{ animation: 'fadeIn 0.25s ease' }}>
            {/* TOP BANNER & QUICK ACTIONS (ADMIN ONLY) */}
            <div
                style={{
                    background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
                    color: '#fff',
                    borderRadius: '16px',
                    padding: '20px 24px',
                    marginBottom: '20px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    gap: '16px',
                    boxShadow: '0 10px 25px -5px rgba(15, 23, 42, 0.25)',
                }}
            >
                <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                        <span style={{ background: '#3b82f6', color: '#fff', fontSize: '11px', fontWeight: 700, padding: '2px 8px', borderRadius: '99px' }}>
                            🔒 ADMIN ONLY
                        </span>
                        <span style={{ fontSize: '13px', color: '#94a3b8' }}>Kỳ đang xem: <strong style={{ color: '#fff' }}>{periodLabel}</strong></span>
                    </div>
                    <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 700, color: '#fff' }}>
                        📊 Báo Cáo Tình Hình Kết Quả Kinh Doanh (P&L)
                    </h2>
                    <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#cbd5e1' }}>
                        Tổng hợp Doanh thu bán hàng, Thu khác, Định phí, Biến phí & Lợi nhuận ròng (Hỗ trợ hạch toán lùi về quá khứ)
                    </p>
                </div>

                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    <button
                        className="btn"
                        style={{ background: '#10b981', color: '#fff', border: 'none', fontWeight: 600, padding: '8px 14px', fontSize: '13px' }}
                        onClick={() => openCreateTransactionModal('INCOME', null)}
                    >
                        ➕ Thêm Thu Khác
                    </button>
                    <button
                        className="btn"
                        style={{ background: '#f59e0b', color: '#fff', border: 'none', fontWeight: 600, padding: '8px 14px', fontSize: '13px' }}
                        onClick={() => openCreateTransactionModal('EXPENSE', 'VARIABLE')}
                    >
                        ➖ Thêm Biến Phí / Chi Khác
                    </button>
                    <button
                        className="btn"
                        style={{ background: '#ef4444', color: '#fff', border: 'none', fontWeight: 600, padding: '8px 14px', fontSize: '13px' }}
                        onClick={() => openCreateTransactionModal('EXPENSE', 'FIXED')}
                    >
                        🏢 Thêm Định Phí Lẻ
                    </button>
                    <button
                        className="btn"
                        style={{ background: '#3b82f6', color: '#fff', border: 'none', fontWeight: 600, padding: '8px 14px', fontSize: '13px' }}
                        onClick={() => {
                            setFixedModalTab('APPLY');
                            setShowFixedModal(true);
                        }}
                    >
                        📅 Định Phí Hàng Tháng (Áp dụng nhanh)
                    </button>
                    <button
                        className="btn"
                        style={{ background: 'rgba(255,255,255,0.12)', color: '#fff', border: '1px solid rgba(255,255,255,0.2)', padding: '8px 12px', fontSize: '13px' }}
                        onClick={() => setShowCatModal(true)}
                    >
                        🏷️ Danh mục
                    </button>
                </div>
            </div>

            {/* FILTER BAR & OPTIONS */}
            <div
                style={{
                    background: 'var(--bg-card)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '12px',
                    padding: '14px 16px',
                    marginBottom: '20px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    gap: '12px',
                }}
            >
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
                    {(
                        [
                            { key: 'THIS_MONTH', label: 'Tháng này' },
                            { key: 'LAST_MONTH', label: 'Tháng trước' },
                            { key: 'THIS_QUARTER', label: 'Quý này' },
                            { key: 'THIS_YEAR', label: 'Năm nay' },
                            { key: 'MONTH_RANGE', label: 'Khoảng tháng (Quá khứ/Tùy chọn)' },
                            { key: 'DATE_RANGE', label: 'Khoảng ngày' },
                        ] as { key: PnLPeriodMode; label: string }[]
                    ).map(item => (
                        <button
                            key={item.key}
                            className={`btn ${periodMode === item.key ? 'btn-primary' : 'btn-ghost'}`}
                            style={{ padding: '6px 12px', fontSize: '13px' }}
                            onClick={() => setPeriodMode(item.key)}
                        >
                            {item.label}
                        </button>
                    ))}

                    {periodMode === 'MONTH_RANGE' && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginLeft: '4px' }}>
                            <input
                                type="month"
                                value={fromMonth}
                                onChange={e => setFromMonth(e.target.value)}
                                style={{ padding: '5px 10px', borderRadius: '8px', border: '1px solid var(--border-color)', fontSize: '13px' }}
                            />
                            <span style={{ color: 'var(--text-secondary)' }}>→</span>
                            <input
                                type="month"
                                value={toMonth}
                                onChange={e => setToMonth(e.target.value)}
                                style={{ padding: '5px 10px', borderRadius: '8px', border: '1px solid var(--border-color)', fontSize: '13px' }}
                            />
                        </div>
                    )}

                    {periodMode === 'DATE_RANGE' && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginLeft: '4px' }}>
                            <input
                                type="date"
                                value={customFromDate}
                                onChange={e => setCustomFromDate(e.target.value)}
                                style={{ padding: '5px 10px', borderRadius: '8px', border: '1px solid var(--border-color)', fontSize: '13px' }}
                            />
                            <span style={{ color: 'var(--text-secondary)' }}>→</span>
                            <input
                                type="date"
                                value={customToDate}
                                onChange={e => setCustomToDate(e.target.value)}
                                style={{ padding: '5px 10px', borderRadius: '8px', border: '1px solid var(--border-color)', fontSize: '13px' }}
                            />
                        </div>
                    )}
                </div>

                <div style={{ display: 'flex', gap: '16px', alignItems: 'center', flexWrap: 'wrap', fontSize: '13px' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', userSelect: 'none' }}>
                        <input
                            type="checkbox"
                            checked={includeCoachPayroll}
                            onChange={e => setIncludeCoachPayroll(e.target.checked)}
                        />
                        <span>Gộp Lương HLV ({fmt(coachPayrollTotal)})</span>
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', userSelect: 'none' }}>
                        <input
                            type="checkbox"
                            checked={includeShiftExpenses}
                            onChange={e => setIncludeShiftExpenses(e.target.checked)}
                        />
                        <span>Gộp Phiếu chi tại quầy ({fmt(shiftExpenses.reduce((s, e) => s + (Number(e.amount) || 0), 0))})</span>
                    </label>
                    <button
                        className="btn btn-outline btn-sm"
                        style={{ fontSize: '12px' }}
                        onClick={() => setShowMinimumGuide(!showMinimumGuide)}
                    >
                        💡 {showMinimumGuide ? 'Ẩn gợi ý chi phí tối thiểu' : 'Gợi ý chi phí tối thiểu phải có'}
                    </button>
                </div>
            </div>

            {/* SUGGESTED MINIMUM EXPENSES GUIDE PANEL */}
            {showMinimumGuide && (
                <div
                    style={{
                        background: '#f8fafc',
                        border: '1px solid #cbd5e1',
                        borderRadius: '14px',
                        padding: '18px 20px',
                        marginBottom: '20px',
                    }}
                >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                        <h3 style={{ margin: 0, fontSize: '15px', color: '#0f172a' }}>
                            💡 Gợi Ý Các Hạng Mục Chi Phí & Thu Khác Tối Thiểu Cần Có Cho Hồ Bơi (Bấm vào từng mục để tạo phiếu nhanh)
                        </h3>
                        <button className="btn btn-ghost btn-sm" onClick={() => setShowMinimumGuide(false)}>✕ Đóng</button>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px' }}>
                        {/* Fixed Costs */}
                        <div style={{ background: '#fff', padding: '14px', borderRadius: '10px', border: '1px solid #fecaca' }}>
                            <div style={{ fontWeight: 700, color: '#dc2626', marginBottom: '8px', fontSize: '13px' }}>
                                🏢 1. ĐỊNH PHÍ HÀNG THÁNG (CỐ ĐỊNH TỐI THIỂU)
                            </div>
                            <ul style={{ margin: 0, paddingLeft: '18px', fontSize: '12.5px', lineHeight: 1.7, color: '#334155' }}>
                                {categories
                                    .filter(c => c.type === 'EXPENSE' && c.cost_type === 'FIXED')
                                    .map(c => (
                                        <li key={c.id}>
                                            <button
                                                type="button"
                                                onClick={() => openCreateTransactionModal('EXPENSE', 'FIXED', c.id)}
                                                style={{ background: 'none', border: 'none', padding: 0, color: '#1e293b', cursor: 'pointer', textAlign: 'left', fontWeight: 600, textDecoration: 'underline' }}
                                                title={c.description || ''}
                                            >
                                                {c.name}
                                            </button>
                                        </li>
                                    ))}
                            </ul>
                            <div style={{ marginTop: '10px' }}>
                                <button
                                    className="btn btn-sm"
                                    style={{ background: '#fee2e2', color: '#b91c1c', border: 'none', fontSize: '12px', fontWeight: 600 }}
                                    onClick={() => {
                                        setFixedModalTab('TEMPLATES');
                                        setShowFixedModal(true);
                                    }}
                                >
                                    ⚙️ Cấu hình số tiền Định phí hàng tháng →
                                </button>
                            </div>
                        </div>

                        {/* Variable Costs */}
                        <div style={{ background: '#fff', padding: '14px', borderRadius: '10px', border: '1px solid #fde68a' }}>
                            <div style={{ fontWeight: 700, color: '#d97706', marginBottom: '8px', fontSize: '13px' }}>
                                ⚡ 2. BIẾN PHÍ VẬN HÀNH (THAY ĐỔI THEO LƯỢT KHÁCH/MÙA)
                            </div>
                            <ul style={{ margin: 0, paddingLeft: '18px', fontSize: '12.5px', lineHeight: 1.7, color: '#334155' }}>
                                {categories
                                    .filter(c => c.type === 'EXPENSE' && c.cost_type === 'VARIABLE')
                                    .map(c => (
                                        <li key={c.id}>
                                            <button
                                                type="button"
                                                onClick={() => openCreateTransactionModal('EXPENSE', 'VARIABLE', c.id)}
                                                style={{ background: 'none', border: 'none', padding: 0, color: '#1e293b', cursor: 'pointer', textAlign: 'left', fontWeight: 600, textDecoration: 'underline' }}
                                                title={c.description || ''}
                                            >
                                                {c.name}
                                            </button>
                                        </li>
                                    ))}
                            </ul>
                        </div>

                        {/* Other Income */}
                        <div style={{ background: '#fff', padding: '14px', borderRadius: '10px', border: '1px solid #bbf7d0' }}>
                            <div style={{ fontWeight: 700, color: '#15803d', marginBottom: '8px', fontSize: '13px' }}>
                                💰 3. THU NHẬP KHÁC (NGOÀI BÁN VÉ & HÀNG POS)
                            </div>
                            <ul style={{ margin: 0, paddingLeft: '18px', fontSize: '12.5px', lineHeight: 1.7, color: '#334155' }}>
                                {categories
                                    .filter(c => c.type === 'INCOME')
                                    .map(c => (
                                        <li key={c.id}>
                                            <button
                                                type="button"
                                                onClick={() => openCreateTransactionModal('INCOME', null, c.id)}
                                                style={{ background: 'none', border: 'none', padding: 0, color: '#1e293b', cursor: 'pointer', textAlign: 'left', fontWeight: 600, textDecoration: 'underline' }}
                                                title={c.description || ''}
                                            >
                                                {c.name}
                                            </button>
                                        </li>
                                    ))}
                            </ul>
                        </div>
                    </div>
                </div>
            )}

            {/* 4 KPI SUMMARY CARDS */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px', marginBottom: '20px' }}>
                <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderLeft: '5px solid #10b981', borderRadius: '14px', padding: '16px 20px' }}>
                    <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
                        1. Tổng Doanh Thu & Thu Nhập
                    </div>
                    <div style={{ fontSize: '24px', fontWeight: 800, color: '#10b981', margin: '6px 0' }}>{fmt(totalIncome)}</div>
                    <div style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'flex', justifyContent: 'space-between' }}>
                        <span>Bán hàng: <strong>{fmt(totalSalesRevenue)}</strong></span>
                        <span>Thu khác: <strong>{fmt(totalOtherIncome)}</strong></span>
                    </div>
                </div>

                <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderLeft: '5px solid #f59e0b', borderRadius: '14px', padding: '16px 20px' }}>
                    <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
                        2. Tổng Chi Phí (Định phí + Biến phí)
                    </div>
                    <div style={{ fontSize: '24px', fontWeight: 800, color: '#ef4444', margin: '6px 0' }}>-{fmt(totalExpenses)}</div>
                    <div style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'flex', justifyContent: 'space-between' }}>
                        <span>Định phí: <strong>{fmt(totalFixedCost)}</strong></span>
                        <span>Biến phí: <strong>{fmt(totalVariableCost)}</strong></span>
                    </div>
                </div>

                <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderLeft: '5px solid #3b82f6', borderRadius: '14px', padding: '16px 20px' }}>
                    <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
                        3. Lợi Nhuận Gộp (Trừ Biến phí)
                    </div>
                    <div style={{ fontSize: '24px', fontWeight: 800, color: '#3b82f6', margin: '6px 0' }}>{fmt(grossProfit)}</div>
                    <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                        Biên lợi nhuận gộp: <strong>{grossMarginPct.toFixed(1)}%</strong>
                    </div>
                </div>

                <div
                    style={{
                        background: netProfit >= 0 ? 'linear-gradient(135deg, #ecfdf5, #d1fae5)' : 'linear-gradient(135deg, #fef2f2, #fee2e2)',
                        border: `1px solid ${netProfit >= 0 ? '#6ee7b7' : '#fca5a5'}`,
                        borderLeft: `5px solid ${netProfit >= 0 ? '#059669' : '#dc2626'}`,
                        borderRadius: '14px',
                        padding: '16px 20px',
                    }}
                >
                    <div style={{ fontSize: '12px', fontWeight: 700, color: netProfit >= 0 ? '#065f46' : '#991b1b', textTransform: 'uppercase' }}>
                        4. Lợi Nhuận Ròng (Net Profit)
                    </div>
                    <div style={{ fontSize: '24px', fontWeight: 900, color: netProfit >= 0 ? '#047857' : '#b91c1c', margin: '6px 0' }}>
                        {netProfit >= 0 ? '+' : ''}{fmt(netProfit)}
                    </div>
                    <div style={{ fontSize: '12px', color: netProfit >= 0 ? '#065f46' : '#991b1b', fontWeight: 600 }}>
                        Tỷ suất LN Ròng: <strong>{netMarginPct.toFixed(1)}%</strong> ({netProfit > 0 ? 'Có lãi' : netProfit < 0 ? 'Đang lỗ' : 'Hòa vốn'})
                    </div>
                </div>
            </div>

            {/* CHART: REVENUE VS EXPENSES VS NET PROFIT */}
            <div className="dashboard-content-card" style={{ marginBottom: '24px', padding: '20px', background: 'var(--bg-card)', borderRadius: '14px', border: '1px solid var(--border-color)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '8px' }}>
                    <h3 style={{ margin: 0, fontSize: '16px' }}>
                        📈 Biểu Đồ Doanh Thu — Chi Phí (Định phí & Biến phí) — Lợi Nhuận ({useMonthlyChart ? 'Theo Tháng' : 'Theo Ngày'})
                    </h3>
                    <div style={{ display: 'flex', gap: '8px' }}>
                        <button className="btn btn-secondary btn-sm" onClick={handlePrintPnL}>🖨️ In Báo Cáo KQKD (A4)</button>
                        <button className="btn btn-secondary btn-sm" onClick={handleExportPnLExcel}>📊 Xuất Excel KQKD (.xlsx)</button>
                    </div>
                </div>
                <div style={{ width: '100%', height: 320 }}>
                    <ResponsiveContainer>
                        <ComposedChart data={chartData} margin={{ top: 10, right: 20, left: 10, bottom: 5 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                            <XAxis dataKey="name" stroke="#64748b" fontSize={12} />
                            <YAxis
                                stroke="#64748b"
                                fontSize={12}
                                width={75}
                                tickFormatter={val => (Math.abs(val) >= 1000000 ? `${(val / 1000000).toFixed(1)}tr` : `${(val / 1000).toFixed(0)}k`)}
                            />
                            <Tooltip
                                formatter={(value: any, name: any) => [fmt(Number(value) || 0), String(name)]}
                                contentStyle={{ borderRadius: '10px', border: '1px solid #e2e8f0', boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}
                            />
                            <Legend wrapperStyle={{ paddingTop: '12px' }} />
                            <Bar dataKey="Tổng Thu" fill="#10b981" radius={[4, 4, 0, 0]} maxBarSize={42} />
                            <Bar dataKey="Biến phí" stackId="cost" fill="#f59e0b" maxBarSize={42} />
                            <Bar dataKey="Định phí" stackId="cost" fill="#ef4444" radius={[4, 4, 0, 0]} maxBarSize={42} />
                            <Line type="monotone" dataKey="Lợi nhuận ròng" stroke="#2563eb" strokeWidth={3} dot={{ r: 4 }} />
                        </ComposedChart>
                    </ResponsiveContainer>
                </div>
            </div>

            {/* P&L STATEMENT TABLE */}
            <div className="dashboard-content-card" style={{ marginBottom: '24px', background: 'var(--bg-card)', borderRadius: '14px', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
                <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                    <div>
                        <h3 style={{ margin: 0, fontSize: '16px' }}>📑 Bảng Báo Cáo Kết Quả Hoạt Động Kinh Doanh Chi Tiết</h3>
                        <p style={{ margin: '2px 0 0', fontSize: '12px', color: 'var(--text-secondary)' }}>
                            Chuẩn kế toán quản trị: Tách biệt Doanh thu bán hàng, Thu nhập khác, Biến phí và Định phí hàng tháng
                        </p>
                    </div>
                </div>

                {loading ? (
                    <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-secondary)' }}>Đang tổng hợp số liệu Kết quả kinh doanh...</div>
                ) : (
                    <div style={{ overflowX: 'auto' }}>
                        <table className="data-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead>
                                <tr>
                                    <th style={{ ...thS, width: '50%' }}>CHỈ TIÊU TÀI CHÍNH</th>
                                    <th style={{ ...thS, width: '15%', textAlign: 'center' }}>PHÂN LOẠI</th>
                                    <th style={{ ...thS, width: '20%', textAlign: 'right' }}>SỐ TIỀN (VNĐ)</th>
                                    <th style={{ ...thS, width: '15%', textAlign: 'right' }}>TỶ TRỌNG / CHI TIẾT</th>
                                </tr>
                            </thead>
                            <tbody>
                                {/* I. DOANH THU BÁN HÀNG */}
                                <tr style={{ background: '#f0fdf4', fontWeight: 700 }}>
                                    <td style={tdS}>I. DOANH THU BÁN HÀNG & CUNG CẤP DỊCH VỤ</td>
                                    <td style={{ ...tdS, textAlign: 'center' }}>
                                        <span style={{ background: '#dcfce7', color: '#166534', padding: '2px 8px', borderRadius: '99px', fontSize: '11px' }}>Doanh thu chính</span>
                                    </td>
                                    <td style={{ ...tdS, textAlign: 'right', color: '#15803d', fontSize: '14px' }}>{fmt(totalSalesRevenue)}</td>
                                    <td style={{ ...tdS, textAlign: 'right' }}>
                                        {totalIncome > 0 ? `${((totalSalesRevenue / totalIncome) * 100).toFixed(1)}% Tổng thu` : '—'}
                                    </td>
                                </tr>
                                <tr>
                                    <td style={{ ...tdS, paddingLeft: '28px' }}>1.1. Doanh thu Vé bơi lẻ (Vé lượt)</td>
                                    <td style={{ ...tdS, textAlign: 'center', color: 'var(--text-secondary)' }}>Bán vé</td>
                                    <td style={{ ...tdS, textAlign: 'right', fontWeight: 600 }}>{fmt(revDailyTickets)}</td>
                                    <td style={{ ...tdS, textAlign: 'right', color: 'var(--text-secondary)' }}>{countDailyTickets} vé</td>
                                </tr>
                                <tr>
                                    <td style={{ ...tdS, paddingLeft: '28px' }}>1.2. Doanh thu Vé tháng & Vé nhiều buổi</td>
                                    <td style={{ ...tdS, textAlign: 'center', color: 'var(--text-secondary)' }}>Gói bơi</td>
                                    <td style={{ ...tdS, textAlign: 'right', fontWeight: 600 }}>{fmt(revMultiMonthlyTickets)}</td>
                                    <td style={{ ...tdS, textAlign: 'right', color: 'var(--text-secondary)' }}>{countMultiMonthlyTickets} gói</td>
                                </tr>
                                <tr>
                                    <td style={{ ...tdS, paddingLeft: '28px' }}>1.3. Doanh thu Khóa học bơi & Bóng rổ</td>
                                    <td style={{ ...tdS, textAlign: 'center', color: 'var(--text-secondary)' }}>Khóa học</td>
                                    <td style={{ ...tdS, textAlign: 'right', fontWeight: 600 }}>{fmt(revLessonTickets)}</td>
                                    <td style={{ ...tdS, textAlign: 'right', color: 'var(--text-secondary)' }}>{countLessonTickets} học viên</td>
                                </tr>
                                <tr>
                                    <td style={{ ...tdS, paddingLeft: '28px' }}>1.4. Doanh thu Bán lẻ sản phẩm (Quầy POS)</td>
                                    <td style={{ ...tdS, textAlign: 'center', color: 'var(--text-secondary)' }}>Bán lẻ</td>
                                    <td style={{ ...tdS, textAlign: 'right', fontWeight: 600 }}>{fmt(revRetail)}</td>
                                    <td style={{ ...tdS, textAlign: 'right', color: 'var(--text-secondary)' }}>{countRetailQty} sản phẩm</td>
                                </tr>

                                {/* II. THU NHẬP KHÁC */}
                                <tr style={{ background: '#ecfdf5', fontWeight: 700 }}>
                                    <td style={tdS}>
                                        II. THU NHẬP KHÁC (NGOÀI BÁN HÀNG)
                                        <button
                                            className="btn btn-ghost btn-sm"
                                            style={{ marginLeft: '10px', padding: '2px 8px', fontSize: '11px', color: '#059669' }}
                                            onClick={() => openCreateTransactionModal('INCOME', null)}
                                        >
                                            + Thêm Thu khác
                                        </button>
                                    </td>
                                    <td style={{ ...tdS, textAlign: 'center' }}>
                                        <span style={{ background: '#d1fae5', color: '#065f46', padding: '2px 8px', borderRadius: '99px', fontSize: '11px' }}>Thu khác</span>
                                    </td>
                                    <td style={{ ...tdS, textAlign: 'right', color: '#059669', fontSize: '14px' }}>{fmt(totalOtherIncome)}</td>
                                    <td style={{ ...tdS, textAlign: 'right' }}>
                                        {totalIncome > 0 ? `${((totalOtherIncome / totalIncome) * 100).toFixed(1)}% Tổng thu` : '—'}
                                    </td>
                                </tr>
                                {Object.entries(otherIncomeByCat).length === 0 ? (
                                    <tr>
                                        <td colSpan={4} style={{ ...tdS, paddingLeft: '28px', color: 'var(--text-secondary)', fontStyle: 'italic' }}>
                                            Chưa có khoản Thu khác nào trong kỳ. (Bấm "+ Thêm Thu khác" để ghi nhận cho thuê làn bơi, tài trợ, thanh lý...)
                                        </td>
                                    </tr>
                                ) : (
                                    Object.entries(otherIncomeByCat).map(([catName, amount]) => (
                                        <tr key={catName}>
                                            <td style={{ ...tdS, paddingLeft: '28px' }}>• {catName}</td>
                                            <td style={{ ...tdS, textAlign: 'center', color: '#059669', fontSize: '12px' }}>Thu khác</td>
                                            <td style={{ ...tdS, textAlign: 'right', fontWeight: 600, color: '#059669' }}>{fmt(amount)}</td>
                                            <td style={{ ...tdS, textAlign: 'right', color: 'var(--text-secondary)' }}>
                                                {totalIncome > 0 ? `${((amount / totalIncome) * 100).toFixed(1)}%` : '—'}
                                            </td>
                                        </tr>
                                    ))
                                )}

                                {/* TỔNG THU (A) */}
                                <tr style={{ background: '#10b981', color: '#fff', fontWeight: 800 }}>
                                    <td style={{ ...tdS, color: '#fff', fontSize: '14px' }}>👉 TỔNG DOANH THU & THU NHẬP (A = I + II)</td>
                                    <td style={{ ...tdS, textAlign: 'center', color: '#fff' }}>TỔNG THU</td>
                                    <td style={{ ...tdS, textAlign: 'right', color: '#fff', fontSize: '16px' }}>{fmt(totalIncome)}</td>
                                    <td style={{ ...tdS, textAlign: 'right', color: '#fff' }}>100%</td>
                                </tr>

                                {/* III. CHI PHÍ BIẾN ĐỔI (BIẾN PHÍ) */}
                                <tr style={{ background: '#fffbeb', fontWeight: 700 }}>
                                    <td style={tdS}>
                                        III. CHI PHÍ BIẾN ĐỔI (BIẾN PHÍ — VARIABLE COSTS)
                                        <button
                                            className="btn btn-ghost btn-sm"
                                            style={{ marginLeft: '10px', padding: '2px 8px', fontSize: '11px', color: '#d97706' }}
                                            onClick={() => openCreateTransactionModal('EXPENSE', 'VARIABLE')}
                                        >
                                            + Thêm Biến phí
                                        </button>
                                    </td>
                                    <td style={{ ...tdS, textAlign: 'center' }}>
                                        <span style={{ background: '#fef3c7', color: '#92400e', padding: '2px 8px', borderRadius: '99px', fontSize: '11px' }}>Biến phí</span>
                                    </td>
                                    <td style={{ ...tdS, textAlign: 'right', color: '#d97706', fontSize: '14px' }}>-{fmt(totalVariableCost)}</td>
                                    <td style={{ ...tdS, textAlign: 'right' }}>
                                        {totalIncome > 0 ? `${((totalVariableCost / totalIncome) * 100).toFixed(1)}% Tổng thu` : '—'}
                                    </td>
                                </tr>
                                {Object.entries(variableByCat).map(([catName, amount]) => (
                                    <tr key={catName}>
                                        <td style={{ ...tdS, paddingLeft: '28px' }}>• {catName}</td>
                                        <td style={{ ...tdS, textAlign: 'center', color: '#d97706', fontSize: '12px' }}>Biến phí</td>
                                        <td style={{ ...tdS, textAlign: 'right', fontWeight: 600, color: '#d97706' }}>-{fmt(amount)}</td>
                                        <td style={{ ...tdS, textAlign: 'right', color: 'var(--text-secondary)' }}>
                                            {totalIncome > 0 ? `${((amount / totalIncome) * 100).toFixed(1)}%` : '—'}
                                        </td>
                                    </tr>
                                ))}
                                {includeCoachPayroll && autoCoachTotal > 0 && (
                                    <tr>
                                        <td style={{ ...tdS, paddingLeft: '28px' }}>• Thù lao Huấn luyện viên (Tự động tổng hợp từ Bảng chấm công HLV)</td>
                                        <td style={{ ...tdS, textAlign: 'center', color: '#d97706', fontSize: '12px' }}>Biến phí (Tự động)</td>
                                        <td style={{ ...tdS, textAlign: 'right', fontWeight: 600, color: '#d97706' }}>-{fmt(autoCoachTotal)}</td>
                                        <td style={{ ...tdS, textAlign: 'right', color: 'var(--text-secondary)' }}>Bảng lương HLV</td>
                                    </tr>
                                )}
                                {includeShiftExpenses && shiftExpensesTotal > 0 && (
                                    <tr>
                                        <td style={{ ...tdS, paddingLeft: '28px' }}>• Phiếu chi tiền mặt tại quầy (Do lễ tân lập trong ca)</td>
                                        <td style={{ ...tdS, textAlign: 'center', color: '#d97706', fontSize: '12px' }}>Chi tại quầy</td>
                                        <td style={{ ...tdS, textAlign: 'right', fontWeight: 600, color: '#d97706' }}>-{fmt(shiftExpensesTotal)}</td>
                                        <td style={{ ...tdS, textAlign: 'right', color: 'var(--text-secondary)' }}>{shiftExpenses.length} phiếu</td>
                                    </tr>
                                )}
                                {totalVariableCost === 0 && (
                                    <tr>
                                        <td colSpan={4} style={{ ...tdS, paddingLeft: '28px', color: 'var(--text-secondary)', fontStyle: 'italic' }}>
                                            Chưa có khoản Biến phí nào trong kỳ. (VD: Hóa chất hồ bơi, Điện nước, Giá vốn hàng bán lẻ...)
                                        </td>
                                    </tr>
                                )}

                                {/* LỢI NHUẬN GỘP (B) */}
                                <tr style={{ background: '#eff6ff', fontWeight: 800 }}>
                                    <td style={{ ...tdS, color: '#1e40af' }}>👉 LỢI NHUẬN GỘP / SỐ DƯ ĐẢM PHÍ (B = A - III)</td>
                                    <td style={{ ...tdS, textAlign: 'center', color: '#1e40af' }}>LỢI NHUẬN GỘP</td>
                                    <td style={{ ...tdS, textAlign: 'right', color: '#1e40af', fontSize: '15px' }}>{fmt(grossProfit)}</td>
                                    <td style={{ ...tdS, textAlign: 'right', color: '#1e40af' }}>Margin: {grossMarginPct.toFixed(1)}%</td>
                                </tr>

                                {/* IV. CHI PHÍ CỐ ĐỊNH (ĐỊNH PHÍ) */}
                                <tr style={{ background: '#fef2f2', fontWeight: 700 }}>
                                    <td style={tdS}>
                                        IV. CHI PHÍ CỐ ĐỊNH HÀNG THÁNG (ĐỊNH PHÍ — FIXED COSTS)
                                        <button
                                            className="btn btn-ghost btn-sm"
                                            style={{ marginLeft: '10px', padding: '2px 8px', fontSize: '11px', color: '#dc2626' }}
                                            onClick={() => {
                                                setFixedModalTab('APPLY');
                                                setShowFixedModal(true);
                                            }}
                                        >
                                            📅 Áp dụng Định phí tháng / khoảng thời gian
                                        </button>
                                    </td>
                                    <td style={{ ...tdS, textAlign: 'center' }}>
                                        <span style={{ background: '#fee2e2', color: '#991b1b', padding: '2px 8px', borderRadius: '99px', fontSize: '11px' }}>Định phí</span>
                                    </td>
                                    <td style={{ ...tdS, textAlign: 'right', color: '#dc2626', fontSize: '14px' }}>-{fmt(totalFixedCost)}</td>
                                    <td style={{ ...tdS, textAlign: 'right' }}>
                                        {totalIncome > 0 ? `${((totalFixedCost / totalIncome) * 100).toFixed(1)}% Tổng thu` : '—'}
                                    </td>
                                </tr>
                                {Object.entries(fixedByCat).length === 0 ? (
                                    <tr>
                                        <td colSpan={4} style={{ ...tdS, paddingLeft: '28px', color: 'var(--text-secondary)', fontStyle: 'italic' }}>
                                            Chưa hạch toán Định phí cho kỳ này. Bấm nút <strong>"📅 Định Phí Hàng Tháng"</strong> để áp dụng tự động theo tháng hiện tại hoặc khoảng thời gian chọn trước!
                                        </td>
                                    </tr>
                                ) : (
                                    Object.entries(fixedByCat).map(([catName, amount]) => (
                                        <tr key={catName}>
                                            <td style={{ ...tdS, paddingLeft: '28px' }}>• {catName}</td>
                                            <td style={{ ...tdS, textAlign: 'center', color: '#dc2626', fontSize: '12px' }}>Định phí</td>
                                            <td style={{ ...tdS, textAlign: 'right', fontWeight: 600, color: '#dc2626' }}>-{fmt(amount)}</td>
                                            <td style={{ ...tdS, textAlign: 'right', color: 'var(--text-secondary)' }}>
                                                {totalIncome > 0 ? `${((amount / totalIncome) * 100).toFixed(1)}%` : '—'}
                                            </td>
                                        </tr>
                                    ))
                                )}

                                {/* TỔNG CHI PHÍ (C) */}
                                <tr style={{ background: '#f8fafc', fontWeight: 800 }}>
                                    <td style={tdS}>👉 TỔNG CHI PHÍ HOẠT ĐỘNG (C = III + IV)</td>
                                    <td style={{ ...tdS, textAlign: 'center', color: '#dc2626' }}>TỔNG CHI</td>
                                    <td style={{ ...tdS, textAlign: 'right', color: '#dc2626', fontSize: '15px' }}>-{fmt(totalExpenses)}</td>
                                    <td style={{ ...tdS, textAlign: 'right' }}>
                                        {totalIncome > 0 ? `${((totalExpenses / totalIncome) * 100).toFixed(1)}% Tổng thu` : '—'}
                                    </td>
                                </tr>

                                {/* V. LỢI NHUẬN RÒNG (EBT) */}
                                <tr
                                    style={{
                                        background: netProfit >= 0 ? '#065f46' : '#991b1b',
                                        color: '#fff',
                                        fontWeight: 900,
                                    }}
                                >
                                    <td style={{ ...tdS, color: '#fff', fontSize: '15px', padding: '14px 12px' }}>
                                        🏆 V. LỢI NHUẬN RÒNG TRƯỚC THUẾ (NET PROFIT = A - C)
                                    </td>
                                    <td style={{ ...tdS, textAlign: 'center', color: '#fff', padding: '14px 12px' }}>
                                        {netProfit >= 0 ? 'LÃI RÒNG' : 'LỖ RÒNG'}
                                    </td>
                                    <td style={{ ...tdS, textAlign: 'right', color: '#fff', fontSize: '18px', padding: '14px 12px' }}>
                                        {netProfit >= 0 ? '+' : ''}{fmt(netProfit)}
                                    </td>
                                    <td style={{ ...tdS, textAlign: 'right', color: '#fff', padding: '14px 12px' }}>
                                        Tỷ suất: {netMarginPct.toFixed(1)}%
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* DETAILED LEDGER OF SUPPLEMENTAL INCOME & EXPENSES (ADMIN ONLY) */}
            <div className="dashboard-content-card" style={{ background: 'var(--bg-card)', borderRadius: '14px', border: '1px solid var(--border-color)', padding: '20px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', marginBottom: '16px' }}>
                    <div>
                        <h3 style={{ margin: 0, fontSize: '16px' }}>
                            🧾 Sổ Bút Toán Thu Khác & Chi Phí Đã Hạch Toán Trong Kỳ ({finTransactions.length} bút toán Admin)
                        </h3>
                        <p style={{ margin: '2px 0 0', fontSize: '12px', color: 'var(--text-secondary)' }}>
                            Admin có thể thêm mới, chỉnh sửa hoặc xóa các khoản Thu khác, Định phí, Biến phí (kể cả các khoản lùi ngày về quá khứ)
                        </p>
                    </div>
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                        <input
                            type="text"
                            placeholder="🔍 Tìm danh mục, nội dung..."
                            value={txSearch}
                            onChange={e => setTxSearch(e.target.value)}
                            style={{ padding: '6px 12px', borderRadius: '8px', border: '1px solid var(--border-color)', fontSize: '13px', minWidth: '200px' }}
                        />
                        {(
                            [
                                { key: 'ALL', label: 'Tất cả' },
                                { key: 'INCOME', label: '🟢 Thu khác' },
                                { key: 'FIXED', label: '🔴 Định phí' },
                                { key: 'VARIABLE', label: '🟠 Biến phí' },
                            ] as const
                        ).map(f => (
                            <button
                                key={f.key}
                                className={`btn ${txFilter === f.key ? 'btn-primary' : 'btn-ghost'} btn-sm`}
                                onClick={() => setTxFilter(f.key)}
                            >
                                {f.label}
                            </button>
                        ))}
                    </div>
                </div>

                <div style={{ overflowX: 'auto', maxHeight: '55vh' }}>
                    <table className="data-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead>
                            <tr>
                                <th style={thS}>Ngày hạch toán</th>
                                <th style={thS}>Kỳ KQKD</th>
                                <th style={thS}>Phân loại</th>
                                <th style={thS}>Danh mục</th>
                                <th style={thS}>Nội dung / Diễn giải</th>
                                <th style={thS}>Thanh toán</th>
                                <th style={{ ...thS, textAlign: 'right' }}>Số tiền</th>
                                <th style={thS}>Người lập</th>
                                <th style={{ ...thS, textAlign: 'center' }}>Thao tác</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filteredLedger.length === 0 ? (
                                <tr>
                                    <td colSpan={9} style={{ textAlign: 'center', padding: '32px', color: 'var(--text-secondary)' }}>
                                        Chưa có bút toán Thu khác / Định phí / Biến phí nào khớp bộ lọc trong kỳ này.
                                    </td>
                                </tr>
                            ) : (
                                filteredLedger.map(tx => {
                                    const isInc = tx.type === 'INCOME';
                                    const isFixed = tx.type === 'EXPENSE' && tx.cost_type === 'FIXED';
                                    return (
                                        <tr key={tx.id}>
                                            <td style={{ ...tdS, fontWeight: 600, whiteSpace: 'nowrap' }}>{fmtDate(tx.transaction_date)}</td>
                                            <td style={tdS}>
                                                <code style={{ background: 'var(--bg-hover)', padding: '2px 6px', borderRadius: '4px', fontSize: '12px' }}>
                                                    {tx.accounting_month}
                                                </code>
                                            </td>
                                            <td style={tdS}>
                                                <span
                                                    style={{
                                                        background: isInc ? '#dcfce7' : isFixed ? '#fee2e2' : '#fef3c7',
                                                        color: isInc ? '#166534' : isFixed ? '#991b1b' : '#92400e',
                                                        padding: '2px 8px',
                                                        borderRadius: '99px',
                                                        fontSize: '11px',
                                                        fontWeight: 700,
                                                        whiteSpace: 'nowrap',
                                                    }}
                                                >
                                                    {isInc ? '🟢 Thu khác' : isFixed ? '🔴 Định phí' : '🟠 Biến phí'}
                                                </span>
                                            </td>
                                            <td style={{ ...tdS, fontWeight: 600 }}>{tx.category_name}</td>
                                            <td style={{ ...tdS, maxWidth: '320px', whiteSpace: 'normal' }}>{tx.description}</td>
                                            <td style={tdS}>
                                                {tx.payment_method === 'CASH'
                                                    ? '💵 Tiền mặt'
                                                    : tx.payment_method === 'TRANSFER'
                                                        ? '🏦 CK Cá nhân'
                                                        : tx.payment_method === 'TRANSFER_COMPANY'
                                                            ? '🏢 CK Công ty'
                                                            : '💳 POS'}
                                            </td>
                                            <td
                                                style={{
                                                    ...tdS,
                                                    textAlign: 'right',
                                                    fontWeight: 700,
                                                    color: isInc ? '#10b981' : '#ef4444',
                                                    whiteSpace: 'nowrap',
                                                }}
                                            >
                                                {isInc ? '+' : '-'}{fmt(tx.amount)}
                                            </td>
                                            <td style={tdS}>{tx.created_by_name || 'Admin'}</td>
                                            <td style={{ ...tdS, textAlign: 'center', whiteSpace: 'nowrap' }}>
                                                <button
                                                    className="btn btn-ghost btn-sm"
                                                    style={{ padding: '2px 6px', fontSize: '12px' }}
                                                    onClick={() => openEditTransactionModal(tx)}
                                                    title="Sửa bút toán"
                                                >
                                                    ✏️
                                                </button>
                                                <button
                                                    className="btn btn-ghost btn-sm"
                                                    style={{ padding: '2px 6px', fontSize: '12px', color: '#ef4444' }}
                                                    onClick={() => handleDeleteTx(tx)}
                                                    title="Xóa bút toán"
                                                >
                                                    🗑️
                                                </button>
                                            </td>
                                        </tr>
                                    );
                                })
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* ============================================================
                MODAL 1: CREATE / EDIT TRANSACTION (PAST OR PRESENT DATE)
               ============================================================ */}
            {showTxModal && (
                <div className="modal-overlay" onClick={() => setShowTxModal(false)}>
                    <div className="modal-card" style={{ maxWidth: '520px', width: '95%' }} onClick={e => e.stopPropagation()}>
                        <h2 style={{ marginBottom: '4px' }}>
                            {editingTxId
                                ? '✏️ Chỉnh sửa Bút toán Thu - Chi'
                                : txType === 'INCOME'
                                    ? '➕ Lập Phiếu Thu Khác (Ngoài bán hàng)'
                                    : txCostType === 'FIXED'
                                        ? '🏢 Thêm Chi Phí Cố Định (Định phí)'
                                        : '➖ Thêm Chi Phí Biến Đổi (Biến phí / Chi khác)'}
                        </h2>
                        <p style={{ fontSize: '12.5px', color: 'var(--text-secondary)', marginBottom: '16px' }}>
                            Bạn có thể chọn <strong>ngày bất kỳ trong quá khứ hoặc hiện tại</strong> để hạch toán chính xác vào kỳ Báo cáo Kết quả Kinh doanh.
                        </p>

                        <form onSubmit={handleSaveTransaction}>
                            {/* Loại giao dịch */}
                            <div style={{ display: 'flex', gap: '8px', marginBottom: '14px' }}>
                                <button
                                    type="button"
                                    className="btn"
                                    style={{
                                        flex: 1,
                                        background: txType === 'INCOME' ? '#10b981' : '#f1f5f9',
                                        color: txType === 'INCOME' ? '#fff' : '#334155',
                                        border: 'none',
                                        fontWeight: 600,
                                    }}
                                    onClick={() => {
                                        setTxType('INCOME');
                                        setTxCostType(null);
                                        const firstCat = categories.find(c => c.is_active && c.type === 'INCOME');
                                        setTxCategoryId(firstCat?.id || '');
                                    }}
                                >
                                    🟢 Thu Khác
                                </button>
                                <button
                                    type="button"
                                    className="btn"
                                    style={{
                                        flex: 1,
                                        background: txType === 'EXPENSE' && txCostType === 'VARIABLE' ? '#f59e0b' : '#f1f5f9',
                                        color: txType === 'EXPENSE' && txCostType === 'VARIABLE' ? '#fff' : '#334155',
                                        border: 'none',
                                        fontWeight: 600,
                                    }}
                                    onClick={() => {
                                        setTxType('EXPENSE');
                                        setTxCostType('VARIABLE');
                                        const firstCat = categories.find(c => c.is_active && c.type === 'EXPENSE' && c.cost_type === 'VARIABLE');
                                        setTxCategoryId(firstCat?.id || '');
                                    }}
                                >
                                    🟠 Biến Phí (Chi khác)
                                </button>
                                <button
                                    type="button"
                                    className="btn"
                                    style={{
                                        flex: 1,
                                        background: txType === 'EXPENSE' && txCostType === 'FIXED' ? '#ef4444' : '#f1f5f9',
                                        color: txType === 'EXPENSE' && txCostType === 'FIXED' ? '#fff' : '#334155',
                                        border: 'none',
                                        fontWeight: 600,
                                    }}
                                    onClick={() => {
                                        setTxType('EXPENSE');
                                        setTxCostType('FIXED');
                                        const firstCat = categories.find(c => c.is_active && c.type === 'EXPENSE' && c.cost_type === 'FIXED');
                                        setTxCategoryId(firstCat?.id || '');
                                    }}
                                >
                                    🔴 Định Phí
                                </button>
                            </div>

                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                                <div className="form-group">
                                    <label>Ngày hạch toán (Được chọn quá khứ) <span style={{ color: 'red' }}>*</span></label>
                                    <input
                                        type="date"
                                        required
                                        value={txDate}
                                        onChange={e => setTxDate(e.target.value)}
                                    />
                                </div>
                                <div className="form-group">
                                    <label>Số tiền (VNĐ) <span style={{ color: 'red' }}>*</span></label>
                                    <input
                                        type="number"
                                        min="1"
                                        required
                                        value={txAmount}
                                        onChange={e => setTxAmount(e.target.value ? Number(e.target.value) : '')}
                                        placeholder="VD: 2500000"
                                        style={{ fontWeight: 700, fontSize: '15px' }}
                                    />
                                </div>
                            </div>

                            <div className="form-group">
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <label>Danh mục hạch toán <span style={{ color: 'red' }}>*</span></label>
                                    <button
                                        type="button"
                                        style={{ background: 'none', border: 'none', color: '#2563eb', fontSize: '12px', cursor: 'pointer', fontWeight: 600 }}
                                        onClick={() => {
                                            setNewCatType(txType);
                                            setNewCatCostType(txCostType === 'FIXED' ? 'FIXED' : 'VARIABLE');
                                            setShowCatModal(true);
                                        }}
                                    >
                                        + Thêm danh mục mới
                                    </button>
                                </div>
                                <select
                                    required
                                    value={txCategoryId}
                                    onChange={e => setTxCategoryId(e.target.value)}
                                >
                                    {filteredModalCategories.map(c => (
                                        <option key={c.id} value={c.id}>
                                            {c.name}
                                        </option>
                                    ))}
                                </select>
                                {txCategoryId && (
                                    <div style={{ fontSize: '11.5px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                                        {categories.find(c => c.id === txCategoryId)?.description || ''}
                                    </div>
                                )}
                            </div>

                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                                <div className="form-group">
                                    <label>Hình thức thanh toán</label>
                                    <select value={txPaymentMethod} onChange={e => setTxPaymentMethod(e.target.value as PaymentMethodType)}>
                                        <option value="TRANSFER_COMPANY">🏢 Chuyển khoản Công ty</option>
                                        <option value="TRANSFER">🏦 Chuyển khoản Cá nhân</option>
                                        <option value="CASH">💵 Tiền mặt</option>
                                        <option value="CARD">💳 Quẹt thẻ POS</option>
                                    </select>
                                </div>
                                <div className="form-group">
                                    <label>Nguồn quỹ</label>
                                    <select value={txFundSource} onChange={e => setTxFundSource(e.target.value as FundSourceType)}>
                                        <option value="COMPANY_FUND">🏦 Quỹ Công ty / Ngân hàng</option>
                                        <option value="SHIFT_CASH">💵 Két tiền mặt tại quầy</option>
                                    </select>
                                </div>
                            </div>

                            <div className="form-group">
                                <label>Diễn giải / Nội dung chi tiết</label>
                                <textarea
                                    rows={3}
                                    value={txDescription}
                                    onChange={e => setTxDescription(e.target.value)}
                                    placeholder={
                                        txType === 'INCOME'
                                            ? 'VD: Thu tiền cho thuê 2 làn bơi CLB Ánh Viên tháng 9...'
                                            : 'VD: Mua 2 thùng Clo bột xử lý nước + 5 bao PAC...'
                                    }
                                    style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid var(--border-color)', fontFamily: 'inherit' }}
                                />
                            </div>

                            <div className="modal-actions" style={{ marginTop: '20px' }}>
                                <button type="button" className="btn btn-ghost" style={{ flex: 1 }} onClick={() => setShowTxModal(false)} disabled={txSaving}>
                                    Hủy
                                </button>
                                <button type="submit" className="btn btn-primary" style={{ flex: 1 }} disabled={txSaving}>
                                    {txSaving ? 'Đang lưu...' : '💾 Lưu Bút Toán'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* ============================================================
                MODAL 2: MONTHLY FIXED COSTS (APPLY FOR CURRENT MONTH OR RANGE)
               ============================================================ */}
            {showFixedModal && (
                <div className="modal-overlay" onClick={() => setShowFixedModal(false)}>
                    <div
                        className="modal-card"
                        style={{ maxWidth: '780px', width: '96%', maxHeight: '90vh', overflowY: 'auto' }}
                        onClick={e => e.stopPropagation()}
                    >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                            <h2 style={{ margin: 0 }}>📅 Quản Lý & Hạch Toán Chi Phí Cố Định Hàng Tháng</h2>
                            <button className="btn btn-ghost btn-sm" onClick={() => setShowFixedModal(false)}>✕</button>
                        </div>

                        <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', borderBottom: '1px solid var(--border-color)', paddingBottom: '12px' }}>
                            <button
                                type="button"
                                className={`btn ${fixedModalTab === 'APPLY' ? 'btn-primary' : 'btn-ghost'}`}
                                onClick={() => setFixedModalTab('APPLY')}
                            >
                                🚀 1. Áp dụng Định phí vào KQKD (Tháng hiện tại / Khoảng thời gian)
                            </button>
                            <button
                                type="button"
                                className={`btn ${fixedModalTab === 'TEMPLATES' ? 'btn-primary' : 'btn-ghost'}`}
                                onClick={() => setFixedModalTab('TEMPLATES')}
                            >
                                ⚙️ 2. Thiết lập Danh mục Định phí Mẫu ({templates.length})
                            </button>
                        </div>

                        {fixedModalTab === 'APPLY' ? (
                            <form onSubmit={handleApplyFixedCosts}>
                                {/* Step 1: Choose Current Month or Period Range */}
                                <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '12px', padding: '16px', marginBottom: '16px' }}>
                                    <div style={{ fontWeight: 700, color: '#1e40af', marginBottom: '10px', fontSize: '14px' }}>
                                        Bước 1: Chọn kỳ thời gian muốn hạch toán Chi phí cố định
                                    </div>
                                    <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', marginBottom: '12px' }}>
                                        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontWeight: 600 }}>
                                            <input
                                                type="radio"
                                                name="applyScope"
                                                checked={applyScope === 'CURRENT_MONTH'}
                                                onChange={() => setApplyScope('CURRENT_MONTH')}
                                            />
                                            <span>Theo 1 Tháng (Tháng hiện tại hoặc tháng cụ thể)</span>
                                        </label>
                                        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontWeight: 600 }}>
                                            <input
                                                type="radio"
                                                name="applyScope"
                                                checked={applyScope === 'PERIOD_RANGE'}
                                                onChange={() => setApplyScope('PERIOD_RANGE')}
                                            />
                                            <span>Theo Khoảng thời gian chọn trước (Từ tháng → Đến tháng, kể cả quá khứ)</span>
                                        </label>
                                    </div>

                                    {applyScope === 'CURRENT_MONTH' ? (
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                            <span style={{ fontSize: '13px', fontWeight: 600 }}>Chọn tháng áp dụng:</span>
                                            <input
                                                type="month"
                                                required
                                                value={applySingleMonth}
                                                onChange={e => setApplySingleMonth(e.target.value)}
                                                style={{ padding: '6px 12px', borderRadius: '8px', border: '1px solid #93c5fd', fontWeight: 700 }}
                                            />
                                            <button
                                                type="button"
                                                className="btn btn-ghost btn-sm"
                                                onClick={() => setApplySingleMonth(currentMonthStr)}
                                            >
                                                Về tháng hiện tại ({currentMonthStr})
                                            </button>
                                        </div>
                                    ) : (
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                                            <span style={{ fontSize: '13px', fontWeight: 600 }}>Từ tháng:</span>
                                            <input
                                                type="month"
                                                required
                                                value={applyFromMonth}
                                                onChange={e => setApplyFromMonth(e.target.value)}
                                                style={{ padding: '6px 12px', borderRadius: '8px', border: '1px solid #93c5fd', fontWeight: 700 }}
                                            />
                                            <span style={{ fontSize: '13px', fontWeight: 600 }}>Đến tháng:</span>
                                            <input
                                                type="month"
                                                required
                                                value={applyToMonth}
                                                onChange={e => setApplyToMonth(e.target.value)}
                                                style={{ padding: '6px 12px', borderRadius: '8px', border: '1px solid #93c5fd', fontWeight: 700 }}
                                            />
                                            <span style={{ fontSize: '12px', color: '#1d4ed8', fontWeight: 600 }}>
                                                ({getMonthsInRange(applyFromMonth, applyToMonth).length} tháng sẽ được hạch toán)
                                            </span>
                                        </div>
                                    )}

                                    <div style={{ marginTop: '12px', paddingTop: '10px', borderTop: '1px dashed #bfdbfe', display: 'flex', gap: '16px', alignItems: 'center', flexWrap: 'wrap', fontSize: '12.5px' }}>
                                        <span style={{ fontWeight: 600, color: '#334155' }}>Nếu tháng đó đã có khoản định phí này:</span>
                                        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                                            <input
                                                type="radio"
                                                name="dupMode"
                                                checked={duplicateMode === 'SKIP_EXISTING'}
                                                onChange={() => setDuplicateMode('SKIP_EXISTING')}
                                            />
                                            <span>Bỏ qua tháng đã có (Chống trùng lặp)</span>
                                        </label>
                                        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                                            <input
                                                type="radio"
                                                name="dupMode"
                                                checked={duplicateMode === 'OVERWRITE_EXISTING'}
                                                onChange={() => setDuplicateMode('OVERWRITE_EXISTING')}
                                            />
                                            <span>Cập nhật đè bằng số tiền mới</span>
                                        </label>
                                    </div>
                                </div>

                                {/* Step 2: Check items & adjust monthly amounts */}
                                <div style={{ marginBottom: '16px' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                                        <div style={{ fontWeight: 700, fontSize: '14px' }}>
                                            Bước 2: Chọn các khoản Định phí và nhập mức chi phí mỗi tháng (VNĐ/tháng)
                                        </div>
                                        <button
                                            type="button"
                                            className="btn btn-ghost btn-sm"
                                            style={{ fontSize: '12px', color: '#2563eb' }}
                                            onClick={() => setFixedModalTab('TEMPLATES')}
                                        >
                                            + Thêm khoản định phí mẫu mới
                                        </button>
                                    </div>

                                    <div style={{ border: '1px solid var(--border-color)', borderRadius: '10px', overflow: 'hidden' }}>
                                        <table className="data-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
                                            <thead>
                                                <tr>
                                                    <th style={{ ...thS, width: '40px', textAlign: 'center' }}>Chọn</th>
                                                    <th style={thS}>Khoản Chi phí Cố định hàng tháng</th>
                                                    <th style={thS}>Ngày hạch toán</th>
                                                    <th style={{ ...thS, width: '200px' }}>Số tiền / 1 tháng (VNĐ)</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {templates.map(tpl => {
                                                    const checked = !!selectedTemplateIds[tpl.id];
                                                    const val = overrideAmounts[tpl.id] ?? tpl.default_amount;
                                                    return (
                                                        <tr key={tpl.id} style={{ background: checked ? '#fff' : '#f8fafc', opacity: checked ? 1 : 0.6 }}>
                                                            <td style={{ ...tdS, textAlign: 'center' }}>
                                                                <input
                                                                    type="checkbox"
                                                                    checked={checked}
                                                                    onChange={e =>
                                                                        setSelectedTemplateIds(prev => ({ ...prev, [tpl.id]: e.target.checked }))
                                                                    }
                                                                />
                                                            </td>
                                                            <td style={tdS}>
                                                                <div style={{ fontWeight: 600 }}>{tpl.name}</div>
                                                                {tpl.note && <div style={{ fontSize: '11.5px', color: 'var(--text-secondary)' }}>{tpl.note}</div>}
                                                            </td>
                                                            <td style={tdS}>Ngày {tpl.day_of_month} hàng tháng</td>
                                                            <td style={tdS}>
                                                                <input
                                                                    type="number"
                                                                    min="0"
                                                                    value={val}
                                                                    onChange={e =>
                                                                        setOverrideAmounts(prev => ({
                                                                            ...prev,
                                                                            [tpl.id]: Number(e.target.value) || 0,
                                                                        }))
                                                                    }
                                                                    placeholder="Nhập số tiền..."
                                                                    style={{
                                                                        width: '100%',
                                                                        padding: '6px 10px',
                                                                        borderRadius: '6px',
                                                                        border: '1px solid var(--border-color)',
                                                                        fontWeight: 700,
                                                                        textAlign: 'right',
                                                                    }}
                                                                />
                                                            </td>
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>

                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#f8fafc', padding: '12px 16px', borderRadius: '10px', marginBottom: '16px' }}>
                                    <span style={{ fontSize: '13px', fontWeight: 600 }}>
                                        Tổng Định phí 1 tháng đã chọn:{' '}
                                        <strong style={{ color: '#dc2626', fontSize: '16px' }}>
                                            {fmt(
                                                templates
                                                    .filter(t => selectedTemplateIds[t.id])
                                                    .reduce((s, t) => s + (Number(overrideAmounts[t.id] ?? t.default_amount) || 0), 0)
                                            )}
                                        </strong>
                                    </span>
                                    <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                                        (Số tiền bạn nhập sẽ tự động được lưu làm mặc định cho các tháng sau)
                                    </span>
                                </div>

                                <div className="modal-actions">
                                    <button type="button" className="btn btn-ghost" style={{ flex: 1 }} onClick={() => setShowFixedModal(false)} disabled={applyingFixed}>
                                        Đóng
                                    </button>
                                    <button type="submit" className="btn btn-primary" style={{ flex: 2 }} disabled={applyingFixed}>
                                        {applyingFixed
                                            ? 'Đang hạch toán...'
                                            : applyScope === 'CURRENT_MONTH'
                                                ? `✅ Hạch toán Định phí cho Tháng ${applySingleMonth}`
                                                : `✅ Hạch toán Định phí cho giai đoạn ${applyFromMonth} → ${applyToMonth}`}
                                    </button>
                                </div>
                            </form>
                        ) : (
                            /* TAB 2: CONFIGURE FIXED COST TEMPLATES */
                            <div>
                                <form onSubmit={handleSaveTemplate} style={{ background: '#f8fafc', padding: '16px', borderRadius: '12px', marginBottom: '16px', border: '1px solid var(--border-color)' }}>
                                    <h4 style={{ margin: '0 0 12px', fontSize: '14px' }}>
                                        {editingTplId ? '✏️ Sửa Khoản Định Phí Mẫu' : '➕ Thêm Khoản Định Phí Hàng Tháng Mới'}
                                    </h4>
                                    <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '12px' }}>
                                        <div className="form-group">
                                            <label>Tên khoản định phí hàng tháng <span style={{ color: 'red' }}>*</span></label>
                                            <input
                                                type="text"
                                                required
                                                value={tplName}
                                                onChange={e => setTplName(e.target.value)}
                                                placeholder="VD: Tiền thuê mặt bằng hồ bơi / Lương cứng nhân viên..."
                                            />
                                        </div>
                                        <div className="form-group">
                                            <label>Số tiền mặc định / tháng (VNĐ)</label>
                                            <input
                                                type="number"
                                                min="0"
                                                value={tplAmount}
                                                onChange={e => setTplAmount(e.target.value ? Number(e.target.value) : '')}
                                                placeholder="VD: 30000000"
                                            />
                                        </div>
                                    </div>
                                    <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: '12px' }}>
                                        <div className="form-group">
                                            <label>Thuộc Danh mục Định phí</label>
                                            <select value={tplCategoryId} onChange={e => setTplCategoryId(e.target.value)}>
                                                {categories
                                                    .filter(c => c.type === 'EXPENSE' && c.cost_type === 'FIXED')
                                                    .map(c => (
                                                        <option key={c.id} value={c.id}>{c.name}</option>
                                                    ))}
                                            </select>
                                        </div>
                                        <div className="form-group">
                                            <label>Ngày hạch toán (1-28)</label>
                                            <input
                                                type="number"
                                                min="1"
                                                max="28"
                                                value={tplDayOfMonth}
                                                onChange={e => setTplDayOfMonth(Number(e.target.value) || 1)}
                                            />
                                        </div>
                                        <div className="form-group">
                                            <label>H/T Thanh toán</label>
                                            <select value={tplPaymentMethod} onChange={e => setTplPaymentMethod(e.target.value as PaymentMethodType)}>
                                                <option value="TRANSFER_COMPANY">🏢 CK Công ty</option>
                                                <option value="TRANSFER">🏦 CK Cá nhân</option>
                                                <option value="CASH">💵 Tiền mặt</option>
                                            </select>
                                        </div>
                                    </div>
                                    <div className="form-group">
                                        <label>Ghi chú</label>
                                        <input
                                            type="text"
                                            value={tplNote}
                                            onChange={e => setTplNote(e.target.value)}
                                            placeholder="Ghi chú thêm (tùy chọn)"
                                        />
                                    </div>
                                    <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                                        {editingTplId && (
                                            <button
                                                type="button"
                                                className="btn btn-ghost btn-sm"
                                                onClick={() => {
                                                    setEditingTplId(null);
                                                    setTplName('');
                                                    setTplAmount('');
                                                    setTplNote('');
                                                }}
                                            >
                                                Hủy sửa
                                            </button>
                                        )}
                                        <button type="submit" className="btn btn-primary btn-sm" disabled={tplSaving}>
                                            {tplSaving ? 'Đang lưu...' : editingTplId ? '💾 Cập nhật Mẫu' : '➕ Lưu vào Danh sách Mẫu'}
                                        </button>
                                    </div>
                                </form>

                                <div style={{ overflowX: 'auto' }}>
                                    <table className="data-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
                                        <thead>
                                            <tr>
                                                <th style={thS}>Tên khoản định phí</th>
                                                <th style={thS}>Ngày/tháng</th>
                                                <th style={{ ...thS, textAlign: 'right' }}>Mức mặc định</th>
                                                <th style={{ ...thS, textAlign: 'center' }}>Thao tác</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {templates.map(t => (
                                                <tr key={t.id}>
                                                    <td style={tdS}>
                                                        <strong>{t.name}</strong>
                                                        {t.note && <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>{t.note}</div>}
                                                    </td>
                                                    <td style={tdS}>Ngày {t.day_of_month}</td>
                                                    <td style={{ ...tdS, textAlign: 'right', fontWeight: 700, color: '#dc2626' }}>
                                                        {fmt(t.default_amount)}
                                                    </td>
                                                    <td style={{ ...tdS, textAlign: 'center' }}>
                                                        <button
                                                            type="button"
                                                            className="btn btn-ghost btn-sm"
                                                            onClick={() => {
                                                                setEditingTplId(t.id);
                                                                setTplName(t.name);
                                                                setTplCategoryId(t.category_id || '11111111-0001-4000-8000-000000000001');
                                                                setTplAmount(t.default_amount);
                                                                setTplPaymentMethod(t.default_payment_method);
                                                                setTplDayOfMonth(t.day_of_month);
                                                                setTplNote(t.note || '');
                                                            }}
                                                        >
                                                            ✏️ Sửa
                                                        </button>
                                                        <button
                                                            type="button"
                                                            className="btn btn-ghost btn-sm"
                                                            style={{ color: '#ef4444' }}
                                                            onClick={() => handleDeleteTemplate(t.id)}
                                                        >
                                                            🗑️ Xóa
                                                        </button>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* ============================================================
                MODAL 3: CATEGORIES MANAGEMENT
               ============================================================ */}
            {showCatModal && (
                <div className="modal-overlay" onClick={() => setShowCatModal(false)}>
                    <div className="modal-card" style={{ maxWidth: '640px', width: '95%', maxHeight: '85vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                            <h2 style={{ margin: 0 }}>🏷️ Danh Mục Thu Khác, Định Phí & Biến Phí</h2>
                            <button className="btn btn-ghost btn-sm" onClick={() => setShowCatModal(false)}>✕</button>
                        </div>

                        <form onSubmit={handleSaveNewCategory} style={{ background: '#f8fafc', padding: '14px', borderRadius: '10px', marginBottom: '16px', border: '1px solid var(--border-color)' }}>
                            <h4 style={{ margin: '0 0 10px', fontSize: '13.5px' }}>➕ Thêm Danh Mục Hạch Toán Mới</h4>
                            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: '10px' }}>
                                <div className="form-group" style={{ marginBottom: '8px' }}>
                                    <label>Tên danh mục <span style={{ color: 'red' }}>*</span></label>
                                    <input
                                        type="text"
                                        required
                                        value={newCatName}
                                        onChange={e => setNewCatName(e.target.value)}
                                        placeholder="VD: Thu cho thuê phao / Chi phí mua Clo..."
                                    />
                                </div>
                                <div className="form-group" style={{ marginBottom: '8px' }}>
                                    <label>Loại</label>
                                    <select value={newCatType} onChange={e => setNewCatType(e.target.value as FinancialType)}>
                                        <option value="EXPENSE">Chi phí</option>
                                        <option value="INCOME">Thu khác</option>
                                    </select>
                                </div>
                                {newCatType === 'EXPENSE' && (
                                    <div className="form-group" style={{ marginBottom: '8px' }}>
                                        <label>Nhóm chi phí</label>
                                        <select value={newCatCostType} onChange={e => setNewCatCostType(e.target.value as 'FIXED' | 'VARIABLE')}>
                                            <option value="VARIABLE">Biến phí</option>
                                            <option value="FIXED">Định phí</option>
                                        </select>
                                    </div>
                                )}
                            </div>
                            <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                                <input
                                    type="text"
                                    value={newCatDesc}
                                    onChange={e => setNewCatDesc(e.target.value)}
                                    placeholder="Mô tả gợi ý (không bắt buộc)..."
                                    style={{ flex: 1, padding: '8px 10px', borderRadius: '6px', border: '1px solid var(--border-color)', fontSize: '13px' }}
                                />
                                <button type="submit" className="btn btn-primary btn-sm" disabled={catSaving}>
                                    {catSaving ? 'Đang lưu...' : '➕ Thêm Danh Mục'}
                                </button>
                            </div>
                        </form>

                        <div style={{ maxHeight: '45vh', overflowY: 'auto' }}>
                            <table className="data-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
                                <thead>
                                    <tr>
                                        <th style={thS}>Tên danh mục</th>
                                        <th style={thS}>Phân nhóm</th>
                                        <th style={thS}>Gợi ý chi tiết</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {categories.map(c => (
                                        <tr key={c.id}>
                                            <td style={{ ...tdS, fontWeight: 600 }}>{c.name}</td>
                                            <td style={tdS}>
                                                <span
                                                    style={{
                                                        background: c.type === 'INCOME' ? '#dcfce7' : c.cost_type === 'FIXED' ? '#fee2e2' : '#fef3c7',
                                                        color: c.type === 'INCOME' ? '#166534' : c.cost_type === 'FIXED' ? '#991b1b' : '#92400e',
                                                        padding: '2px 8px',
                                                        borderRadius: '99px',
                                                        fontSize: '11px',
                                                        fontWeight: 600,
                                                        whiteSpace: 'nowrap',
                                                    }}
                                                >
                                                    {c.type === 'INCOME' ? 'Thu khác' : c.cost_type === 'FIXED' ? 'Định phí' : 'Biến phí'}
                                                </span>
                                            </td>
                                            <td style={{ ...tdS, fontSize: '12px', color: 'var(--text-secondary)', whiteSpace: 'normal' }}>
                                                {c.description || '—'}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
