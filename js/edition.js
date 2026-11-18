// Which edition of the app this is. The code is the same for every edition;
// this file (with the icons and manifest) is what differs. Each edition keeps
// its data in its own database, so two can sit on one tablet without meeting.
export const EDITION = {
  id: "ross-invoices",
  name: "Ross Invoices",
  db: "ross-invoices",
  laptop: true,            // there's a laptop program to swap files with
  // starting settings for a fresh install (anything not here: the usual defaults)
  settings: {
    heading: "Ross Invoices",
    business: { name: "Jacob Ross" },
  },
};
