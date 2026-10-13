import { ago } from './helpers';

const JOB_CLIENT = {
  j_cup2026: 'c_mowsc',
  j_membership: 'c_mowsc',
  j_hs_clearance: 'c_harbourside',
  j_hs_listings: 'c_harbourside',
  j_kw_ev: 'c_kingsway',
  j_kw_inventory: 'c_kingsway',
  j_bb_winter: 'c_bloom',
  j_nl_reactivation: 'c_northline',
  j_cr_discovery: 'c_coastal',
};

export function seedTasks() {
  const t = (id, jobId, title, type, status, assigneeId, createdDays, updated, description = '', notes = '') => ({
    id,
    jobId,
    clientId: JOB_CLIENT[jobId],
    title,
    type,
    status,
    assigneeId,
    description,
    notes,
    createdBy: assigneeId,
    createdAt: ago(createdDays),
    updatedAt: updated,
  });

  return [
    t('t_cup_images', 'j_cup2026', 'Advertising Images', 'image', 'in_progress', 'u_sam', 30, ago(0, 1, 20), 'Hero and social images for Cup 2026 using the portrait and square presets. Bayline Marine logo bottom-right.'),
    t('t_cup_adcopy', 'j_cup2026', 'Ad Copy', 'advertising', 'review', 'u_jordan', 29, ago(0, 4), 'Facebook/Instagram and Google Search copy driving regatta registrations.'),
    t('t_cup_emails', 'j_cup2026', 'Emails', 'writing', 'in_progress', 'u_jordan', 28, ago(0, 2, 40), 'Member announcement email and two reminder emails.'),
    t('t_cup_sms', 'j_cup2026', 'Sponsor Thank-you SMS', 'writing', 'todo', 'u_amelia', 6, ago(2), 'Short SMS to sponsor contacts after the event.'),
    t('t_mem_graphics', 'j_membership', 'Membership Social Graphics', 'image', 'todo', 'u_sam', 18, ago(5)),
    t('t_mem_whatsapp', 'j_membership', 'Renewal Reminder WhatsApp', 'writing', 'todo', 'u_jordan', 17, ago(6)),
    t('t_hs_fbads', 'j_hs_clearance', 'Clearance Facebook Ads', 'advertising', 'in_progress', 'u_jordan', 22, ago(1, 2), 'Three ad variants for the clearance, focused on Harbourside Assure.'),
    t('t_hs_banner', 'j_hs_clearance', 'Website Hero Banner', 'image', 'review', 'u_sam', 21, ago(1, 6), 'Wide banner for the homepage.'),
    t('t_hs_rav4', 'j_hs_listings', '2021 Toyota RAV4 GXL', 'vehicle', 'done', 'u_jordan', 12, ago(3), 'Stock #HS-2187.'),
    t('t_hs_cx5', 'j_hs_listings', '2019 Mazda CX-5 Touring', 'vehicle', 'review', 'u_jordan', 9, ago(0, 5), 'Stock #HS-2203. Service history to be confirmed.'),
    t('t_hs_ranger', 'j_hs_listings', '2022 Ford Ranger XLT', 'vehicle', 'todo', 'u_amelia', 2, ago(2)),
    t('t_kw_ads', 'j_kw_ev', 'EV Launch Ads', 'advertising', 'in_progress', 'u_jordan', 27, ago(0, 6)),
    t('t_kw_visuals', 'j_kw_ev', 'EV Showroom Visuals', 'image', 'in_progress', 'u_sam', 26, ago(1)),
    t('t_kw_email', 'j_kw_ev', 'Launch Event Invitation Email', 'writing', 'done', 'u_amelia', 24, ago(4)),
    t('t_kw_model3', 'j_kw_inventory', '2023 Tesla Model 3 RWD', 'vehicle', 'done', 'u_jordan', 15, ago(5)),
    t('t_kw_kona', 'j_kw_inventory', '2020 Hyundai Kona Elite', 'vehicle', 'in_progress', 'u_jordan', 8, ago(2)),
    t('t_bb_insta', 'j_bb_winter', 'Winter Menu Instagram Posts', 'image', 'done', 'u_sam', 40, ago(6)),
    t('t_bb_menu', 'j_bb_winter', 'Menu Descriptions', 'writing', 'done', 'u_jordan', 41, ago(7)),
    t('t_bb_sms', 'j_bb_winter', 'Loyalty SMS', 'writing', 'done', 'u_amelia', 39, ago(8)),
    t('t_nl_emails', 'j_nl_reactivation', 'Reactivation Email Sequence', 'writing', 'in_progress', 'u_jordan', 14, ago(4)),
    t('t_nl_policies', 'j_nl_reactivation', 'Clinic Policy Wording Review', 'general', 'todo', 'u_amelia', 10, ago(9), 'Check cancellation-policy wording before it appears in emails.'),
    t('t_cr_voice', 'j_cr_discovery', 'Brand Voice Discovery', 'general', 'todo', 'u_amelia', 9, ago(6)),
  ];
}
