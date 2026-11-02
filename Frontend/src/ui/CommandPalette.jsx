import { useEffect, useMemo, useRef, useState } from 'react';
import { Activity, BarChart3, ClipboardList, CornerDownLeft, FileText, History, HousePlus, Languages, Lightbulb, LineChart, LogOut, Moon, PhoneCall, Search, Settings, Siren, Stethoscope, Sun, UserRound, Users } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useT } from '../i18n';
import { setTheme } from './theme';

// Quick navigation: ⌘K / Ctrl+K or the top-bar search box opens it; type to filter, arrows + Enter to run.
export default function CommandPalette({ open, onClose }) {
  const navigate = useNavigate();
  const { logout } = useAuth();
  const { t, lang, setLang } = useT();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const input = useRef(null);
  const list = useRef(null);

  const commands = useMemo(() => [
    { group: 'Go to', label: 'Overview', icon: BarChart3, run: () => navigate('/dashboard'), keywords: 'dashboard home' },
    { group: 'Go to', label: t('nav.homeScreening'), icon: HousePlus, run: () => navigate('/home-screening'), keywords: 'screening risk 10 year framingham' },
    { group: 'Go to', label: 'Clinical assessment', icon: ClipboardList, run: () => navigate('/assessment'), keywords: 'new assessment predict' },
    { group: 'Go to', label: t('nav.community'), icon: Users, run: () => navigate('/community'), keywords: 'asha patients village referral' },
    { group: 'Go to', label: t('nav.specialists'), icon: Stethoscope, run: () => navigate('/specialists'), keywords: 'doctor cardiologist hospital clinic near map directions' },
    { group: 'Go to', label: 'What-if lab', icon: Activity, run: () => navigate('/simulator'), keywords: 'simulator scenario' },
    { group: 'Go to', label: 'Health history', icon: History, run: () => navigate('/history'), keywords: 'past assessments trend' },
    { group: 'Go to', label: 'Insights', icon: Lightbulb, run: () => navigate('/insights'), keywords: 'factors' },
    { group: 'Go to', label: 'Model insights', icon: LineChart, run: () => navigate('/model-insights'), keywords: 'accuracy fairness calibration model card' },
    { group: 'Go to', label: 'Reports', icon: FileText, run: () => navigate('/reports'), keywords: 'pdf doctor download' },
    { group: 'Go to', label: t('nav.sos'), icon: PhoneCall, run: () => navigate('/sos'), keywords: 'call 108 ambulance family whatsapp hospital route medical card qr' },
    { group: 'Go to', label: t('nav.emergency'), icon: Siren, run: () => navigate('/emergency'), keywords: 'chest pain 108 112 stroke' },
    { group: 'Go to', label: 'My profile', icon: UserRound, run: () => navigate('/profile'), keywords: 'account' },
    { group: 'Go to', label: 'Settings', icon: Settings, run: () => navigate('/settings'), keywords: 'preferences' },
    { group: 'Actions', label: 'Light theme', icon: Sun, run: () => setTheme('light'), keywords: 'appearance mode' },
    { group: 'Actions', label: 'Dark theme', icon: Moon, run: () => setTheme('dark'), keywords: 'appearance mode night' },
    { group: 'Actions', label: lang === 'en' ? 'हिंदी में बदलें' : 'Switch to English', icon: Languages, run: () => setLang(lang === 'en' ? 'hi' : 'en'), keywords: 'language hindi english' },
    { group: 'Actions', label: 'Log out', icon: LogOut, run: logout, keywords: 'sign out' },
  ], [navigate, t, lang, setLang, logout]);

  const results = commands.filter((command) => `${command.label} ${command.keywords}`.toLowerCase().includes(query.trim().toLowerCase()));

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActive(0);
    requestAnimationFrame(() => input.current?.focus());
  }, [open]);
  useEffect(() => { setActive(0); }, [query]);
  useEffect(() => {
    list.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  if (!open) return null;
  const run = (command) => { onClose(); command.run(); };
  const onKeyDown = (event) => {
    if (event.key === 'ArrowDown') { event.preventDefault(); setActive((index) => Math.min(index + 1, results.length - 1)); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setActive((index) => Math.max(index - 1, 0)); }
    else if (event.key === 'Enter' && results[active]) { event.preventDefault(); run(results[active]); }
    else if (event.key === 'Escape') onClose();
  };

  let lastGroup = null;
  return <div className="palette-backdrop" onMouseDown={onClose}>
    <div className="palette" role="dialog" aria-modal="true" aria-label="Command palette" onMouseDown={(event) => event.stopPropagation()} onKeyDown={onKeyDown}>
      <label className="palette-search"><Search size={18} /><input ref={input} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search pages and actions…" aria-controls="palette-list" aria-activedescendant={results[active] ? `palette-${active}` : undefined} role="combobox" aria-expanded="true" /><kbd>Esc</kbd></label>
      <ul className="palette-list" id="palette-list" role="listbox" ref={list}>
        {results.length === 0 && <li className="palette-empty">No matches for “{query}”</li>}
        {results.map((command, index) => {
          const heading = command.group !== lastGroup ? command.group : null;
          lastGroup = command.group;
          const Icon = command.icon;
          return [
            heading && <li key={`h-${heading}`} className="palette-group" role="presentation">{heading}</li>,
            <li key={command.label} id={`palette-${index}`} data-index={index} role="option" aria-selected={index === active}
              className={`palette-item ${index === active ? 'active' : ''}`} onMouseEnter={() => setActive(index)} onClick={() => run(command)}>
              <span className="palette-icon"><Icon size={17} /></span>{command.label}{index === active && <CornerDownLeft size={15} className="palette-enter" />}
            </li>,
          ];
        })}
      </ul>
      <div className="palette-foot"><span><kbd>↑</kbd><kbd>↓</kbd> move</span><span><kbd>↵</kbd> open</span><span><kbd>Esc</kbd> close</span></div>
    </div>
  </div>;
}
