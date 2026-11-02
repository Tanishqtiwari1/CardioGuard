import { useEffect, useRef } from 'react';
import { ArrowRight, BrainCircuit, ChevronDown, CircleCheck, FileText, HeartPulse, HousePlus, Languages, ScanText, ShieldCheck, Siren, SlidersHorizontal, Sparkles, Users, WifiOff } from 'lucide-react';
import { Link } from 'react-router-dom';
import LiveRiskDemo from '../components/landing/LiveRiskDemo';
import CountUp from '../ui/CountUp';
import EcgLine from '../ui/EcgLine';
import { ThemeToggle } from '../ui/theme';

const STATS = [
  { value: 5158, label: 'real patient records behind the models' },
  { value: 82.1, decimals: 1, suffix: '%', label: 'accuracy on patients the model never saw' },
  { value: 0.915, decimals: 3, label: 'ROC-AUC of the clinical model' },
  { value: 0, suffix: ' tests', label: 'needed for home screening' },
];

const STEPS = [
  { title: 'Check for warning signs', text: 'A 10-second emergency check comes first. Chest pain right now? You get 108 / 112, not a score.' },
  { title: 'Answer what you already know', text: 'Age, smoking, diabetes and one blood pressure reading. Or snap a photo of a lab report to fill it in.' },
  { title: 'Understand your estimate', text: 'Your 10-year risk, what is driving it, and clear next steps you can act on today.' },
  { title: 'Take it to a doctor', text: 'Download a one-page PDF with your results and the questions worth asking.' },
];

