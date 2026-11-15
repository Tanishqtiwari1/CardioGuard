// Emergency contacts shown on the Emergency screen.
//
// Medulance: details copied from its official website on the date below. Medulance publishes no
// public API, so CardioGuard cannot book or confirm an ambulance. `integration` stays null until
// an official partner integration exists; the screen then offers only "call" and "open Medulance".
export const MEDULANCE = {
  name: 'Medulance',
  phone: '+918882978888',
  phoneDisplay: '+91 88829 78888',
  bookingUrl: 'https://medulance.com/booknow',
  source: 'https://medulance.com/',
  verifiedOn: '2026-11-10',
  integration: null,
};

// India's national numbers: 112 is the single emergency number, 108 the public ambulance service.
export const NATIONAL = { emergency: '112', ambulance: '108' };
