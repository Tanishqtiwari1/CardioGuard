const BYDAY = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];
const compact = (value) => value.replace(/[-:]/g, '');

/** An iCalendar file, so reminders can ring from the phone's calendar even when CardioGuard is closed. */
export function buildCalendarFile(reminder, title, now = new Date()) {
  const stamp = `${compact(now.toISOString().slice(0, 19))}Z`;
  const events = reminder.times.map((time, index) => {
    const rule = ['FREQ=DAILY'];
    if (reminder.days_of_week?.length) {
      rule[0] = 'FREQ=WEEKLY';
      rule.push(`BYDAY=${reminder.days_of_week.map((day) => BYDAY[day]).join(',')}`);
    }
    if (reminder.end_date) rule.push(`UNTIL=${compact(reminder.end_date)}T235959`);
    return [
      'BEGIN:VEVENT',
      `UID:cardioguard-reminder-${reminder.id}-${index}@cardioguard`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${compact(reminder.start_date)}T${compact(time)}00`,
      'DURATION:PT5M',
      `RRULE:${rule.join(';')}`,
      `SUMMARY:${title.replace(/[,;\\]/g, ' ')}`,
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      `DESCRIPTION:${title.replace(/[,;\\]/g, ' ')}`,
      'TRIGGER:PT0M',
      'END:VALARM',
      'END:VEVENT',
    ].join('\r\n');
  });
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//CardioGuard//Medicine Reminders//EN', ...events, 'END:VCALENDAR', ''].join('\r\n');
}
