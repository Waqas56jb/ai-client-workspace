import { ago } from './helpers';

export function seedPresets() {
  const p = (id, name, width, height, description, extra = {}) => ({
    id,
    name,
    description,
    width,
    height,
    scope: extra.clientId ? 'client' : 'global',
    clientId: extra.clientId || '',
    background: extra.background || 'Brand primary colour or brand-appropriate photography',
    layout: extra.layout || 'Headline in the upper third, supporting line beneath, call-to-action in the lower third.',
    typography: extra.typography || 'Use the client heading font for headlines and body font for supporting text. Max 8 words per headline.',
    brandColors: extra.brandColors || 'Primary colour for backgrounds, accent colour reserved for the call-to-action.',
    logoPlacement: extra.logoPlacement || 'Top-left, minimum 8% of the shortest side.',
    safeArea: extra.safeArea || 'Keep text and logos 7% inside every edge.',
    isStarter: !extra.clientId,
    isCustom: !!extra.isCustom,
    archived: false,
    createdAt: ago(extra.days ?? 200),
    updatedAt: ago(extra.days ?? 200),
    createdBy: 'u_amelia',
  });

  return [
    p('pr_square', 'Square social image', 1080, 1080, 'Instagram / Facebook feed posts.'),
    p('pr_portrait', 'Portrait social image', 1080, 1350, 'Tall feed posts — more screen space on mobile.'),
    p('pr_story', 'Story format', 1080, 1920, 'Stories and Reels covers.', {
      safeArea: 'Keep text 250px clear of the top and bottom edges for interface overlays.',
    }),
    p('pr_landscape', 'Landscape social image', 1200, 628, 'Link previews and landscape feed posts.'),
    p('pr_banner', 'Wide banner', 1920, 600, 'Website hero and email headers.', {
      layout: 'Text block on the left 45%, imagery on the right.',
    }),
    p('pr_custom', 'Custom dimensions', 1600, 900, 'Starting point for any custom size — adjust width and height.', { isCustom: true }),
    p('pr_mowsc_poster', 'MOWSC Cup portrait poster', 1080, 1350, 'Cup 2026 social poster with sponsor lock-up.', {
      clientId: 'c_mowsc',
      days: 30,
      background: 'Navy (#0B3D91) to aqua gradient, or sun-lit water photography with navy overlay',
      logoPlacement: 'MOWSC logo top-left; Bayline Marine sponsor logo bottom-right.',
      brandColors: 'Navy base, aqua highlights, sun-yellow (#FFC531) CTA only.',
    }),
    p('pr_hs_listing', 'Harbourside listing hero', 1200, 800, 'Hero image for vehicle listing pages.', {
      clientId: 'c_harbourside',
      days: 20,
      background: 'Clean studio or harbour-front dusk backdrop',
      logoPlacement: 'Bottom-left on a slate bar.',
    }),
  ];
}
