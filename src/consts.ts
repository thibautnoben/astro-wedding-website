// Place any global data in this file.
// You can import this data from anywhere in your site by using the `import` keyword.

export const SITE_TITLE = "Kirsten & Thibaut";
export const SITE_DESCRIPTION = "Wij trouwen op 19 juni 2027 in De Schuur. Wees erbij!";

export const PARTNER_ONE = "Kirsten";
export const PARTNER_TWO = "Thibaut";

export const WEDDING_DATE = new Date("2027-06-19T12:00:00+02:00");
export const WEDDING_DATE_LABEL = "19 juni 2027";
export const WEDDING_VENUE = "De Schuur";
export const WEDDING_CITY_HALL = "Stadhuis Lier";

// Optional street address of the venue, shown in the confirmation e-mail and the
// calendar invite when filled in, e.g. "Voorbeeldstraat 1, 2500 Lier".
export const WEDDING_VENUE_ADDRESS = "Kantonbaan 2, 2520 Oelegem";
// End time used for the calendar invite (.ics) in the confirmation e-mail.
export const WEDDING_END = new Date("2027-06-20T02:00:00+02:00");

export const RSVP_DEADLINE_LABEL = "19 mei 2027";
// After this moment the RSVP form closes (end of the deadline day, Belgian time).
export const RSVP_DEADLINE = new Date("2027-05-19T23:59:59+02:00");
// Maximum number of people (including the person filling in the form) per RSVP.
export const RSVP_MAX_PERSONS = 4;

export const CONTACT_EMAIL = "trouw@noben.net";
// Where a notification is sent for every new or changed RSVP.
export const RSVP_NOTIFY_EMAIL = CONTACT_EMAIL;
