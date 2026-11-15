import { Ambulance, ExternalLink, Phone } from 'lucide-react';
import { useT } from '../../i18n';
import { MEDULANCE, NATIONAL } from '../../services/emergencyProviders';

// One place to get an ambulance: call Medulance (fastest), or open its booking page.
// Medulance has no public API, so CardioGuard links to it and never books on the patient's
// behalf. It isn't in every city, so the government numbers stay one tap away.
export default function AmbulanceOptions({ compact = false }) {
  const { t } = useT();
  return <section className={`ambulance-options${compact ? ' compact' : ''}`} aria-labelledby="ambulance-title">
    <h2 id="ambulance-title"><Ambulance size={20} /> {t('ambulance.title')}</h2>
    <a className="ambulance-call" href={`tel:${MEDULANCE.phone}`}>
      <Phone size={22} />
      <span><strong>{t('ambulance.call')}</strong><small>{MEDULANCE.phoneDisplay}</small></span>
    </a>
    <a className="ambulance-book" href={MEDULANCE.bookingUrl} target="_blank" rel="noopener noreferrer">
      <ExternalLink size={17} />
      <span><strong>{t('ambulance.book')}</strong><small>{t('ambulance.bookHint')}</small></span>
    </a>
    {!compact && <p className="ambulance-say">{t('ambulance.say')}</p>}
    <p className="ambulance-fallback">
      {t('ambulance.fallback')}{' '}
      <a href={`tel:${NATIONAL.ambulance}`}>{t('ambulance.call108')}</a>{' · '}
      <a href={`tel:${NATIONAL.emergency}`}>{t('ambulance.call112')}</a>
    </p>
    <small className="ambulance-note">{t('ambulance.note')}</small>
  </section>;
}
