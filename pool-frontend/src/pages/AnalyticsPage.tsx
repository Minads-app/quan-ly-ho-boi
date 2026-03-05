/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { ResponsiveContainer, LineChart, Line, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';

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

        // 1. Fetch Tickets for Revenue calculation
        let ticketQuery = supabase
            .from('tickets')
            .select(`id, price_paid, sold_at, ticket_types (category)`)
            .gte('sold_at', from + 'T00:00:00+07:00')
            .lte('sold_at', to + 'T23:59:59+07:00');

        if (!isAdmin && profile) { // Lễ tân chỉ xem doanh thu của họ
            ticketQuery = ticketQuery.eq('sold_by', profile.id);
        }

        const { data: ticketsData } = await ticketQuery;

        // 2. Fetch Scan Logs for Session calculation (actual check-ins)
        const { data: scanData } = await supabase
            .from('scan_logs')
            .select('scanned_at, status')
            .eq('status', 'IN')
            .gte('scanned_at', from + 'T00:00:00+07:00')
            .lte('scanned_at', to + 'T23:59:59+07:00');

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
            <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
                <div>
                    <h1>📊 Tổng Quan Phân Tích</h1>
                    <p>Biểu đồ theo dõi Lượt khách (Check-ins) và Doanh thu cơ sở</p>
                </div>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    {(['7_DAYS', '30_DAYS', 'THIS_MONTH', 'LAST_MONTH'] as DateRange[]).map(r => (
                        <button key={r} className={`btn ${dateRange === r ? 'btn-primary' : 'btn-ghost'}`}
                            style={{ padding: '6px 14px', fontSize: '13px' }}
                            onClick={() => setDateRange(r)}>
                            {r === '7_DAYS' ? '7 ngày qua' : r === '30_DAYS' ? '30 ngày qua' : r === 'THIS_MONTH' ? 'Tháng này' : 'Tháng trước'}
                        </button>
                    ))}
                </div>
            </div>

            {loading ? (
                <div className="page-loading">Đang tải dữ liệu biểu đồ...</div>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', marginTop: '16px' }}>

                    {/* Chart Row 1 */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: '24px' }}>

                        {/* LINE CHART: SESSIONS */}
                        <div className="dashboard-content-card">
                            <h3 style={{ marginBottom: '16px', color: 'var(--text-color)' }}>Biểu đồ Lượt khách (Người qua cổng)</h3>
                            <div style={{ width: '100%', height: 300 }}>
                                <ResponsiveContainer>
                                    <LineChart data={dailySessions} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                                        <XAxis dataKey="name" stroke="#64748b" fontSize={12} tickMargin={10} />
                                        <YAxis stroke="#64748b" fontSize={12} tickFormatter={(val) => Math.round(val).toString()} />
                                        <Tooltip
                                            contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)' }}
                                            labelStyle={{ fontWeight: 'bold', color: '#333' }}
                                        />
                                        <Legend wrapperStyle={{ paddingTop: '20px' }} />
                                        <Line type="monotone" name="Lượt khách vào (IN)" dataKey="Lượt khách" stroke="#10b981" strokeWidth={3} activeDot={{ r: 8 }} />
                                    </LineChart>
                                </ResponsiveContainer>
                            </div>
                        </div>

                        {/* BAR CHART: REVENUE */}
                        <div className="dashboard-content-card">
                            <h3 style={{ marginBottom: '16px', color: 'var(--text-color)' }}>Biểu đồ Doanh thu (VND)</h3>
                            <div style={{ width: '100%', height: 300 }}>
                                <ResponsiveContainer>
                                    <BarChart data={dailyRevenue} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                                        <XAxis dataKey="name" stroke="#64748b" fontSize={12} tickMargin={10} />
                                        <YAxis stroke="#64748b" fontSize={12} width={65} tickFormatter={(val) => (val / 1000).toLocaleString('vi-VN') + 'k'} />
                                        <Tooltip
                                            formatter={(value: number | undefined) => [fmtCurrency(value || 0), "Doanh thu"]}
                                            contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)' }}
                                            labelStyle={{ fontWeight: 'bold', color: '#333' }}
                                        />
                                        <Legend wrapperStyle={{ paddingTop: '20px' }} />
                                        <Bar name="Tiền thu về" dataKey="Doanh thu" fill="#3b82f6" radius={[4, 4, 0, 0]} maxBarSize={50} />
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>
                        </div>
                    </div>

                    {/* Chart Row 2 */}
                    <div className="dashboard-content-card" style={{ maxWidth: '600px', margin: '0 auto', width: '100%' }}>
                        <h3 style={{ marginBottom: '16px', color: 'var(--text-color)', textAlign: 'center' }}>Cơ cấu Doanh thu theo Dịch vụ</h3>
                        {revenuePie.length === 0 ? (
                            <p style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: '40px' }}>Chưa có doanh thu trong khoảng thời gian này.</p>
                        ) : (
                            <div style={{ width: '100%', height: 350 }}>
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
                                        <Tooltip formatter={(value: number | undefined) => fmtCurrency(value || 0)} />
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