export default function Landing() {
  return <div className="landing-page">
    <ScrollProgress />
    <header className="landing-nav">
      <Link to="/" className="brand-mark"><span className="brand-icon"><HeartPulse size={19} /></span><span className="brand-copy"><strong>Cardio<span>Guard</span></strong><small>AI health intelligence</small></span></Link>
      <nav className="landing-links" aria-label="Main">
        <a href="#how-it-works">How it works</a>
        <a href="#features">Capabilities</a>
        <Link to="/sos" className="nav-emergency"><Siren size={15} /> SOS</Link>
        <ThemeToggle />
        <Link to="/login" className="text-link">Login <ArrowRight size={15} /></Link>
        <Link to="/signup" className="btn btn-primary nav-signup">Sign up</Link>
      </nav>
    </header>

    <main>
      <section className="hero-section">
        <div className="hero-aurora" aria-hidden="true" />
        <div className="hero-copy">
          <div className="eyebrow hero-eyebrow"><Sparkles size={14} /> Trained on 5,000+ real patient records</div>
          <h1>Know your heart risk <em>in 60 seconds.</em></h1>
          <p>No hospital tests needed. CardioGuard estimates your 10-year heart risk, explains what drives it, and helps you take the right next step, even offline.</p>
          <div className="hero-actions">
            <Link className="btn btn-primary btn-large" to="/signup">Start free assessment <ArrowRight size={18} /></Link>
            <a className="btn btn-ghost btn-large" href="#how-it-works">Explore features <ChevronDown size={17} /></a>
          </div>
          <Link className="emergency-strip" to="/emergency"><span className="emergency-pulse"><Siren size={17} /></span><span><strong>Chest pain right now?</strong> Check the warning signs / अभी सीने में दर्द?</span><ArrowRight size={15} /></Link>
          <div className="trust-row">
            <span><CircleCheck size={16} /> No hospital tests needed for home screening</span>
            <span><ShieldCheck size={16} /> Private by design</span>
          </div>
        </div>
        <div className="hero-visual">
          <LiveRiskDemo />
        </div>
        <EcgLine className="hero-ecg" beats={6} />
      </section>

      <section className="stats-band" aria-label="Key numbers">
        {STATS.map((stat) => <div className="stat-tile" key={stat.label} data-reveal>
          <strong><CountUp value={stat.value} decimals={stat.decimals || 0} suffix={stat.suffix || ''} startOnView duration={1400} /></strong>
          <span>{stat.label}</span>
        </div>)}
      </section>

      <section className="feature-section" id="features">
        <div className="section-intro" data-reveal>
          <div className="eyebrow">One workspace, more clarity</div>
          <h2>Built for real homes,<br /><em>real clinics, real villages.</em></h2>
          <p>Everything you need to go from "am I at risk?" to a confident conversation with a doctor.</p>
        </div>
        <div className="bento-grid">
          <article className="bento-card bento-hero" data-reveal>
            <span className="bento-icon"><HousePlus size={22} /></span>
            <h3>Home screening, no lab tests</h3>
            <p>10-year heart risk from questions anyone can answer and one blood pressure reading. Shown as a percentage and as "N in 100 people like you".</p>
            <div className="bento-dots" aria-hidden="true">{Array.from({ length: 50 }, (_, index) => <i key={index} className={index % 7 === 3 ? 'on' : ''} />)}</div>
          </article>
          <article className="bento-card bento-tall" data-reveal>
            <span className="bento-icon"><Users size={22} /></span>
            <h3>For ASHA &amp; community health workers</h3>
            <p>Screen door to door, flag high-risk people, track referrals and print referral slips.</p>
            <div className="bento-offline"><WifiOff size={16} /> Works with no signal. Syncs when back online.</div>
          </article>
          <Bento icon={Siren} tone="danger" title="Emergency check first" text="Heart attack or stroke signs show 108 / 112 instead of a score." />
          <Bento icon={BrainCircuit} title="Explainable AI" text="See which signals shape your estimate, not just a number." />
          <Bento icon={SlidersHorizontal} title="What-if lab" text="See how changing one measure could change your risk." />
          <Bento icon={ScanText} title="Reads lab reports" text="Photograph a report; values are read on your device." />
          <Bento icon={FileText} title="Doctor-ready PDF" text="Results, drivers, trend and questions to ask." />
          <Bento icon={Languages} title="हिंदी + English" text="Screening in the language people actually speak." />
        </div>
      </section>

      <section className="how-section" id="how-it-works">
        <div className="how-copy" data-reveal>
          <div className="eyebrow">A calmer workflow</div>
          <h2>Health decisions feel better when the picture is <em>clear.</em></h2>
          <p className="how-lead">Four steps, about a minute, no jargon.</p>
        </div>
        <ol className="timeline">
          {STEPS.map((step, index) => <li className="timeline-step" key={step.title} data-reveal>
            <span className="timeline-number">{index + 1}</span>
            <div><strong>{step.title}</strong><p>{step.text}</p></div>
          </li>)}
        </ol>
      </section>

      <section className="honest-section" data-reveal>
        <div>
          <div className="eyebrow"><ShieldCheck size={14} /> Honest AI</div>
          <h2>We show our numbers, <em>and our limits.</em></h2>
          <p>Every model is tested on patients it never saw, checked for fairness across men, women, age groups and hospitals, and published with a model card. Where the data may not fit, for example South Asian users, the app says so.</p>
        </div>
        <ul className="honest-list">
          <li><strong>UCI Heart Disease</strong><span>918 patients · 4 hospitals · clinical model</span></li>
          <li><strong>Framingham Heart Study</strong><span>4,240 adults · 10-year follow-up · home model</span></li>
          <li><strong>Calibration &amp; fairness</strong><span>Shown inside the app for both models</span></li>
        </ul>
      </section>

      <section className="cta-section" data-reveal>
        <div>
          <div className="eyebrow">Start with a baseline</div>
          <h2>Make your next health conversation<br /><em>more informed.</em></h2>
          <Link className="btn btn-light btn-large" to="/signup">Begin your assessment <ArrowRight size={17} /></Link>
        </div>
        <div className="cta-heart-wrap" aria-hidden="true"><span className="cta-ring" /><span className="cta-ring delay" /><HeartPulse className="cta-heart" size={120} strokeWidth={1} /></div>
      </section>
    </main>

    <footer className="landing-footer">
      <span>© 2026 CardioGuard AI</span>
      <span>Educational tool, not a diagnosis</span>
    </footer>
  </div>;
}

function Bento({ icon: Icon, title, text, tone = '' }) {
  return <article className={`bento-card ${tone}`} data-reveal><span className="bento-icon"><Icon size={20} /></span><h3>{title}</h3><p>{text}</p></article>;
}

function ScrollProgress() {
  const bar = useRef(null);
  useEffect(() => {
    const update = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      if (bar.current) bar.current.style.transform = `scaleX(${max > 0 ? window.scrollY / max : 0})`;
    };
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    update();
    return () => { window.removeEventListener('scroll', update); window.removeEventListener('resize', update); };
  }, []);
  return <div className="scroll-progress" aria-hidden="true"><span ref={bar} /></div>;
}
