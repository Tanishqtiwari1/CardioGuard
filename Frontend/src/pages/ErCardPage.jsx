import { HeartPulse, TriangleAlert } from 'lucide-react';
import { useParams } from 'react-router-dom';
import ErCard from '../components/sos/ErCard';
import { decodeCard } from '../services/sos';
import './sos.css';

// What hospital staff see after scanning the QR. Everything comes from the link itself.
export default function ErCardPage() {
  const { data } = useParams();
  const card = decodeCard(data);
  return <div className="sos-page">
    <header className="sos-top"><span className="brand-mark"><span className="brand-icon"><HeartPulse size={19} /></span><span className="brand-copy"><strong>Cardio<span>Guard</span></strong><small>Emergency handoff</small></span></span></header>
    <main className="sos-main narrow">
      {card
        ? <section className="sos-section"><h1 className="er-title">Emergency handoff card</h1><ErCard card={card} /></section>
        : <section className="sos-section sos-state"><TriangleAlert size={28} /><h1>This card can’t be read</h1><p className="muted-text">The QR link is incomplete. Ask the patient or their family to show the card on their phone.</p></section>}
    </main>
  </div>;
}
