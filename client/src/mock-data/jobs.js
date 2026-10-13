import { ago, ahead } from './helpers';

export function seedJobs() {
  const j = (id, clientId, title, description, status, createdDays, updated, createdBy, deadline = '', notes = '') => ({
    id,
    clientId,
    title,
    description,
    status,
    deadline,
    notes,
    createdAt: ago(createdDays),
    updatedAt: updated,
    createdBy,
  });
  return [
    j('j_cup2026', 'c_mowsc', 'Cup 2026', 'Full promotional campaign for the MOWSC Cup 2026 regatta: social imagery, ad copy and member emails.', 'active', 38, ago(0, 1, 20), 'u_amelia', ahead(40), 'Sponsor: Bayline Marine — logo bottom-right on every asset.'),
    j('j_membership', 'c_mowsc', 'Membership Drive 2027', 'Early-bird membership renewals and new-member acquisition.', 'on_hold', 20, ago(5), 'u_jordan', ahead(90)),
    j('j_hs_clearance', 'c_harbourside', 'Spring Stock Clearance', 'Four-week clearance campaign across Facebook, Instagram and the website hero.', 'active', 25, ago(1, 2), 'u_jordan', ahead(12)),
    j('j_hs_listings', 'c_harbourside', 'Used Vehicle Listings — October', 'Weekly listing descriptions for newly arrived stock.', 'active', 14, ago(0, 5), 'u_jordan'),
    j('j_kw_ev', 'c_kingsway', 'EV Showroom Launch', 'Launch campaign for the new EV showroom, including launch-event invitations.', 'active', 30, ago(0, 6), 'u_amelia', ahead(25)),
    j('j_kw_inventory', 'c_kingsway', 'Weekly Inventory Descriptions', 'Certified-used listings for the Kingsway website and marketplaces.', 'active', 18, ago(2), 'u_jordan'),
    j('j_bb_winter', 'c_bloom', 'Winter Menu Launch', 'Menu descriptions, Instagram posts and loyalty SMS for the winter menu.', 'completed', 45, ago(3), 'u_sam', ahead(-2)),
    j('j_nl_reactivation', 'c_northline', 'Patient Reactivation', 'Email sequence to re-engage patients who have not booked in 6+ months.', 'active', 16, ago(4), 'u_jordan', ahead(18)),
    j('j_cr_discovery', 'c_coastal', 'Brand Discovery', 'Voice and tone discovery workshop outputs.', 'on_hold', 10, ago(6), 'u_amelia'),
  ];
}
