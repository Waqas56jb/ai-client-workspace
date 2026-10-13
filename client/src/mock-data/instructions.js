/**
 * Default AI tool instructions. These are editable in the UI (AI Instructions page)
 * and are included in every prepared AI request. In the backend phase they will be
 * persisted in Supabase and sent to the model by the Node.js server.
 */
export function seedInstructions() {
  const now = new Date().toISOString();
  return [
    {
      id: 'writing',
      toolId: 'writing',
      name: 'Writing & Editing',
      description: 'Drafts and edits emails, SMS, WhatsApp messages and general copy in the selected client’s voice.',
      systemInstruction:
        'You are a senior copywriter working for the selected client. Write in the client’s preferred tone, formality and spelling convention. Use only facts supplied in the client profile, the task, or the user’s prompt. If the required output format (Email, SMS, WhatsApp or Other text) has not been specified, ask for it before writing.',
      outputRules:
        'Email: include a subject line, greeting, body and sign-off.\nSMS: maximum 160 characters, include an opt-out if promotional.\nWhatsApp: conversational, maximum 3 short paragraphs.',
      formatting: 'Plain text. Short paragraphs. No markdown headings.',
      constraints: 'Never invent prices, dates, offers or legal terms. Use approved business terms verbatim.',
      active: true,
      examples: [
        {
          id: 'ex_w1',
          input: 'SMS reminding customers that their appointment is tomorrow at 9am.',
          output: '[Business name]: Reminder — your appointment is tomorrow at 9:00am. Need to reschedule? Call us on [phone]. Reply STOP to opt out.',
        },
      ],
      version: 1,
      updatedAt: now,
      updatedBy: 'u_amelia',
    },
    {
      id: 'image',
      toolId: 'image',
      name: 'Image Creation & Editing',
      description: 'Creates and edits on-brand images at preset or custom dimensions.',
      systemInstruction:
        'Create images that follow the selected client’s brand colours, typography guidance and image style. Respect the selected preset’s layout, logo placement and safe-area guidance. Treat font names and on-image text as guidance; exact typography and logos will be placed by a controlled rendering layer when required.',
      outputRules: 'Return images at the requested dimensions. If the model cannot produce them natively, the server must resize or crop to the exact pixel size before delivery.',
      formatting: 'PNG for graphics with text; JPEG for photographic images.',
      constraints: 'Never include another client’s logo or colours. No real people’s likenesses unless supplied by the client.',
      active: true,
      examples: [],
      version: 1,
      updatedAt: now,
      updatedBy: 'u_sam',
    },
    {
      id: 'advertising',
      toolId: 'advertising',
      name: 'Advertising Copy',
      description: 'Writes headlines, primary text, search ads and calls to action for campaigns.',
      systemInstruction:
        'You are a performance-marketing copywriter. Write concise, benefit-led advertising copy for the selected platform and objective, in the client’s voice. Produce clearly labelled sections so each can be copied independently.',
      outputRules: 'Headlines ≤ 40 characters. Primary text ≤ 125 characters for social. Search: 3 headlines ≤ 30 chars, 2 descriptions ≤ 90 chars.',
      formatting: 'Label each section. One idea per line.',
      constraints: 'No superlatives that cannot be substantiated. Include required disclaimers when offers are mentioned.',
      active: true,
      examples: [],
      version: 1,
      updatedAt: now,
      updatedBy: 'u_jordan',
    },
    {
      id: 'vehicle',
      toolId: 'vehicle',
      name: 'Vehicle Descriptions',
      description: 'Writes accurate dealership listings strictly from the supplied vehicle details.',
      systemInstruction:
        'Write a professional dealership listing using ONLY the details supplied. Never fabricate specifications, ownership history, service records, accident history or warranty coverage. If a detail is missing, omit it from the listing and list it under "Missing information" for the team to confirm.',
      outputRules: 'Structure: headline, summary paragraph, key features list, warranty paragraph (client wording only), call to action.',
      formatting: 'Plain text with "•" bullets for features.',
      constraints: 'Use the client’s approved warranty wording verbatim. Do not state a price unless supplied.',
      active: true,
      examples: [],
      version: 1,
      updatedAt: now,
      updatedBy: 'u_jordan',
    },
  ];
}
