import {
  Activity,
  ArrowRight,
  CalendarDays,
  ChevronRight,
  HeartPulse,
  Sparkles,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import EmptyState from "../components/common/EmptyState";
import ActionPlan from "../components/common/ActionPlan";
import StatCard from "../components/common/StatCard";
import SpecialistPrompt from "../components/specialists/SpecialistPrompt";
import RiskGauge from "../components/dashboard/RiskGauge";
import { useAuth } from "../context/AuthContext";
import useHistoryData from "../hooks/useHistoryData";

export default function Dashboard() {
  const location = useLocation();
  const { user } = useAuth();
  const { history, loading } = useHistoryData();
  const latest = location.state?.result
    ? { result: location.state.result, formData: location.state.formData }
    : history[0] && {
        result: {
          risk_probability: history[0].risk_probability,
          risk_category: history[0].risk_category,
          shap_values: {},
          insights: [],
          action_plan: history[0].action_plan || [],
          model_id: history[0].model_id || "standard",
        },
        formData: history[0].form_data,
      };
  if (loading)
    return (
      <div className="auth-loading">
        <div className="loading-spinner" />
        <span>Loading your health workspace...</span>
      </div>
    );
  if (!latest)
    return (
      <div className="center-page">
        <EmptyState
          title="Your health journey starts here"
          text="Complete your first assessment to create a private baseline for your account."
        />
      </div>
    );
  const { result, formData } = latest;
  const risk = Number(result.risk_probability || 0);
  const riskDisplay = risk.toFixed(1);
  const trend =
    risk < 40 ? "Improving" : risk < 66 ? "Stable" : "Needs attention";
  const factors = Object.entries(result.shap_values || {})
    .sort(([, a], [, b]) => Math.abs(b) - Math.abs(a))
    .slice(0, 3);
  return (
    <div className="dashboard-page">
      <div className="page-heading dashboard-heading">
        <div>
          <span className="eyebrow">Your personal workspace</span>
          <h1>
            {greeting()}, {user.name.split(" ")[0]}{" "}
            <span className="wave">✦</span>
          </h1>
          <p>Here is your latest health picture, in one calm view.</p>
        </div>
        <Link className="btn btn-primary" to="/assessment">
          <HeartPulse size={17} /> New assessment
        </Link>
      </div>
      <div className="stat-grid">
        <StatCard
          icon={HeartPulse}
          label="Latest risk estimate"
          value={`${riskDisplay}%`}
          meta={`${result.risk_category} risk band · ${result.model_id === "extended" ? "extended model (13 inputs)" : "standard model (10 inputs)"}`}
          tone={result.risk_category === "HIGH" ? "coral" : "mint"}
        />
        <StatCard
          icon={Activity}
          label="Resting blood pressure"
          value={`${formData.trestbps}`}
          meta="mmHg · latest reading"
          tone="blue"
        />
        <StatCard
          icon={TrendingDown}
          label="Health trend"
          value={trend}
          meta="Compared with baseline"
          tone="yellow"
        />
        <StatCard
          icon={CalendarDays}
          label="Last assessment"
          value="Latest"
          meta="Private account record"
          tone="purple"
        />
      </div>
      <SpecialistPrompt band={result.risk_category} />
      <div className="dashboard-grid">
        <section className="panel risk-panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">Your current picture</span>
              <h2>Risk overview</h2>
            </div>
            <Link className="subtle-link" to="/reports">
              View report <ArrowRight size={15} />
            </Link>
          </div>
          <div className="risk-overview">
            <RiskGauge value={risk} category={result.risk_category} />
            <div className="risk-summary">
              <p>
                {result.risk_category === "LOW"
                  ? "Your current signals sit in a lower estimated risk range."
                  : "Your current signals suggest a useful opportunity for a closer conversation."}
              </p>
              <div className="summary-line">
                <span>Model confidence</span>
                <strong>High</strong>
              </div>
              <div className="summary-line">
                <span>Assessment status</span>
                <strong className="status-text">
                  <i /> Complete
                </strong>
              </div>
              <small>
                CardioGuard provides an educational estimate, not a diagnosis.
              </small>
            </div>
          </div>
        </section>
        <section className="panel trend-panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">Personal baseline</span>
              <h2>Risk trend</h2>
            </div>
            <span className="period-pill">
              {history.length} check-in{history.length === 1 ? "" : "s"}
            </span>
          </div>
          <div className="chart-area">
            <div className="chart-y">
              <span>100%</span>
              <span>50%</span>
              <span>0%</span>
            </div>
            <svg
              viewBox="0 0 480 160"
              preserveAspectRatio="none"
              className="line-chart"
            >
              <path
                d="M0,128 C52,120 72,126 112,105 S184,92 230,103 S296,67 345,80 S410,45 480,52 L480,160 L0,160Z"
                fill="rgba(47,157,143,.14)"
              />
              <path
                d="M0,128 C52,120 72,126 112,105 S184,92 230,103 S296,67 345,80 S410,45 480,52"
                fill="none"
                stroke="#2f9d8f"
                strokeWidth="3"
                strokeLinecap="round"
              />
            </svg>
          </div>
          <div className="chart-x">
            <span>Earlier</span>
            <span>Recent</span>
            <span>Today</span>
          </div>
          <div className="trend-callout">
            <TrendingDown size={16} />
            <span>Your estimate is ready to track over time.</span>
          </div>
        </section>
        <section className="panel factors-panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">Explainable AI</span>
              <h2>Key contributing factors</h2>
            </div>
            <Link className="subtle-link" to="/insights">
              See all <ArrowRight size={15} />
            </Link>
          </div>
          {factors.length ? (
            <div className="factor-list">
              {factors.map(([name, impact]) => (
                <Factor key={name} name={name} impact={impact} />
              ))}
            </div>
          ) : (
            <p className="panel-muted">
              Your latest summary is available. Run a new assessment to refresh
              explainable factors.
            </p>
          )}
        </section>
        <section className="panel insight-panel">
          <div className="insight-accent">
            <Sparkles size={20} />
          </div>
          <div>
            <span className="eyebrow">Personalized insight</span>
            <h2>
              {result.insights?.[0] ||
                "Your account is ready for a fresh, explainable assessment."}
            </h2>
            <p>
              Small, consistent actions are easier to sustain than dramatic
              changes. Explore your scenarios to see what matters most.
            </p>
            <Link className="subtle-link" to="/simulator">
              Open what-if lab <ArrowRight size={15} />
            </Link>
          </div>
        </section>
      </div>
      <ActionPlan items={result.action_plan || []} />
    </div>
  );
}
function Factor({ name, impact }) {
  const positive = impact >= 0;
  const label =
    {
      trestbps: "Blood pressure",
      chol: "Cholesterol",
      thalach: "Maximum heart rate",
      oldpeak: "ST depression",
      slope: "ST slope",
      ca: "Major vessels (fluoroscopy)",
      thal: "Thallium stress test",
      age: "Age",
      sex: "Sex at birth",
      cp: "Chest pain type",
      fbs: "Fasting sugar",
      restecg: "Resting ECG",
      exang: "Exercise angina",
    }[name] || name;
  return (
    <div className="factor-row">
      <div className={`factor-icon ${positive ? "coral" : "mint"}`}>
        {positive ? <TrendingUp size={15} /> : <TrendingDown size={15} />}
      </div>
      <div className="factor-name">
        <strong>{label}</strong>
        <span>
          {positive ? "Pushes estimate higher" : "Pushes estimate lower"}
        </span>
      </div>
      <div className="factor-bar">
        <i
          className={positive ? "positive" : "negative"}
          style={{ width: `${Math.min(Math.abs(impact) * 80 + 12, 100)}%` }}
        />
      </div>
      <span
        className={
          positive ? "factor-value positive-text" : "factor-value negative-text"
        }
      >
        {positive ? "+" : ""}
        {impact.toFixed(2)}
      </span>
      <ChevronRight size={15} className="muted-icon" />
    </div>
  );
}

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}
