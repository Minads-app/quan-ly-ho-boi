/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { fetchAllSupabaseRows } from '../utils/financialService';
import { ResponsiveContainer, LineChart, Line, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';
import { PageHeader, SegmentedTabs } from '../components/ui';

type DateRange = '7_DAYS' | '30_DAYS' | 'THIS_MONTH' | 'LAST_MONTH';

export default function AnalyticsPage() {
    const { profile } = useAuth();
    const isAdmin = profile?.role === 'ADMIN';

    const [dateRange, setDateRange] = useState<DateRange>('7_DAYS');
    const [loading, setLoading] = useState(true);

    const [dailyRevenue, setDailyRevenue] = useState<Record<string, any>[]>([]);
    const [dailySessions, setDailySessions] = useState<Record<string, any>[]>([]);
    const [revenuePie, setRevenuePie] = useState<Record<string, any>[]>([]);

    function getDateBounds(): { from: string; to: string } {
        const now = new Date();
        const pad = (n: number) => n.toString().padStart(2, '0');
        const todayStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

        if (dateRange === '7_DAYS') {
            const past = new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000);
            return { from: `${past.getFullYear()}-${pad(past.getMonth() + 1)}-${pad(past.getDate())}`, to: todayStr };
        } else if (dateRange === '30_DAYS') {
            const past = new Date(now.getTime() - 29 * 24 * 60 * 60 * 1000);
            return { from: `${past.getFullYear()}-${pad(past.getMonth() + 1)}-${pad(past.getDate())}`, to: todayStr };
        } else if (dateRange === 'THIS_MONTH') {
            return { from: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`, to: todayStr };
        } else if (dateRange === 'LAST_MONTH') {
            const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
            const lastDay = new Date(now.getFullYear(), now.getMonth(), 0);
            return {
                from: `${lastMonth.getFullYear()}-${pad(lastMonth.getMonth() + 1)}-01`,
                to: `${lastDay.getFullYear()}-${pad(lastDay.getMonth() + 1)}-${pad(lastDay.getDate())}`
            };
        }
        return { from: todayStr, to: todayStr };
    }

    async function fetchAnalytics() {
        setLoading(true);
        const { from, to } = getDateBounds();

        // 1. Fetch Tickets for Revenue calculation (all pages)
        const { data: ticketsData } = await fetchAllSupabaseRows<any>((fromIdx, toIdx) => {
            let ticketQuery = supabase
                .from('tickets')
                .select(`id, price_paid, sold_at, status, ticket_types (category)`)
                .neq('status', 'CANCELLED')
                .gt('price_paid', 0)
                .gte('sold_at', from + 'T00:00:00+07:00')
                .lte('sold_at', to + 'T23:59:59+07:00')
                .order('sold_at', { ascending: false })
                .order('id', { ascending: true });

            if (!isAdmin && profile) { // Lễ tân chỉ xem doanh thu của họ
                ticketQuery = ticketQuery.eq('sold_by', profile.id);
            }

            return ticketQuery.range(fromIdx, toIdx);
        });

        // 2. Fetch Scan Logs for Session calculation (actual check-ins - all pages)
        const { data: scanData } = await fetchAllSupabaseRows<any>((fromIdx, toIdx) =>
            supabase
                .from('scan_logs')
                .select('id, scanned_at, direction, success')
                .eq('direction', 'IN')
                .eq('success', true)
                .gte('scanned_at', from + 'T00:00:00+07:00')
                .lte('scanned_at', to + 'T23:59:59+07:00')
                .order('scanned_at', { ascending: false })
                .order('id', { ascending: true })
                .range(fromIdx, toIdx)
        );

        // Process Daily Sessions (Line Chart)
        const sessionMap: Record<string, number> = {};
        (scanData || []).forEach((row: Record<string, any>) => {
            const dateStr = new Date(row.scanned_at).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' });
            sessionMap[dateStr] = (sessionMap[dateStr] || 0) + 1;
        });

        // Date generator for complete X-Axis
        const startD = new Date(from);
        const endD = new Date(to);
        const dateArray: string[] = [];
        for (let d = new Date(startD); d <= endD; d.setDate(d.getDate() + 1)) {
            dateArray.push(d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' }));
        }

        const sessionsChartData = dateArray.map(date => ({
            name: date,
            "Lượt khách": sessionMap[date] || 0
        }));

        // Process Daily Revenue (Bar Chart)
        const revenueMap: Record<string, number> = {};
        let catDaily = 0, catMulti = 0, catMonthly = 0, catLesson = 0, catOther = 0;

        (ticketsData || []).forEach((row: Record<string, any>) => {
            if (row.price_paid <= 0) return; // Skip free passes for revenue

            // Map Daily Revenue
            const dateStr = new Date(row.sold_at).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' });
            revenueMap[dateStr] = (revenueMap[dateStr] || 0) + row.price_paid;

            // Map Pie Chart categories
            const cat = row.ticket_types?.category || 'UNKNOWN';
            if (cat === 'DAILY') catDaily += row.price_paid;
            else if (cat === 'MULTI') catMulti += row.price_paid;
            else if (cat === 'MONTHLY') catMonthly += row.price_paid;
            else if (cat === 'LESSON') catLesson += row.price_paid;
            else catOther += row.price_paid;
        });

        const revenueChartData = dateArray.map(date => ({
            name: date,
            "Doanh thu": revenueMap[date] || 0
        }));

        // Build Pie Data
        const pieData = [];
        if (catDaily > 0) pieData.push({ name: 'Vé lẻ', value: catDaily, color: '#f59e0b' });
        if (catMulti > 0) pieData.push({ name: 'Nhiều buổi', value: catMulti, color: '#8b5cf6' });
        if (catMonthly > 0) pieData.push({ name: 'Vé tháng', value: catMonthly, color: '#3b82f6' });
        if (catLesson > 0) pieData.push({ name: 'Học bơi', value: catLesson, color: '#ec4899' });
        if (catOther > 0) pieData.push({ name: 'Dịch vụ khác', value: catOther, color: '#64748b' });

        setDailySessions(sessionsChartData);
        setDailyRevenue(revenueChartData);
        setRevenuePie(pieData);
        setLoading(false);
    }

    useEffect(() => {
        fetchAnalytics();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [dateRange]);

    const fmtCurrency = (val: number) => new Intl.NumberFormat('vi-VN').format(val) + 'đ';

    return (
        <div className="page-container">
            <PageHeader
                title="Tổng Quan Phân Tích"
                subtitle="Biểu đồ theo dõi Lượt khách (Check-ins) và Doanh thu cơ sở"
                actions={
                    <SegmentedTabs
                        size="sm"
                        tabs={[
                            { key: '7_DAYS', label: '7 ngày qua' },
                            { key: '30_DAYS', label: '30 ngày qua' },
                            { key: 'THIS_MONTH', label: 'Tháng này' },
                            { key: 'LAST_MONTH', label: 'Tháng trước' },
                        ]}
                        activeKey={dateRange}
                        onChange={(k) => setDateRange(k as DateRange)}
                    />
                }
            />

            {loading ? (
                <div className="page-loading">Đang tải dữ liệu biểu đồ...</div>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

                    {/* Chart Row 1 */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: '20px' }}>

                        {/* LINE CHART: SESSIONS */}
                        <div className="dashboard-content-card">
                            <h3 style={{ marginBottom: '16px', fontSize: '15px', fontWeight: 700, color: 'var(--text-primary)' }}>Biểu đồ Lượt khách (Người qua cổng)</h3>
                            <div style={{ width: '100%', height: 300 }}>
                                <ResponsiveContainer>
                                    <LineChart data={dailySessions} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" vertical={false} />
                                        <XAxis dataKey="name" stroke="var(--text-secondary)" fontSize={12} tickMargin={10} />
                                        <YAxis stroke="var(--text-secondary)" fontSize={12} tickFormatter={(val) => Math.round(val).toString()} />
                                        <Tooltip
                                            contentStyle={{ background: 'var(--bg-card)', borderRadius: '10px', border: '1px solid var(--border-color)', boxShadow: 'var(--shadow-md)', color: 'var(--text-primary)' }}
                                            labelStyle={{ fontWeight: 'bold', color: 'var(--text-primary)' }}
                                        />
                                        <Legend wrapperStyle={{ paddingTop: '16px' }} />
                                        <Line type="monotone" name="Lượt khách vào (IN)" dataKey="Lượt khách" stroke="#10b981" strokeWidth={3} activeDot={{ r: 7 }} />
                                    </LineChart>
                                </ResponsiveContainer>
                            </div>
                        </div>

                        {/* BAR CHART: REVENUE */}
                        <div className="dashboard-content-card">
                            <h3 style={{ marginBottom: '16px', fontSize: '15px', fontWeight: 700, color: 'var(--text-primary)' }}>Biểu đồ Doanh thu (VND)</h3>
                            <div style={{ width: '100%', height: 300 }}>
                                <ResponsiveContainer>
                                    <BarChart data={dailyRevenue} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" vertical={false} />
                                        <XAxis dataKey="name" stroke="var(--text-secondary)" fontSize={12} tickMargin={10} />
                                        <YAxis stroke="var(--text-secondary)" fontSize={12} width={65} tickFormatter={(val) => (val / 1000).toLocaleString('vi-VN') + 'k'} />
                                        <Tooltip
                                            formatter={(value: number | undefined) => [fmtCurrency(value || 0), "Doanh thu"]}
                                            contentStyle={{ background: 'var(--bg-card)', borderRadius: '10px', border: '1px solid var(--border-color)', boxShadow: 'var(--shadow-md)', color: 'var(--text-primary)' }}
                                            labelStyle={{ fontWeight: 'bold', color: 'var(--text-primary)' }}
                                        />
                                        <Legend wrapperStyle={{ paddingTop: '16px' }} />
                                        <Bar name="Tiền thu về" dataKey="Doanh thu" fill="#0284c7" radius={[6, 6, 0, 0]} maxBarSize={48} />
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>
                        </div>
                    </div>

                    {/* Chart Row 2 */}
                    <div className="dashboard-content-card" style={{ maxWidth: '640px', margin: '0 auto', width: '100%' }}>
                        <h3 style={{ marginBottom: '16px', fontSize: '15px', fontWeight: 700, color: 'var(--text-primary)', textAlign: 'center' }}>Cơ cấu Doanh thu theo Dịch vụ</h3>
                        {revenuePie.length === 0 ? (
                            <p style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: '40px' }}>Chưa có doanh thu trong khoảng thời gian này.</p>
                        ) : (
                            <div style={{ width: '100%', height: 340 }}>
                                <ResponsiveContainer>
                                    <PieChart>
                                        <Pie
                                            data={revenuePie}
                                            cx="50%"
                                            cy="50%"
                                            innerRadius={70}
                                            outerRadius={110}
                                            paddingAngle={3}
                                            dataKey="value"
                                            label={({ name, percent }: Record<string, any>) => `${name} ${((percent || 0) * 100).toFixed(0)}%`}
                                            labelLine={true}
                                        >
                                            {revenuePie.map((entry, index) => (
                                                <Cell key={`cell-${index}`} fill={entry.color} />
                                            ))}
                                        </Pie>
                                        <Tooltip
                                            formatter={(value: number | undefined) => fmtCurrency(value || 0)}
                                            contentStyle={{ background: 'var(--bg-card)', borderRadius: '10px', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
                                        />
                                        <Legend />
                                    </PieChart>
                                </ResponsiveContainer>
                            </div>
                        )}
                    </div>

                </div>
            )}
        </div>
    );
}
