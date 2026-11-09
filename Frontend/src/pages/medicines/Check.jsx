import { ChevronRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { getHealthProfile, runFullCheck, medicineLabel } from '../../services/medicines';
import { ErrorState, Escalate, Loading, PageFooter, PageHead, RELATION_TONE, SourceNote, Status, SummaryGrid, useLoad, useTx } from './shared';

export default function Check() {
  const { t } = useTx();
  const check = useLoad(runFullCheck);
  const profile = useLoad(getHealthProfile);
  if (check.status === 'loading') return <Loading label={t('med.check.running')} />;
  if (check.status === 'error') return <ErrorState onRetry={check.reload} />;
  const data = check.data;
  const medicines = Object.values(data.cabinet);

  if (!medicines.length) {
    return <div className="med-page narrow">
      <PageHead title={t('med.check.title')} text={t('med.check.needMedicines')}><Link className="btn btn-primary btn-large" to="/medicines/scan">{t('med.scan')}</Link></PageHead>
    </div>;
  }

  const { sections } = data;
  const name = (id) => (data.cabinet[id] ? medicineLabel(data.cabinet[id]) : '');
  const none = <p className="med-muted">{t('med.check.none')}</p>;
  const doctorPhone = profile.data?.doctor_phone;

  return <div className="med-page narrow">
    <PageHead title={t('med.check.title')} />
    <section className="med-card">
      <h2>{t('med.summary.title')}</h2>
      <SummaryGrid summary={data.summary} />
    </section>

    <section aria-label={t('med.issues.title')} className="med-stack">
      {data.issues.length === 0
        ? <div className="med-card"><p>{t('med.issues.none')}</p><p className="med-muted">{t('med.issues.noneNote')}</p></div>
        : data.issues.map((issue) => <Issue key={issue.id} issue={issue} name={name} doctorPhone={doctorPhone} medicines={medicines} />)}
    </section>

    <Section number={1} titleKey="med.check.s1" questionKey="med.check.s1q">
      <p>{t('med.check.s1a', { a: sections.identification.confirmed, b: sections.identification.unconfirmed, c: sections.identification.not_in_reference })}</p>
    </Section>
    <Section number={2} titleKey="med.check.s2" questionKey="med.check.s2q">
      <ul className="med-plain">{Object.entries(data.medicines).map(([id, info]) => <li key={id} className="med-row"><span>{name(Number(id))}</span><Status tone={RELATION_TONE[info.relationship.status]}>{t(`med.rel.${info.relationship.status}`)}</Status></li>)}</ul>
    </Section>
    <Section number={3} titleKey="med.check.s3" questionKey="med.check.s3q">
      <p>{sections.prescription.on_file ? t('med.check.s3a', { a: sections.prescription.matches, b: sections.prescription.not_on_prescription }) : t('med.check.s3none')}</p>
      {data.unmatched_prescription_items.length > 0 && <>
        <strong>{t('med.check.unscanned')}</strong>
        <ul className="med-plain">{data.unmatched_prescription_items.map((item) => <li key={item.id}>{[item.medicine_name, item.strength].filter(Boolean).join(' ')}</li>)}</ul>
      </>}
    </Section>
    <Section number={4} titleKey="med.check.s4" questionKey="med.check.s4q">
      <p>{sections.prescription.on_file ? t('med.check.s4a', { a: sections.strength.matches, b: sections.strength.differs }) : t('med.check.s3none')}</p>
    </Section>
    <Section number={5} titleKey="med.check.s5" questionKey="med.check.s5q">
      {sections.duplicates.length ? <ul className="med-plain">{sections.duplicates.map((group) => <li key={group.medicine_ids.join()}>{group.medicines.join(' + ')}</li>)}</ul> : none}
    </Section>
    <Section number={6} titleKey="med.check.s6" questionKey="med.check.s6q">
      {sections.interactions.length ? <ul className="med-plain">{sections.interactions.map((item) => <li key={`${item.id}-${item.medicine_ids.join()}`}>{item.medicines.join(' + ')}</li>)}</ul> : none}
      <p className="med-muted">{t('med.check.s6note')}</p>
    </Section>
    <Section number={7} titleKey="med.check.s7" questionKey="med.check.s7q">
      <p>{t('med.check.s7a', { a: sections.missing.instructions.length, b: sections.missing.strength.length, c: sections.missing.expiry.length })}</p>
    </Section>
    <Section number={8} titleKey="med.check.s8" questionKey="med.check.s8q">
      <p>{t('med.check.s8a', { a: sections.expiry.expired.length, b: sections.expiry.expiring_soon.length })}</p>
    </Section>
    <PageFooter />
  </div>;
}

function Section({ number, titleKey, questionKey, children }) {
  const { t } = useTx();
  return <details className="med-card med-disclosure">
    <summary><span className="med-number">{number}</span>{t(titleKey)}</summary>
    <p className="med-muted">{t(questionKey)}</p>
    {children}
  </details>;
}

function Issue({ issue, name, doctorPhone, medicines }) {
  const { t, tx } = useTx();
  const tone = issue.severity === 'important' ? 'alert' : 'review';
  const { interaction } = issue;
  return <details className={`med-card med-disclosure med-issue ${tone}`}>
    <summary>
      <Status tone={tone}>{tx(issue.title)}</Status>
      <span className="med-issue-names">{issue.medicine_ids.map(name).filter(Boolean).join(' + ')}</span>
    </summary>
    <p>{tx(issue.body)}</p>
    {interaction && <dl className="med-facts">
      <div><dt>{t('med.check.kind')}</dt><dd>{tx(interaction.kind)}</dd></div>
      <div><dt>{t('med.check.involved')}</dt><dd>{interaction.ingredients.join(' + ')}</dd></div>
      <div><dt>{t('med.check.medical')}</dt><dd>{interaction.medical}</dd></div>
    </dl>}
    <div className="med-whatdo"><strong>{t('med.detail.whatDo')}</strong><p>{tx(issue.action)}</p></div>
    {issue.medicine_ids.length === 1 && <Link className="med-more" to={`/medicines/${issue.medicine_ids[0]}`}>{t('med.check.open')} <ChevronRight size={15} /></Link>}
    <Escalate kind={issue.escalate} doctorPhone={doctorPhone} medicines={medicines} showRx={issue.type === 'mismatch'} />
    {interaction && <SourceNote source={interaction.source} />}
  </details>;
}
