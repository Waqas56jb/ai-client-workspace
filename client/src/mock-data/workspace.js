import { ago } from './helpers';

/**
 * Builds conversations, messages, outputs, versions, files and activity for the
 * demo. Everything is cross-linked: output → task → job → client.
 */
export function seedWorkspaceContent({ clients, tasks }) {
  const taskById = Object.fromEntries(tasks.map((t) => [t.id, t]));
  const clientById = Object.fromEntries(clients.map((c) => [c.id, c]));

  const conversations = [];
  const messages = [];
  const outputs = [];
  const versions = [];
  const files = [];
  const activity = [];

  let seq = 0;
  const nextId = (prefix) => {
    seq += 1;
    return `${prefix}_seed${seq.toString().padStart(3, '0')}`;
  };

  function conv(taskId, title, tool, createdAt, createdBy) {
    const c = { id: nextId('cv'), taskId, title, tool, createdAt, updatedAt: createdAt, createdBy };
    conversations.push(c);
    return c;
  }

  function msg(conversation, role, content, createdAt, extra = {}) {
    const m = {
      id: nextId('m'),
      conversationId: conversation.id,
      taskId: conversation.taskId,
      role,
      content,
      createdAt,
      userId: role === 'user' ? extra.userId : null,
      tool: conversation.tool,
      status: extra.status || 'complete',
      outputIds: extra.outputIds || [],
      options: extra.options || null,
      resolved: extra.status === 'clarify' ? true : undefined,
      requestMeta: extra.requestMeta || null,
    };
    messages.push(m);
    conversation.updatedAt = createdAt;
    return m;
  }

  function brandRender(clientId, headline, subline, cta, seed) {
    const b = clientById[clientId].brand;
    return {
      headline,
      subline,
      cta,
      brandName: clientById[clientId].name,
      primary: b.primaryColor,
      secondary: b.secondaryColor,
      accent: b.accentColor,
      font: b.headingFont || b.fontFamily,
      seed,
    };
  }

  /**
   * versionsSpec: [{ content|sections|image, note, by, at, approved?: { by, at } }]
   */
  function output({ taskId, conversation, tool, kind, title, format = null, versionsSpec }) {
    const task = taskById[taskId];
    const o = {
      id: nextId('out'),
      taskId,
      jobId: task.jobId,
      clientId: task.clientId,
      conversationId: conversation?.id || null,
      tool,
      kind,
      title,
      format,
      currentVersionId: null,
      approvedVersionId: null,
      fileId: null,
      createdAt: versionsSpec[0].at,
      updatedAt: versionsSpec[versionsSpec.length - 1].at,
      createdBy: versionsSpec[0].by,
    };
    let prev = null;
    versionsSpec.forEach((spec, i) => {
      const v = {
        id: nextId('ver'),
        outputId: o.id,
        versionNumber: i + 1,
        kind,
        content: spec.content || '',
        sections: spec.sections || null,
        image: spec.image || null,
        missing: spec.missing || null,
        note: spec.note || (i === 0 ? 'Initial generation' : 'Revision'),
        status: spec.approved ? 'approved' : 'draft',
        approvedAt: spec.approved?.at || null,
        approvedBy: spec.approved?.by || null,
        sourceVersionId: prev?.id || null,
        createdAt: spec.at,
        createdBy: spec.by,
      };
      versions.push(v);
      if (spec.approved) {
        o.approvedVersionId = v.id;
        activity.push({
          id: nextId('act'),
          type: 'output_approved',
          userId: spec.approved.by,
          resourceType: 'output',
          resourceId: o.id,
          clientId: o.clientId,
          jobId: o.jobId,
          taskId,
          description: `Approved v${v.versionNumber} of “${title}”`,
          createdAt: spec.approved.at,
        });
      }
      if (i > 0) {
        activity.push({
          id: nextId('act'),
          type: 'output_revised',
          userId: spec.by,
          resourceType: 'output',
          resourceId: o.id,
          clientId: o.clientId,
          jobId: o.jobId,
          taskId,
          description: `Created v${v.versionNumber} of “${title}” — ${v.note}`,
          createdAt: spec.at,
        });
      }
      prev = v;
    });
    o.currentVersionId = prev.id;
    outputs.push(o);

    const current = prev;
    const isImage = kind === 'image';
    const fileText = current.sections ? current.sections.map((s) => `${s.label}\n${s.text}`).join('\n\n') : current.content;
    const f = {
      id: nextId('f'),
      name: isImage ? `${title}.png` : `${title}.txt`,
      kind: isImage ? 'image' : 'text',
      mimeType: isImage ? 'image/png' : 'text/plain',
      size: isImage ? Math.round((current.image.requestedWidth * current.image.requestedHeight) / 6) : new Blob([fileText]).size,
      clientId: o.clientId,
      jobId: o.jobId,
      taskId,
      outputId: o.id,
      category: 'output',
      storage: 'generated',
      url: null,
      description: isImage ? 'Demo image output (rendered placeholder)' : `${tool} output`,
      createdAt: o.createdAt,
      updatedAt: o.updatedAt,
      createdBy: o.createdBy,
    };
    files.push(f);
    o.fileId = f.id;
    return o;
  }

  function ref(fileSpec) {
    const f = {
      id: nextId('f'),
      category: 'reference',
      storage: fileSpec.url ? 'bundled' : 'record-only',
      jobId: null,
      taskId: null,
      outputId: null,
      description: '',
      ...fileSpec,
      updatedAt: fileSpec.createdAt,
    };
    files.push(f);
    activity.push({
      id: nextId('act'),
      type: 'file_uploaded',
      userId: f.createdBy,
      resourceType: 'file',
      resourceId: f.id,
      clientId: f.clientId,
      jobId: f.jobId,
      taskId: f.taskId,
      description: `Uploaded reference file “${f.name}”`,
      createdAt: f.createdAt,
    });
    return f;
  }

  const aiMeta = (tool, extra = {}) => ({ simulated: true, tool, instructionVersion: 1, ...extra });

  // ── MOWSC · Cup 2026 · Advertising Images ─────────────────────────────
  {
    const c1 = conv('t_cup_images', 'Hero poster & square set', 'image', ago(6, 3), 'u_sam');
    msg(c1, 'user', 'Create a portrait poster for the MOWSC Cup 2026 — sunlit water, headline “Cup Day is coming”, dates 14–15 March, CTA “Register now”. Bayline Marine sponsor bottom-right.', ago(6, 3), { userId: 'u_sam' });
    const poster = output({
      taskId: 't_cup_images',
      conversation: c1,
      tool: 'image',
      kind: 'image',
      title: 'Cup 2026 portrait poster',
      versionsSpec: [
        {
          image: { render: brandRender('c_mowsc', 'Cup Day is coming', '14–15 March 2026 · Port Ohlsen', 'Register now', 'cup-poster-1'), requestedWidth: 1080, requestedHeight: 1350, presetId: 'pr_mowsc_poster', prompt: 'Portrait poster, sunlit water, headline “Cup Day is coming”' },
          by: 'u_sam',
          at: ago(6, 3),
          approved: { by: 'u_amelia', at: ago(5, 1) },
        },
        {
          image: { render: brandRender('c_mowsc', 'MOWSC Cup 2026', 'Two days on the water · 14–15 March', 'Register now', 'cup-poster-2'), requestedWidth: 1080, requestedHeight: 1350, presetId: 'pr_mowsc_poster', prompt: 'Revise: lead with the full event name, keep dates.' },
          note: 'Committee asked to lead with the full event name',
          by: 'u_sam',
          at: ago(0, 1, 20),
        },
      ],
    });
    msg(c1, 'assistant', 'Here is a portrait poster draft at 1080 × 1350 using the MOWSC Cup portrait preset, navy-to-aqua palette and sun-yellow CTA.', ago(6, 3), { outputIds: [poster.id], requestMeta: aiMeta('image', { presetId: 'pr_mowsc_poster' }) });
    msg(c1, 'user', 'Committee feedback: lead with the full event name “MOWSC Cup 2026”. Keep the dates.', ago(0, 1, 22), { userId: 'u_sam' });
    msg(c1, 'assistant', 'Revision created as a new draft (v2). The approved v1 remains available in Approved Work until v2 is approved.', ago(0, 1, 20), { outputIds: [poster.id], requestMeta: aiMeta('image', { presetId: 'pr_mowsc_poster' }) });

    const square = output({
      taskId: 't_cup_images',
      conversation: c1,
      tool: 'image',
      kind: 'image',
      title: 'Cup 2026 square social post',
      versionsSpec: [
        {
          image: { render: brandRender('c_mowsc', 'Join the club family on Cup Day', 'All ages · All crafts', 'Enter today', 'cup-square-1'), requestedWidth: 1080, requestedHeight: 1080, presetId: 'pr_square', prompt: 'Square feed post, community focus.' },
          by: 'u_sam',
          at: ago(4, 6),
        },
      ],
    });
    msg(c1, 'user', 'Now a square version focused on community and all ages.', ago(4, 6, 2), { userId: 'u_sam' });
    msg(c1, 'assistant', 'Square 1080 × 1080 draft created with the community message.', ago(4, 6), { outputIds: [square.id], requestMeta: aiMeta('image', { presetId: 'pr_square' }) });

    const c2 = conv('t_cup_images', 'Story variant', 'image', ago(2, 4), 'u_amelia');
    const story = output({
      taskId: 't_cup_images',
      conversation: c2,
      tool: 'image',
      kind: 'image',
      title: 'Cup 2026 story',
      versionsSpec: [
        {
          image: { render: brandRender('c_mowsc', 'Swipe up for Cup Day', 'MOWSC Cup 2026', 'Get your entry in', 'cup-story-1'), requestedWidth: 1080, requestedHeight: 1920, presetId: 'pr_story', prompt: 'Story format, swipe CTA.' },
          by: 'u_amelia',
          at: ago(2, 4),
        },
      ],
    });
    msg(c2, 'user', 'Story-format version for Instagram, keep the top 250px clear.', ago(2, 4, 1), { userId: 'u_amelia' });
    msg(c2, 'assistant', 'Story draft (1080 × 1920) created using the Story preset safe-area guidance.', ago(2, 4), { outputIds: [story.id], requestMeta: aiMeta('image', { presetId: 'pr_story' }) });
  }

  // ── MOWSC · Cup 2026 · Ad Copy ─────────────────────────────────────────
  {
    const c = conv('t_cup_adcopy', 'Registration ads', 'advertising', ago(8, 2), 'u_jordan');
    msg(c, 'user', 'Facebook & Instagram ads driving Cup 2026 registrations. Audience: local families and club members. Tone energetic.', ago(8, 2), { userId: 'u_jordan' });
    const ad = output({
      taskId: 't_cup_adcopy',
      conversation: c,
      tool: 'advertising',
      kind: 'text',
      title: 'Cup 2026 registration ads',
      versionsSpec: [
        {
          sections: [
            { id: 's1', label: 'Headline', text: 'MOWSC Cup 2026 — entries open' },
            { id: 's2', label: 'Primary text', text: 'Two days on the water for the whole club family. Racing, juniors and Cup Day celebrations, 14–15 March.' },
            { id: 's3', label: 'Call to action', text: 'Register now' },
          ],
          by: 'u_jordan',
          at: ago(8, 2),
        },
        {
          sections: [
            { id: 's1', label: 'Headline', text: 'Cup Day is coming — are you in?' },
            { id: 's2', label: 'Primary text', text: 'MOWSC Cup 2026 brings the whole community on the water, 14–15 March. All ages, all crafts — early entries close 1 Feb.' },
            { id: 's3', label: 'Short description', text: 'Port Ohlsen’s favourite regatta returns.' },
            { id: 's4', label: 'Call to action', text: 'Enter today' },
            { id: 's5', label: 'Disclaimer', text: 'All on-water activities are subject to weather conditions and the Race Officer’s safety decision.' },
          ],
          note: 'Added early-entry deadline and weather disclaimer',
          by: 'u_jordan',
          at: ago(3, 5),
          approved: { by: 'u_amelia', at: ago(3, 2) },
        },
      ],
    });
    msg(c, 'assistant', 'Generated registration ad copy in three sections.', ago(8, 2), { outputIds: [ad.id], requestMeta: aiMeta('advertising') });
    msg(c, 'user', 'Add the early-entry deadline (1 Feb) and the weather disclaimer.', ago(3, 5, 2), { userId: 'u_jordan' });
    msg(c, 'assistant', 'Revised copy saved as v2 with the deadline and the client’s standard weather disclaimer.', ago(3, 5), { outputIds: [ad.id], requestMeta: aiMeta('advertising') });
  }

  // ── MOWSC · Cup 2026 · Emails ──────────────────────────────────────────
  {
    const c = conv('t_cup_emails', 'Member announcement', 'writing', ago(7, 1), 'u_jordan');
    msg(c, 'user', 'Write the announcement to members that Cup 2026 entries are open.', ago(7, 1, 3), { userId: 'u_jordan' });
    msg(c, 'assistant', 'Which format do you need for this piece?', ago(7, 1, 2), {
      status: 'clarify',
      options: [
        { id: 'email', label: 'Email' },
        { id: 'sms', label: 'SMS' },
        { id: 'whatsapp', label: 'WhatsApp' },
        { id: 'other', label: 'Other text' },
      ],
      requestMeta: aiMeta('writing'),
    });
    msg(c, 'user', 'Email', ago(7, 1, 1), { userId: 'u_jordan' });
    const email = output({
      taskId: 't_cup_emails',
      conversation: c,
      tool: 'writing',
      kind: 'text',
      title: 'Cup 2026 entries-open email',
      format: 'email',
      versionsSpec: [
        {
          content:
            'Subject: MOWSC Cup 2026 — entries are open\n\nHi club family,\n\nThe MOWSC Cup is back on 14–15 March 2026, and entries are now open. Whether you are racing, volunteering or cheering from the deck, Cup Day is the highlight of our year on the water.\n\nSafety briefing: 8:00am each morning at the clubhouse deck.\n\nEnter at mowsc.org before 1 February to lock in the early-entry rate.\n\nSee you on the water,\nThe MOWSC Events Team\n\nAll on-water activities are subject to weather conditions and the Race Officer’s safety decision.',
          by: 'u_jordan',
          at: ago(7, 1),
          approved: { by: 'u_amelia', at: ago(6, 2) },
        },
        {
          content:
            'Subject: MOWSC Cup 2026 — entries are open (Bayline Marine)\n\nHi club family,\n\nThe MOWSC Cup, proudly supported by Bayline Marine, is back on 14–15 March 2026 — and entries are now open. Whether you are racing, volunteering or cheering from the deck, Cup Day is the highlight of our year on the water.\n\nSafety briefing: 8:00am each morning at the clubhouse deck.\n\nEnter at mowsc.org before 1 February to lock in the early-entry rate.\n\nSee you on the water,\nThe MOWSC Events Team\n\nAll on-water activities are subject to weather conditions and the Race Officer’s safety decision.',
          note: 'Added sponsor mention requested by the committee',
          by: 'u_jordan',
          at: ago(0, 2, 40),
        },
      ],
    });
    msg(c, 'assistant', 'Here is the entries-open email in MOWSC’s energetic, community-first voice (Australian English).', ago(7, 1), { outputIds: [email.id], requestMeta: aiMeta('writing', { format: 'email' }) });
    msg(c, 'user', 'Committee wants Bayline Marine mentioned in the opening line.', ago(0, 2, 42), { userId: 'u_jordan' });
    msg(c, 'assistant', 'Created v2 as a draft revision with the sponsor mention. The approved v1 is unchanged.', ago(0, 2, 40), { outputIds: [email.id], requestMeta: aiMeta('writing', { format: 'email' }) });

    const c2 = conv('t_cup_emails', 'Reminder emails', 'writing', ago(1, 5), 'u_jordan');
    msg(c2, 'user', 'Draft a one-week-to-go reminder email.', ago(1, 5), { userId: 'u_jordan' });
    const reminder = output({
      taskId: 't_cup_emails',
      conversation: c2,
      tool: 'writing',
      kind: 'text',
      title: 'Cup 2026 one-week reminder',
      format: 'email',
      versionsSpec: [
        {
          content:
            'Subject: One week until Cup Day\n\nHi club family,\n\nSeven sleeps until MOWSC Cup 2026. Final entries close this Friday.\n\n• Safety briefing: 8:00am at the clubhouse deck\n• Juniors racing from 9:30am\n• Presentations and BBQ from 4:00pm\n\nSee you on the water,\nThe MOWSC Events Team',
          by: 'u_jordan',
          at: ago(1, 5),
        },
      ],
    });
    msg(c2, 'assistant', 'Draft reminder email ready for review.', ago(1, 5), { outputIds: [reminder.id], requestMeta: aiMeta('writing', { format: 'email' }) });
  }

  // ── Harbourside · Vehicle listings ─────────────────────────────────────
  {
    const c = conv('t_hs_rav4', 'Listing draft', 'vehicle', ago(4, 2), 'u_jordan');
    msg(c, 'user', '2021 Toyota RAV4 GXL, 2.5L petrol, auto, 48,200 km, Glacier White, one owner, full Toyota service history.', ago(4, 2), { userId: 'u_jordan' });
    const rav = output({
      taskId: 't_hs_rav4',
      conversation: c,
      tool: 'vehicle',
      kind: 'text',
      title: '2021 Toyota RAV4 GXL listing',
      versionsSpec: [
        {
          content:
            '2021 Toyota RAV4 GXL — One Owner, Full Toyota Service History\n\nThis quality-checked 2021 RAV4 GXL in Glacier White has covered 48,200 km with one owner and a full Toyota service history.\n\nKey features\n• 2.5L petrol engine\n• Automatic transmission\n• GXL specification\n\nEvery eligible used vehicle includes Harbourside Assure: a 12-month / 20,000 km mechanical warranty (whichever comes first). Terms and exclusions apply — ask our team for details.\n\nBook a test drive with our family-owned team today.',
          by: 'u_jordan',
          at: ago(4, 2),
          approved: { by: 'u_jordan', at: ago(3) },
        },
      ],
    });
    msg(c, 'assistant', 'Listing generated from supplied details only.', ago(4, 2), { outputIds: [rav.id], requestMeta: aiMeta('vehicle') });

    const c2 = conv('t_hs_cx5', 'Listing draft', 'vehicle', ago(0, 5), 'u_jordan');
    msg(c2, 'user', '2019 Mazda CX-5 Touring, 2.5 petrol AWD auto, 71,900 km, Soul Red Crystal. Service history to be confirmed.', ago(0, 5, 1), { userId: 'u_jordan' });
    const cx5 = output({
      taskId: 't_hs_cx5',
      conversation: c2,
      tool: 'vehicle',
      kind: 'text',
      title: '2019 Mazda CX-5 Touring listing',
      versionsSpec: [
        {
          content:
            '2019 Mazda CX-5 Touring AWD — Soul Red Crystal\n\nA quality-checked 2019 CX-5 Touring with all-wheel drive, finished in Soul Red Crystal and showing 71,900 km.\n\nKey features\n• 2.5L petrol engine\n• Automatic transmission\n• All-wheel drive\n\nEvery eligible used vehicle includes Harbourside Assure: a 12-month / 20,000 km mechanical warranty (whichever comes first). Terms and exclusions apply — ask our team for details.\n\nVisit Harbourside Motors to arrange your test drive.',
          missing: ['Service history', 'Ownership history', 'Registration / stock reference'],
          by: 'u_jordan',
          at: ago(0, 5),
        },
      ],
    });
    msg(c2, 'assistant', 'Listing drafted. Service and ownership history were not supplied, so they are omitted and flagged as missing information.', ago(0, 5), { outputIds: [cx5.id], requestMeta: aiMeta('vehicle') });
  }

  // ── Harbourside · Clearance ads & banner ──────────────────────────────
  {
    const c = conv('t_hs_fbads', 'Clearance variants', 'advertising', ago(1, 3), 'u_jordan');
    msg(c, 'user', 'Three Facebook ad variants for the spring clearance, lead with Harbourside Assure.', ago(1, 3), { userId: 'u_jordan' });
    const ads = output({
      taskId: 't_hs_fbads',
      conversation: c,
      tool: 'advertising',
      kind: 'text',
      title: 'Spring clearance Facebook ads',
      versionsSpec: [
        {
          sections: [
            { id: 's1', label: 'Variant A — Headline', text: 'Spring into a quality-checked SUV' },
            { id: 's2', label: 'Variant A — Primary text', text: 'Every eligible vehicle comes with Harbourside Assure for real peace of mind.' },
            { id: 's3', label: 'Variant B — Headline', text: 'Family-owned. Quality-checked.' },
            { id: 's4', label: 'Variant B — Primary text', text: 'Our spring clearance is on now — drive away in a family car you can trust.' },
            { id: 's5', label: 'Variant C — Headline', text: 'Utes, SUVs & family cars' },
            { id: 's6', label: 'Call to action', text: 'Browse stock' },
            { id: 's7', label: 'Disclaimer', text: 'Vehicle subject to prior sale. Finance subject to approval.' },
          ],
          by: 'u_jordan',
          at: ago(1, 3),
        },
      ],
    });
    msg(c, 'assistant', 'Three variants generated with the client’s required disclaimer.', ago(1, 3), { outputIds: [ads.id], requestMeta: aiMeta('advertising') });

    const c2 = conv('t_hs_banner', 'Hero banner', 'image', ago(1, 6), 'u_sam');
    msg(c2, 'user', 'Wide homepage banner for the spring clearance, slate background, crimson accent bar.', ago(1, 6), { userId: 'u_sam' });
    const banner = output({
      taskId: 't_hs_banner',
      conversation: c2,
      tool: 'image',
      kind: 'image',
      title: 'Spring clearance hero banner',
      versionsSpec: [
        {
          image: { render: brandRender('c_harbourside', 'Spring Stock Clearance', 'Quality-checked SUVs, utes & family cars', 'Browse stock', 'hs-banner-1'), requestedWidth: 1920, requestedHeight: 600, presetId: 'pr_banner', prompt: 'Wide banner, slate, crimson accent.' },
          by: 'u_sam',
          at: ago(1, 6),
        },
      ],
    });
    msg(c2, 'assistant', 'Wide banner draft created at 1920 × 600.', ago(1, 6), { outputIds: [banner.id], requestMeta: aiMeta('image', { presetId: 'pr_banner' }) });
  }

  // ── Kingsway ───────────────────────────────────────────────────────────
  {
    const c = conv('t_kw_email', 'Launch invitation', 'writing', ago(6), 'u_amelia');
    msg(c, 'user', 'Email invitation for the EV showroom launch event, Saturday 8 November.', ago(6), { userId: 'u_amelia' });
    const inv = output({
      taskId: 't_kw_email',
      conversation: c,
      tool: 'writing',
      kind: 'text',
      title: 'EV showroom launch invitation',
      format: 'email',
      versionsSpec: [
        {
          content:
            'Subject: You’re invited — Kingsway EV Showroom launch\n\nHello,\n\nWe are opening the doors to our new EV showroom and would love you to join us on Saturday 8 November.\n\nExplore the latest electric models, book a test drive, and talk to our team about home charging with transparent pricing and Kingsway Care.\n\nRSVP at kingswayauto.com.au/ev-launch\n\nKind regards,\nThe Kingsway Auto Group team',
          by: 'u_amelia',
          at: ago(6),
          approved: { by: 'u_jordan', at: ago(4) },
        },
      ],
    });
    msg(c, 'assistant', 'Invitation drafted in Kingsway’s premium voice.', ago(6), { outputIds: [inv.id], requestMeta: aiMeta('writing', { format: 'email' }) });

    const c2 = conv('t_kw_ads', 'Launch ads', 'advertising', ago(0, 6), 'u_jordan');
    msg(c2, 'user', 'Search ads for the EV showroom launch. Objective: event attendance.', ago(0, 6), { userId: 'u_jordan' });
    const kads = output({
      taskId: 't_kw_ads',
      conversation: c2,
      tool: 'advertising',
      kind: 'text',
      title: 'EV launch search ads',
      versionsSpec: [
        {
          sections: [
            { id: 's1', label: 'Headline 1', text: 'Kingsway EV Showroom' },
            { id: 's2', label: 'Headline 2', text: 'Launch Day — Sat 8 Nov' },
            { id: 's3', label: 'Headline 3', text: 'Book an EV Test Drive' },
            { id: 's4', label: 'Description 1', text: 'Explore the latest EVs in Parramatta with transparent pricing and Kingsway Care.' },
            { id: 's5', label: 'Description 2', text: 'Join our launch event and talk home charging with our team. RSVP online.' },
          ],
          by: 'u_jordan',
          at: ago(0, 6),
        },
      ],
    });
    msg(c2, 'assistant', 'Search ad set generated within character limits.', ago(0, 6), { outputIds: [kads.id], requestMeta: aiMeta('advertising') });

    const c3 = conv('t_kw_visuals', 'Showroom visuals', 'image', ago(1), 'u_sam');
    msg(c3, 'user', 'Landscape social image announcing the EV showroom.', ago(1), { userId: 'u_sam' });
    const kv = output({
      taskId: 't_kw_visuals',
      conversation: c3,
      tool: 'image',
      kind: 'image',
      title: 'EV showroom announcement',
      versionsSpec: [
        {
          image: { render: brandRender('c_kingsway', 'Electrify your drive', 'New EV showroom · Parramatta', 'Book a test drive', 'kw-ev-1'), requestedWidth: 1200, requestedHeight: 628, presetId: 'pr_landscape', prompt: 'Landscape EV announcement.' },
          by: 'u_sam',
          at: ago(1),
        },
      ],
    });
    msg(c3, 'assistant', 'Landscape draft created at 1200 × 628.', ago(1), { outputIds: [kv.id], requestMeta: aiMeta('image', { presetId: 'pr_landscape' }) });

    const c4 = conv('t_kw_model3', 'Listing', 'vehicle', ago(6, 2), 'u_jordan');
    msg(c4, 'user', '2023 Tesla Model 3 RWD, single motor, 18,400 km, Pearl White, one owner, Tesla service records, 513 km WLTP range.', ago(6, 2), { userId: 'u_jordan' });
    const m3 = output({
      taskId: 't_kw_model3',
      conversation: c4,
      tool: 'vehicle',
      kind: 'text',
      title: '2023 Tesla Model 3 RWD listing',
      versionsSpec: [
        {
          content:
            '2023 Tesla Model 3 RWD — One Owner, 18,400 km\n\nThis certified-used 2023 Model 3 Rear-Wheel Drive in Pearl White has one owner and Tesla service records.\n\nKey features\n• Single-motor rear-wheel drive\n• 513 km range (manufacturer WLTP estimate)\n• Electric drivetrain\n\nKingsway Care: all used vehicles include a 3-month / 5,000 km statutory-plus warranty.\n\nRange figures are manufacturer WLTP estimates; real-world range varies with conditions and driving style.\n\nBook your test drive at Kingsway Auto Group.',
          by: 'u_jordan',
          at: ago(6, 2),
          approved: { by: 'u_amelia', at: ago(5) },
        },
      ],
    });
    msg(c4, 'assistant', 'Listing generated with the client’s WLTP disclaimer.', ago(6, 2), { outputIds: [m3.id], requestMeta: aiMeta('vehicle') });
  }

  // ── Bloom & Basil ──────────────────────────────────────────────────────
  {
    const c = conv('t_bb_menu', 'Winter menu', 'writing', ago(9), 'u_jordan');
    msg(c, 'user', 'Short menu descriptions for three winter dishes. Format: other text.', ago(9), { userId: 'u_jordan' });
    const menu = output({
      taskId: 't_bb_menu',
      conversation: c,
      tool: 'writing',
      kind: 'text',
      title: 'Winter menu descriptions',
      format: 'other',
      versionsSpec: [
        {
          content:
            'Slow-roasted pumpkin, whipped feta, toasted seeds, local honey\n\nBraised lamb shoulder with soft polenta and gremolata\n\nPoached pear, spiced ricotta and pistachio crumble',
          by: 'u_jordan',
          at: ago(9),
        },
        {
          content:
            'Slow-roasted pumpkin, whipped feta, toasted seeds and honey from Merri Creek Apiary\n\nBraised lamb shoulder from Kinross Farm, soft polenta, gremolata\n\nPoached pear, spiced ricotta, pistachio crumble — made to share',
          note: 'Named the growers per brand guidelines',
          by: 'u_jordan',
          at: ago(8, 3),
          approved: { by: 'u_sam', at: ago(7) },
        },
      ],
    });
    msg(c, 'assistant', 'Menu descriptions drafted in a warm, seasonal voice.', ago(9), { outputIds: [menu.id], requestMeta: aiMeta('writing', { format: 'other' }) });

    const c2 = conv('t_bb_insta', 'Instagram set', 'image', ago(10), 'u_sam');
    const insta = output({
      taskId: 't_bb_insta',
      conversation: c2,
      tool: 'image',
      kind: 'image',
      title: 'Winter menu Instagram post',
      versionsSpec: [
        {
          image: { render: brandRender('c_bloom', 'Winter, slowly', 'Our seasonal menu from 1 June', 'See the menu', 'bb-insta-1'), requestedWidth: 1080, requestedHeight: 1080, presetId: 'pr_square', prompt: 'Square post, earthy palette.' },
          by: 'u_sam',
          at: ago(10),
          approved: { by: 'u_amelia', at: ago(7, 4) },
        },
      ],
    });
    msg(c2, 'user', 'Square Instagram post for the winter menu, earthy and calm.', ago(10, 0, 1), { userId: 'u_sam' });
    msg(c2, 'assistant', 'Square post created.', ago(10), { outputIds: [insta.id], requestMeta: aiMeta('image', { presetId: 'pr_square' }) });

    const c3 = conv('t_bb_sms', 'Loyalty SMS', 'writing', ago(9, 6), 'u_amelia');
    msg(c3, 'user', 'SMS to loyalty members about the winter menu.', ago(9, 6), { userId: 'u_amelia' });
    const sms = output({
      taskId: 't_bb_sms',
      conversation: c3,
      tool: 'writing',
      kind: 'text',
      title: 'Winter menu loyalty SMS',
      format: 'sms',
      versionsSpec: [
        {
          content: 'Bloom & Basil: our winter menu lands 1 June — slow-roasted, locally grown and made to share. See you soon. Reply STOP to opt out',
          by: 'u_amelia',
          at: ago(9, 6),
          approved: { by: 'u_amelia', at: ago(8) },
        },
      ],
    });
    msg(c3, 'assistant', 'SMS drafted (under 160 characters).', ago(9, 6), { outputIds: [sms.id], requestMeta: aiMeta('writing', { format: 'sms' }) });
  }

  // ── Northline ──────────────────────────────────────────────────────────
  {
    const c = conv('t_nl_emails', 'Email 1 — we miss you', 'writing', ago(5), 'u_jordan');
    msg(c, 'user', 'First reactivation email for patients who have not visited in 6 months. Format: email.', ago(5), { userId: 'u_jordan' });
    const nl = output({
      taskId: 't_nl_emails',
      conversation: c,
      tool: 'writing',
      kind: 'text',
      title: 'Reactivation email 1',
      format: 'email',
      versionsSpec: [
        {
          content:
            'Subject: Time for a check-in?\n\nHi [First name],\n\nIt has been a while since your last visit to Northline Physio. If you are keen to keep moving better, our team can build a tailored plan around your goals.\n\nBook online at northlinephysio.com.au or call 02 9555 8800.\n\nWarm regards,\nThe Northline Physio team\n\nIndividual results vary. Consult your practitioner.',
          by: 'u_jordan',
          at: ago(5),
        },
        {
          content:
            'Subject: A quick check-in from Northline Physio\n\nHi [First name],\n\nIt has been a little while since we last saw you. Whether you are returning to sport or just want to move better day to day, our physios can put together an evidence-based plan tailored to you.\n\nBook online at northlinephysio.com.au or call 02 9555 8800.\n\nWarm regards,\nThe Northline Physio team\n\nIndividual results vary. Consult your practitioner.',
          note: 'Softer subject line; added evidence-based wording',
          by: 'u_jordan',
          at: ago(4),
        },
      ],
    });
    msg(c, 'assistant', 'Reactivation email drafted without testimonials or outcome promises.', ago(5), { outputIds: [nl.id], requestMeta: aiMeta('writing', { format: 'email' }) });
  }

  // ── Reference files ────────────────────────────────────────────────────
  ref({ name: 'MOWSC brand guidelines 2026.md', kind: 'document', mimeType: 'text/markdown', size: 1680, clientId: 'c_mowsc', url: '/samples/mowsc-brand-guidelines.md', description: 'Logo usage, colours and tone for 2026.', createdAt: ago(35), createdBy: 'u_amelia' });
  ref({ name: 'mowsc-logo.svg', kind: 'image', mimeType: 'image/svg+xml', size: 1120, clientId: 'c_mowsc', url: '/samples/mowsc-logo.svg', description: 'Primary club logo (navy).', createdAt: ago(35), createdBy: 'u_amelia' });
  ref({ name: 'bayline-marine-sponsor-logo.svg', kind: 'image', mimeType: 'image/svg+xml', size: 980, clientId: 'c_mowsc', jobId: 'j_cup2026', url: '/samples/bayline-sponsor-logo.svg', description: 'Sponsor lock-up — bottom-right on Cup 2026 assets.', createdAt: ago(30), createdBy: 'u_sam' });
  ref({ name: 'cup-2025-start-line-reference.svg', kind: 'image', mimeType: 'image/svg+xml', size: 2400, clientId: 'c_mowsc', jobId: 'j_cup2026', taskId: 't_cup_images', category: 'attachment', url: '/samples/cup-start-line.svg', description: 'Mood reference for the start line composition.', createdAt: ago(6, 4), createdBy: 'u_sam' });
  ref({ name: 'Harbourside Assure warranty terms.txt', kind: 'document', mimeType: 'text/plain', size: 1240, clientId: 'c_harbourside', url: '/samples/harbourside-warranty.txt', description: 'Approved warranty wording and eligibility.', createdAt: ago(60), createdBy: 'u_jordan' });
  ref({ name: 'October stock list.csv', kind: 'document', mimeType: 'text/csv', size: 640, clientId: 'c_harbourside', jobId: 'j_hs_listings', url: '/samples/harbourside-stock.csv', description: 'Weekly stock arrivals.', createdAt: ago(13), createdBy: 'u_jordan' });
  ref({ name: 'EV showroom launch brief.pdf', kind: 'document', mimeType: 'application/pdf', size: 482000, clientId: 'c_kingsway', jobId: 'j_kw_ev', description: 'Client brief (record only — the original PDF was not bundled with the demo).', createdAt: ago(29), createdBy: 'u_amelia' });
  ref({ name: 'Winter menu notes.txt', kind: 'document', mimeType: 'text/plain', size: 520, clientId: 'c_bloom', jobId: 'j_bb_winter', url: '/samples/bloom-winter-menu.txt', description: 'Dish list and grower names from Hannah.', createdAt: ago(42), createdBy: 'u_sam' });

  // ── General activity ───────────────────────────────────────────────────
  const general = [
    ['client_created', 'u_amelia', 'client', 'c_coastal', 'c_coastal', null, null, 'Added new prospect “Coastal Realty Co.”', ago(12)],
    ['job_created', 'u_amelia', 'job', 'j_cr_discovery', 'c_coastal', 'j_cr_discovery', null, 'Created job “Brand Discovery”', ago(10)],
    ['task_created', 'u_amelia', 'task', 't_hs_ranger', 'c_harbourside', 'j_hs_listings', 't_hs_ranger', 'Created task “2022 Ford Ranger XLT”', ago(2)],
    ['brand_updated', 'u_jordan', 'client', 'c_harbourside', 'c_harbourside', null, null, 'Updated the warranty wording for Harbourside Motors', ago(1, 4)],
    ['instructions_updated', 'u_jordan', 'instruction', 'vehicle', null, null, null, 'Updated Vehicle Descriptions instructions', ago(11)],
    ['task_created', 'u_amelia', 'task', 't_cup_sms', 'c_mowsc', 'j_cup2026', 't_cup_sms', 'Created task “Sponsor Thank-you SMS”', ago(6)],
    ['ai_request', 'u_sam', 'task', 't_cup_images', 'c_mowsc', 'j_cup2026', 't_cup_images', 'Generated three advertising images for MOWSC', ago(4, 6)],
    ['ai_request', 'u_jordan', 'task', 't_cup_emails', 'c_mowsc', 'j_cup2026', 't_cup_emails', 'Revised the Cup 2026 email campaign', ago(0, 2, 40)],
  ];
  general.forEach(([type, userId, resourceType, resourceId, clientId, jobId, taskId, description, createdAt]) =>
    activity.push({ id: nextId('act'), type, userId, resourceType, resourceId, clientId, jobId, taskId, description, createdAt }),
  );

  activity.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return { conversations, messages, outputs, versions, files, activity };
}
