import { useEffect, type CSSProperties, type ReactNode } from 'react';
import { useTheme } from '../../contexts/ThemeContext';
import { MoonIcon, SunIcon, XIcon } from './Icons';

/** Consistent page header with title, subtitle, optional badge, and right-aligned action slot. */
export function PageHeader({
  title,
  subtitle,
  badge,
  actions,
}: {
  title: string;
  subtitle?: string;
  badge?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="ui-page-header">
      <div className="ui-page-header-left">
        <div className="ui-page-title-row">
          <h1>{title}</h1>
          {badge}
        </div>
        {subtitle && <p className="ui-page-subtitle">{subtitle}</p>}
      </div>
      {actions && <div className="ui-page-actions">{actions}</div>}
    </div>
  );
}

/** Surface card container respecting light/dark tokens. */
export function Card({
  children,
  className = '',
  style,
  noPadding = false,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  noPadding?: boolean;
}) {
  return (
    <div
      className={`ui-card ${noPadding ? 'ui-card-flush' : ''} ${className}`.trim()}
      style={style}
    >
      {children}
    </div>
  );
}

export type StatTone = 'blue' | 'green' | 'amber' | 'red' | 'purple' | 'neutral';

/** KPI summary card with tabular numbers and semantic tone accent. */
export function StatCard({
  label,
  value,
  subtext,
  tone = 'blue',
  icon,
}: {
  label: string;
  value: string | number;
  subtext?: string;
  tone?: StatTone;
  icon?: ReactNode;
}) {
  return (
    <div className={`ui-stat-card ui-tone-${tone}`}>
      <div className="ui-stat-top">
        <span className="ui-stat-label">{label}</span>
        {icon && <span className="ui-stat-icon">{icon}</span>}
      </div>
      <div className="ui-stat-value tabular-nums">{value}</div>
      {subtext && <div className="ui-stat-sub">{subtext}</div>}
    </div>
  );
}

export interface SegmentedTabItem<K extends string = string> {
  key: K;
  label: string;
  icon?: ReactNode;
  count?: number;
}

/** Segmented pill tab switcher. */
export function SegmentedTabs<K extends string = string>({
  tabs,
  activeKey,
  onChange,
  size = 'md',
}: {
  tabs: SegmentedTabItem<K>[];
  activeKey: K;
  onChange: (key: K) => void;
  size?: 'sm' | 'md';
}) {
  return (
    <div className={`ui-segmented ui-segmented-${size}`} role="tablist">
      {tabs.map(t => {
        const active = t.key === activeKey;
        return (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={active}
            className={`ui-segmented-btn ${active ? 'active' : ''}`}
            onClick={() => onChange(t.key)}
          >
            {t.icon && <span className="ui-segmented-icon">{t.icon}</span>}
            <span>{t.label}</span>
            {t.count !== undefined && <span className="ui-segmented-count tabular-nums">{t.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

export type BadgeVariant = 'neutral' | 'blue' | 'green' | 'amber' | 'red' | 'purple';

/** Pill badge for status, category, or tags. */
export function Badge({
  children,
  variant = 'neutral',
  className = '',
}: {
  children: ReactNode;
  variant?: BadgeVariant;
  className?: string;
}) {
  return <span className={`ui-badge ui-badge-${variant} ${className}`.trim()}>{children}</span>;
}

/** Slide-over detail drawer from the right edge of the viewport. */
export function Drawer({
  open,
  onClose,
  title,
  subtitle,
  footer,
  children,
  width = 480,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  width?: number;
}) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="ui-drawer-overlay" onClick={onClose} role="dialog" aria-modal="true">
      <div
        className="ui-drawer-panel"
        style={{ maxWidth: `${width}px` }}
        onClick={e => e.stopPropagation()}
      >
        <div className="ui-drawer-header">
          <div className="ui-drawer-titles">
            <h3>{title}</h3>
            {subtitle && <div className="ui-drawer-subtitle">{subtitle}</div>}
          </div>
          <button
            type="button"
            className="ui-icon-btn"
            onClick={onClose}
            aria-label="Đóng"
          >
            <XIcon size={18} />
          </button>
        </div>
        <div className="ui-drawer-body">{children}</div>
        {footer && <div className="ui-drawer-footer">{footer}</div>}
      </div>
    </div>
  );
}

/** Standardized empty state placeholder. */
export function EmptyState({
  icon = '📭',
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="ui-empty-state">
      <div className="ui-empty-icon">{icon}</div>
      <div className="ui-empty-title">{title}</div>
      {description && <p className="ui-empty-desc">{description}</p>}
      {action && <div className="ui-empty-action">{action}</div>}
    </div>
  );
}

/** Light / Dark mode toggle button usable in TopBar and LoginPage. */
export function ThemeToggleButton({ compact = false }: { compact?: boolean }) {
  const { isDark, toggleTheme } = useTheme();
  return (
    <button
      type="button"
      onClick={toggleTheme}
      className="theme-toggle-btn"
      title={isDark ? 'Chuyển sang Giao diện Sáng' : 'Chuyển sang Giao diện Tối (Dark Mode)'}
      aria-label={isDark ? 'Chuyển sang Giao diện Sáng' : 'Chuyển sang Giao diện Tối'}
    >
      {isDark ? <SunIcon size={16} /> : <MoonIcon size={16} />}
      {!compact && <span>{isDark ? 'Sáng' : 'Tối'}</span>}
    </button>
  );
}
