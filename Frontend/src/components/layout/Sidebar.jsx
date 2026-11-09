import { NavLink, Link } from 'react-router-dom';
import { Activity, BarChart3, ClipboardList, FileText, History, HousePlus, Lightbulb, LineChart, PanelLeftClose, PhoneCall, Pill, Siren, Stethoscope, Users, X } from 'lucide-react';
import { useT } from '../../i18n';

const links = [
  { to: '/dashboard', label: 'Overview', icon: BarChart3 },
  { to: '/home-screening', labelKey: 'nav.homeScreening', icon: HousePlus },
  { to: '/assessment', label: 'Clinical assessment', icon: ClipboardList },
  { to: '/medicines', labelKey: 'nav.medicines', icon: Pill },
  { to: '/community', labelKey: 'nav.community', icon: Users },
  { to: '/specialists', labelKey: 'nav.specialists', icon: Stethoscope },
  { to: '/simulator', label: 'What-if lab', icon: Activity },
  { to: '/history', label: 'Health history', icon: History },
  { to: '/insights', label: 'Insights', icon: Lightbulb },
  { to: '/model-insights', label: 'Model insights', icon: LineChart },
  { to: '/reports', label: 'Reports', icon: FileText },
];

export default function Sidebar({ open, onClose, onToggle }) {
  const { t } = useT();
  return (
    <aside className={`sidebar ${open ? 'sidebar-open' : ''}`}>
      <div className="sidebar-head">
        <Link to="/dashboard" className="brand-mark" onClick={onClose}>
          <span className="brand-icon"><Activity size={19} strokeWidth={2.5} /></span>
          <span className="brand-copy"><strong>Cardio<span>Guard</span></strong><small>AI health intelligence</small></span>
        </Link>
        <button className="icon-btn mobile-only" onClick={onClose} aria-label="Close navigation"><X size={20} /></button>
      </div>
      <div className="sidebar-section-label">Workspace</div>
      <nav className="side-nav">
        {links.map(({ to, label, labelKey, icon: Icon }) => (
          <NavLink key={to} to={to} onClick={onClose} className={({ isActive }) => `side-link ${isActive ? 'active' : ''}`}>
            <Icon size={19} /><span>{labelKey ? t(labelKey) : label}</span>
          </NavLink>
        ))}
        <NavLink to="/sos" onClick={onClose} className="side-link side-link-emergency"><PhoneCall size={19} /><span>{t('nav.sos')}</span></NavLink>
        <NavLink to="/emergency" onClick={onClose} className="side-link side-link-emergency"><Siren size={19} /><span>{t('nav.emergency')}</span></NavLink>
      </nav>
      <div className="sidebar-spacer" />
      <div className="sidebar-note">
        <span className="note-dot" />
        <div><strong>Private by design</strong><p>Only you can see your results. Lab reports are read on this device.</p></div>
      </div>
      <button className="collapse-btn" onClick={onToggle}><PanelLeftClose size={18} /><span>Collapse sidebar</span></button>
    </aside>
  );
}