import { all, db, get, insert, run, tx } from './db.js';
import { hashPassword } from './lib/crypto.js';
import { ensureProviderRows } from './providers/service.js';
import { syncOrderCosts } from './lib/costing.js';

function isoDate(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

export function ensureAdmin() {
  const count = get<{ c: number }>('SELECT COUNT(*) AS c FROM users')!.c;
  if (count > 0) return;
  const email = process.env.ADMIN_EMAIL || 'admin@coldpost.in';
  const password = process.env.ADMIN_PASSWORD || 'Coldpost@2026';
  const name = process.env.ADMIN_NAME || 'Founder';
  insert('users', { name, email, password_hash: hashPassword(password), role: 'admin' });
  console.log(`[seed] created admin account ${email}`);
  if (!process.env.ADMIN_PASSWORD) {
    console.warn('[seed] using default password "Coldpost@2026" — change it in Settings → Users after signing in.');
  }
}

export function ensureMessageTemplates() {
  const templates = [
    {
      key: 'order_confirmation',
      name: 'Order confirmation',
      category: 'order',
      body: `Hi {{contact_person}},\n\nThank you for confirming the {{campaign_name}} campaign with Cold Post. We are preparing {{unit_count}} for {{customer_name}}.\n\nOrder reference: {{order_ref}}\nOrder value: ₹{{order_value}}\nExpected dispatch: {{dispatch_date}}\n\nWe will share photographs before dispatch and tracking details as soon as your packages leave the studio.\n\n{{signature}}`,
    },
    {
      key: 'advance_reminder',
      name: 'Advance payment reminder',
      category: 'payment',
      body: `Hi {{contact_person}},\n\nA quick reminder for order {{order_ref}} ({{campaign_name}}).\n\nBalance pending: ₹{{advance_due}} of ₹{{order_value}}.\n\nProcurement for custom items begins once the advance is received, so sharing the payment today helps us hold your dispatch date of {{dispatch_date}}.\n\n{{signature}}`,
    },
    {
      key: 'procurement_update',
      name: 'Procurement update',
      category: 'order',
      body: `Hi {{contact_person}},\n\nUpdate on {{order_ref}}: materials and customisation for your {{campaign_name}} are now in production with our suppliers. Assembly begins as soon as everything is quality-checked at our studio.\n\nTarget dispatch remains {{dispatch_date}}.\n\n{{signature}}`,
    },
    {
      key: 'assembly_update',
      name: 'Assembly update',
      category: 'order',
      body: `Hi {{contact_person}},\n\nYour {{campaign_name}} packages for {{order_ref}} are being assembled and photographed at our studio. Every package goes through an 11-point quality check before it is sealed.\n\nDispatch is planned for {{dispatch_date}}.\n\n{{signature}}`,
    },
    {
      key: 'dispatch_notification',
      name: 'Dispatch notification',
      category: 'shipping',
      body: `Hi {{contact_person}},\n\nGood news — {{order_ref}} has been handed to {{courier}}.\n\nTracking number: {{awb}}\nTrack here: {{tracking_url}}\nDispatch date: {{dispatch_date}}\n\nDelivery address: {{delivery_address}}\n\n{{signature}}`,
    },
    {
      key: 'tracking_notification',
      name: 'Tracking notification',
      category: 'shipping',
      body: `Hi {{contact_person}},\n\nYour Cold Post package for {{order_ref}} is on the way with {{courier}}.\n\nAWB: {{awb}}\nLive tracking: {{tracking_url}}\n\nWe will confirm once it is delivered.\n\n{{signature}}`,
    },
    {
      key: 'delivery_confirmation',
      name: 'Delivery confirmation',
      category: 'shipping',
      body: `Hi {{contact_person}},\n\n{{courier}} has marked {{order_ref}} as delivered to {{recipient_name}}.\n\nWe hope the unboxing landed well. If anything is missing or damaged, reply here and we will replace it.\n\n{{signature}}`,
    },
    {
      key: 'feedback_request',
      name: 'Feedback request',
      category: 'feedback',
      body: `Hi {{contact_person}},\n\nThank you for working with Cold Post on {{campaign_name}}.\n\nCould you spare two minutes? A one-line note on how the packages were received helps us improve the next campaign — and if you have a moment, a photo of the unboxing is always welcome.\n\n{{signature}}`,
    },
    {
      key: 'damage_investigation',
      name: 'Damage / missing item investigation',
      category: 'support',
      body: `Hi {{contact_person}},\n\nThank you for flagging this. We have opened an investigation for {{order_ref}} and are checking packing photographs and courier scans today.\n\nIf you can share a photo of the package and the items received, it will help us resolve this faster. A replacement is dispatched on priority once confirmed.\n\n{{signature}}`,
    },
  ];
  for (const template of templates) {
    const existing = get<{ id: number }>('SELECT id FROM message_templates WHERE key = ?', template.key);
    if (existing) continue;
    insert('message_templates', template);
  }
}

export function ensureOrderTemplates() {
  const existing = get<{ c: number }>('SELECT COUNT(*) AS c FROM order_templates')!.c;
  if (existing > 0) return;

  const qc = [
    'Correct recipient name',
    'Correct personalised letter',
    'Correct QR code or destination',
    'All required products included',
    'Products free from visible defects',
    'Stickers and labels applied correctly',
    'Packaging arranged correctly',
    'Protective filler included',
    'Tamper-evident seal applied',
    'Final package photographs uploaded',
    'Shipping label details checked',
  ];

  const templates = [
    {
      name: 'Cold Outreach Kit',
      campaign_type: 'cold_outreach',
      purpose: 'Earn a reply from a prospect who ignores email and LinkedIn.',
      description:
        'A compact desk-side package built around one useful object, a short handwritten-feeling letter and a single clear call to action. Designed to fit inside a rigid mailer and survive courier handling without a shipping box.',
      suggested_components: [
        { name: 'Hardcover notebook', sku: 'STN-NBK-01', qty: 1, category: 'product', customisation: 'Belly band' },
        { name: 'Metal roller pen', sku: 'STN-PEN-02', qty: 1, category: 'product' },
        { name: 'Personalised letter print', sku: 'PRT-LTR-14', qty: 1, category: 'printing' },
        { name: 'Custom sticker sheet', sku: 'PKG-STK-09', qty: 1, category: 'packaging' },
      ],
      suggested_packaging: [
        { name: 'Rigid gift box', sku: 'PKG-BOX-07', qty: 1, category: 'packaging' },
        { name: 'Printed belly band', sku: 'PKG-BND-10', qty: 1, category: 'packaging' },
        { name: 'Kraft filler', sku: 'PKG-FIL-08', qty: 1, category: 'packaging' },
        { name: 'Waterproof label', sku: 'PKG-LBL-11', qty: 1, category: 'packaging' },
      ],
      assembly_instructions:
        '1. Print the letter at 100% scale on 100gsm paper; check the recipient name and company spelling against the order before trimming.\n2. Wipe the notebook and pen with a dry microfibre cloth. Reject any item with scuffs, glue residue or loose binding.\n3. Place the notebook flat in the box with the spine facing the left edge. Slide the pen into the elastic loop or alongside the spine so it cannot rattle.\n4. Fold the letter in three with the printed side out. Place it on top of the notebook, aligned to the right edge.\n5. Add kraft filler on the open side only — enough that the lid closes without pressure. Never compress the box corners.\n6. Close the lid, wrap the printed belly band around the centre and seal at the base with a 20mm clear tape strip.\n7. Apply the recipient label on the top-right of the band, then the tamper-evident seal across the lid seam.\n8. Place the sticker sheet inside the lid (not loose) so it is the first thing seen on opening.\n9. Photograph the front, the open box and the sealed package. Upload to this work order before QC.',
      qc_checklist: qc,
      personalisation_fields: ['Recipient name', 'Company', 'Personalised letter copy', 'QR code destination', 'Sender name'],
      estimated_cost_paise: 42000,
    },
    {
      name: 'Client Appreciation Kit',
      campaign_type: 'client_appreciation',
      purpose: 'Thank the people who already pay you, so they renew and refer.',
      description:
        'A warmer, slower package: a useful desk object, something to drink from, a handwritten note and a small surprise. Built for repeat clients and account anniversaries.',
      suggested_components: [
        { name: 'Insulated steel bottle', sku: 'DRN-BTL-04', qty: 1, category: 'product', customisation: 'Waterproof label' },
        { name: 'Ceramic mug', sku: 'DRN-MUG-05', qty: 1, category: 'product', customisation: 'Sticker' },
        { name: 'Hand-poured soy candle', sku: 'ART-DRY-13', qty: 1, category: 'product' },
        { name: 'Personalised letter print', sku: 'PRT-LTR-14', qty: 1, category: 'printing' },
      ],
      suggested_packaging: [
        { name: 'Rigid gift box', sku: 'PKG-BOX-07', qty: 1, category: 'packaging' },
        { name: 'Kraft filler', sku: 'PKG-FIL-08', qty: 2, category: 'packaging' },
        { name: 'Waterproof label', sku: 'PKG-LBL-11', qty: 1, category: 'packaging' },
      ],
      assembly_instructions:
        '1. Check the client name and the anniversary or thank-you line on the letter. Personalisation errors cannot be fixed after sealing.\n2. Inspect drinkware for chips, dents and lid threading. Run a dry tissue around the rim; reject anything with residue.\n3. Wrap the bottle in one sheet of tissue, then place it in the left half of the box. Add a filler layer beneath so it sits at lid height.\n4. Place the mug mouth-up in the right half. Fill the inside of the mug with the candle (wrapped) so the cup cannot move.\n5. Slide the folded letter under the belly band or place it flat on top of the filler.\n6. Close, seal and label as per the Cold Post packing standard. Apply the tamper seal across the lid seam.\n7. Photograph the sealed box and the open arrangement. Any handwritten note must be legible in the photograph.\n8. Log the package contents on the work order in case a replacement is needed later.',
      qc_checklist: qc,
      personalisation_fields: ['Client name', 'Anniversary or occasion', 'Letter copy', 'Account manager name'],
      estimated_cost_paise: 78000,
    },
    {
      name: 'Launch & PR Kit',
      campaign_type: 'launch_pr',
      purpose: 'Get a new product into the hands of press, creators and partners with a story attached.',
      description:
        'A press-ready package with a hero product, a one-page story sheet, a QR link to the press folder and a shareable extra. Designed for photographs and unboxing.',
      suggested_components: [
        { name: 'Canvas tote', sku: 'BAG-TOT-06', qty: 1, category: 'product', customisation: 'Screen print' },
        { name: 'Insulated steel bottle', sku: 'DRN-BTL-04', qty: 1, category: 'product' },
        { name: 'Personalised letter print', sku: 'PRT-LTR-14', qty: 1, category: 'printing', customisation: 'Printed insert' },
        { name: 'Scratch card', sku: 'INT-SCR-12', qty: 1, category: 'product' },
      ],
      suggested_packaging: [
        { name: 'Rigid gift box', sku: 'PKG-BOX-07', qty: 1, category: 'packaging' },
        { name: 'Custom sticker sheet', sku: 'PKG-STK-09', qty: 1, category: 'packaging' },
        { name: 'Kraft filler', sku: 'PKG-FIL-08', qty: 2, category: 'packaging' },
      ],
      assembly_instructions:
        '1. Confirm the press name, outlet and embargo date on the story sheet. Embargo dates are printed, never stickered over.\n2. Test the QR code on the story sheet with a phone before packing. It must open the press folder in under three seconds.\n3. Fold the tote flat, printed side out, and lay it at the base of the box as the opening layer.\n4. Place the bottle upright beside the tote and fill the remaining space with kraft filler so nothing shifts when the box is shaken gently.\n5. Place the story sheet on top, then the scratch card in a small glassine bag so it is not bent.\n6. Seal, apply the launch sticker to the outside lid and mark the package with the campaign mark printed on the box top.\n7. Photograph: flat lay of contents, sealed box and the QR code close-up. Upload all three before QC.',
      qc_checklist: qc,
      personalisation_fields: ['Publication / creator name', 'Embargo date', 'Press folder URL / QR destination', 'Spokesperson name'],
      estimated_cost_paise: 92000,
    },
    {
      name: 'Event & Invitation Kit',
      campaign_type: 'event_invitation',
      purpose: 'Make an invitation impossible to ignore and easy to bring along.',
      description:
        'A physical invitation with the details, a keepsake the guest can carry, and an RSVP mechanism that works without an app. Scaled per guest or per table.',
      suggested_components: [
        { name: 'Personalised letter print', sku: 'PRT-LTR-14', qty: 1, category: 'printing', customisation: 'Printed insert' },
        { name: 'Scratch card', sku: 'INT-SCR-12', qty: 1, category: 'product' },
        { name: 'Hardcover notebook', sku: 'STN-NBK-01', qty: 1, category: 'product' },
      ],
      suggested_packaging: [
        { name: 'Rigid gift box', sku: 'PKG-BOX-07', qty: 1, category: 'packaging' },
        { name: 'Printed belly band', sku: 'PKG-BND-10', qty: 1, category: 'packaging' },
        { name: 'Waterproof label', sku: 'PKG-LBL-11', qty: 1, category: 'packaging' },
      ],
      assembly_instructions:
        '1. Verify guest name, plus-one and table number against the guest list export. Do not hand-edit the guest list on paper.\n2. Print the invitation on the specified stock; check ink coverage and trim to size with a steel ruler.\n3. Place the invitation face-up in the box. Insert the notebook beneath it so the invitation is the first thing seen.\n4. Add the scratch card to the right side, with the foil facing up and no fingerprints.\n5. Close the lid, wrap the belly band and align the printed event mark to the centre of the band.\n6. Apply the guest label to the band, not the box, so it can be swapped if the guest list changes.\n7. Photograph the invitation text clearly at higher exposure — this is the image used for the RSVP reminder.\n8. Batch packages by table before dispatch so drop-off at the venue is simple.',
      qc_checklist: qc,
      personalisation_fields: ['Guest name', 'Plus-one', 'Table number', 'Event date and venue', 'RSVP link or QR'],
      estimated_cost_paise: 38000,
    },
    {
      name: 'City Signature Kit',
      campaign_type: 'city_signature',
      purpose: 'Introduce a city through its makers — used for city launches, hotel guests and relocation welcome kits.',
      description:
        'A locally sourced package that tells the story of one city: a maker-led product, a city map card and a note from the team. Sourcing changes per city, structure stays the same.',
      suggested_components: [
        { name: 'Hand-poured soy candle', sku: 'ART-DRY-13', qty: 1, category: 'product' },
        { name: 'Ceramic mug', sku: 'DRN-MUG-05', qty: 1, category: 'product', customisation: 'Waterproof label' },
        { name: 'Canvas tote', sku: 'BAG-TOT-06', qty: 1, category: 'product', customisation: 'Fabric label' },
        { name: 'Personalised letter print', sku: 'PRT-LTR-14', qty: 1, category: 'printing' },
      ],
      suggested_packaging: [
        { name: 'Rigid gift box', sku: 'PKG-BOX-07', qty: 1, category: 'packaging' },
        { name: 'Kraft filler', sku: 'PKG-FIL-08', qty: 2, category: 'packaging' },
        { name: 'Custom sticker sheet', sku: 'PKG-STK-09', qty: 1, category: 'packaging' },
      ],
      assembly_instructions:
        '1. Confirm which city edition is being packed — the map card, sticker and note differ by city. City name must appear on the outer label.\n2. Check local maker products for scent strength, glaze defects and print registration. Each city edition has its own maker, so inspect against that maker\'s sample.\n3. Wrap the candle in tissue and place it in the centre cavity; candles are the most damaged item in transit.\n4. Place the mug mouth-up beside the candle with the city label facing outward.\n5. Fold the tote and lay it flat across the top, then add the map card and the city note on top of the tote.\n6. Close, seal, and apply the city label to the top-left of the lid.\n7. Photograph the flat lay with the city label visible. Keep one sample package per city batch for reference.\n8. Record the maker and batch number in the work order notes.',
      qc_checklist: qc,
      personalisation_fields: ['City edition', 'Recipient name', 'Maker / batch reference', 'Local note copy'],
      estimated_cost_paise: 86000,
    },
  ];

  for (const template of templates) {
    insert('order_templates', {
      ...template,
      suggested_components: JSON.stringify(template.suggested_components),
      suggested_packaging: JSON.stringify(template.suggested_packaging),
      qc_checklist: JSON.stringify(template.qc_checklist),
      personalisation_fields: JSON.stringify(template.personalisation_fields),
      demo: 0,
    });
  }
}

/* ----------------------------- Demo dataset ---------------------------- */

function seedDemoData() {
  const counties = get<{ c: number }>('SELECT COUNT(*) AS c FROM cities')!.c;
  if (counties > 0 || process.env.SEED_DEMO === 'false') return;

  tx(() => {
    const lucknow = insert('cities', { name: 'Lucknow', state: 'Uttar Pradesh', code: 'LKO', demo: 1, notes: 'Home studio city' });
    const delhi = insert('cities', { name: 'Delhi', state: 'Delhi', code: 'DEL', demo: 1 });
    const mumbai = insert('cities', { name: 'Mumbai', state: 'Maharashtra', code: 'BOM', demo: 1 });

    const lkoFulfilment = insert('locations', {
      city_id: lucknow,
      name: 'Gomti Nagar Fulfilment Hub',
      category: 'fulfilment_hub',
      address: 'Vibhuti Khand, Gomti Nagar, Lucknow 226010',
      contact_person: 'Studio desk',
      phone: '+91 90000 00001',
      is_fulfilment_hub: 1,
      rating: 4.6,
      demo: 1,
    });
    const lkoPackaging = insert('locations', {
      city_id: lucknow,
      name: 'Aminabad Packaging Store',
      category: 'packaging_store',
      address: 'Aminabad Main Road, Lucknow 226018',
      contact_person: 'Counter 3',
      phone: '+91 90000 00002',
      opening_hours: 'Mon–Sat 10:30–19:00',
      rating: 4.2,
      demo: 1,
    });
    const delhiWholesale = insert('locations', {
      city_id: delhi,
      name: 'Sadar Bazaar Wholesale',
      category: 'wholesale_shop',
      address: 'Sadar Bazaar, Delhi 110006',
      contact_person: 'Counter 7',
      phone: '+91 90000 00003',
      rating: 4.0,
      demo: 1,
    });
    const delhiWarehouse = insert('locations', {
      city_id: delhi,
      name: 'Okhla Storage Unit',
      category: 'warehouse',
      address: 'Okhla Phase II, New Delhi 110020',
      rating: 4.4,
      demo: 1,
    });
    const mumbaiPrint = insert('locations', {
      city_id: mumbai,
      name: 'Andheri Print Shop',
      category: 'printing_shop',
      address: 'MIDC, Andheri East, Mumbai 400093',
      contact_person: 'Production desk',
      rating: 4.5,
      demo: 1,
    });
    const mumbaiStorage = insert('locations', {
      city_id: mumbai,
      name: 'Bhiwandi Storage',
      category: 'storage',
      address: 'Bhiwandi, Thane 421302',
      rating: 3.9,
      demo: 1,
    });

    const suppStationery = insert('suppliers', {
      name: 'Aminabad Stationery Traders',
      category: 'Stationery',
      contact_person: 'Counter manager',
      phone: '+91 90000 10001',
      city_id: lucknow,
      address: 'Aminabad, Lucknow',
      products_supplied: 'Notebooks, pens, printed inserts, sticker sheets',
      moq: 25,
      lead_time_days: 3,
      payment_terms: '50% advance, balance on delivery',
      quality_rating: 4.3,
      reliability_notes: 'Reliable for repeat notebook batches; check pen ink flow before accepting.',
      demo: 1,
    });
    const suppPackaging = insert('suppliers', {
      name: 'Delhi Packaging Depot',
      category: 'Packaging',
      contact_person: 'Sales desk',
      phone: '+91 90000 10002',
      city_id: delhi,
      address: 'Sadar Bazaar, Delhi',
      products_supplied: 'Rigid boxes, kraft filler, belly bands, waterproof labels',
      moq: 50,
      lead_time_days: 4,
      payment_terms: 'Net 15',
      quality_rating: 4.1,
      reliability_notes: 'Boxes arrive flat-packed; allow one day to assemble before a packing run.',
      demo: 1,
    });
    const suppPrint = insert('suppliers', {
      name: 'Andheri Print Works',
      category: 'Printing',
      contact_person: 'Production desk',
      phone: '+91 90000 10003',
      city_id: mumbai,
      address: 'MIDC, Andheri East, Mumbai',
      products_supplied: 'Letter printing, sticker sheets, belly bands, sleeves',
      moq: 50,
      lead_time_days: 5,
      payment_terms: 'Advance for first order, Net 7 after',
      quality_rating: 4.6,
      reliability_notes: 'Best colour consistency. Send a proof before full runs.',
      demo: 1,
    });
    run('UPDATE locations SET supplier_id = ? WHERE id = ?', suppStationery, lkoPackaging);

    const productRows = [
      { sku: 'STN-NBK-01', name: 'Hardcover notebook', category: 'stationery', cost: 18000, sell: 34900, moq: 25, weight: 320, custom: 'belly_band', desc: 'A5 hardcover, 160 pages, dot grid.' },
      { sku: 'STN-PEN-02', name: 'Metal roller pen', category: 'stationery', cost: 9500, sell: 19900, moq: 25, weight: 28, custom: 'sticker', desc: 'Matte black roller pen with metal clip.' },
      { sku: 'DRN-BTL-04', name: 'Insulated steel bottle', category: 'drinkware', cost: 42000, sell: 74900, moq: 20, weight: 340, custom: 'waterproof_label', desc: '500ml double-wall steel bottle.' },
      { sku: 'DRN-MUG-05', name: 'Ceramic mug', category: 'drinkware', cost: 16000, sell: 34900, moq: 24, weight: 290, custom: 'sticker', desc: '300ml matte ceramic mug.' },
      { sku: 'BAG-TOT-06', name: 'Canvas tote', category: 'bags', cost: 14000, sell: 29900, moq: 30, weight: 110, custom: 'screen_print', desc: '12oz canvas tote with inner pocket.' },
      { sku: 'PKG-BOX-07', name: 'Rigid gift box', category: 'packaging', cost: 8500, sell: 0, moq: 50, weight: 240, custom: 'sticker', packaging: true, desc: 'Two-piece rigid box, 24 × 18 × 8 cm.' },
      { sku: 'PKG-FIL-08', name: 'Kraft filler', category: 'packaging', cost: 1800, sell: 0, moq: 100, weight: 40, custom: 'none', packaging: true, desc: 'Recycled kraft crinkle filler, 100g per pack.' },
      { sku: 'PKG-STK-09', name: 'Custom sticker sheet', category: 'printed_materials', cost: 1200, sell: 0, moq: 100, weight: 12, custom: 'printed_insert', packaging: true, desc: 'A6 die-cut sticker sheet.' },
      { sku: 'PKG-BND-10', name: 'Printed belly band', category: 'packaging', cost: 800, sell: 0, moq: 100, weight: 15, custom: 'belly_band', packaging: true, desc: 'Printed 300gsm belly band.' },
      { sku: 'PKG-LBL-11', name: 'Waterproof label', category: 'packaging', cost: 300, sell: 0, moq: 200, weight: 2, custom: 'waterproof_label', packaging: true, desc: 'Water-resistant address label.' },
      { sku: 'INT-SCR-12', name: 'Scratch card', category: 'interactive', cost: 2500, sell: 4900, moq: 50, weight: 8, custom: 'printed_insert', desc: 'Silver foil scratch card with printed reveal.' },
      { sku: 'ART-DRY-13', name: 'Hand-poured soy candle', category: 'artisan', cost: 24000, sell: 49900, moq: 12, weight: 350, custom: 'fabric_label', desc: '100g soy candle in amber glass.' },
      { sku: 'PRT-LTR-14', name: 'Personalised letter print', category: 'printed_materials', cost: 1000, sell: 0, moq: 25, weight: 6, custom: 'printed_insert', packaging: true, desc: '100gsm letter print, single side.' },
    ];
    const productIds: Record<string, number> = {};
    for (const product of productRows) {
      productIds[product.sku] = insert('products', {
        sku: product.sku,
        name: product.name,
        category: product.category,
        description: product.desc,
        supplier_id: ['PKG-BOX-07', 'PKG-FIL-08', 'PKG-BND-10', 'PKG-LBL-11'].includes(product.sku) ? suppPackaging : suppStationery,
        purchase_price_paise: product.cost,
        selling_price_paise: product.sell,
        min_stock: product.packaging ? 50 : 10,
        customisation_method: product.custom,
        weight_g: product.weight,
        is_packaging: !!product.packaging,
        demo: 1,
      });
    }

    const offers: [string, number, number, number, number][] = [
      ['STN-NBK-01', lucknow, suppStationery, 0, 1],
      ['STN-NBK-01', delhi, suppStationery, 17500, 25],
      ['STN-PEN-02', lucknow, suppStationery, -500, 25],
      ['PKG-BOX-07', delhi, suppPackaging, 0, 50],
      ['PKG-BOX-07', lucknow, suppPackaging, 400, 50],
      ['PKG-BOX-07', mumbai, suppPackaging, 300, 100],
      ['ART-DRY-13', mumbai, suppPrint, 0, 12],
      ['PRT-LTR-14', mumbai, suppPrint, 0, 100],
      ['PKG-STK-09', mumbai, suppPrint, 0, 100],
      ['DRN-BTL-04', delhi, suppStationery, 2000, 20],
      ['DRN-BTL-04', lucknow, suppStationery, 3000, 20],
      ['DRN-MUG-05', delhi, suppStationery, 0, 24],
      ['BAG-TOT-06', delhi, suppStationery, 0, 30],
    ];
    for (const [sku, locationId, supplierId, delta, moq] of offers) {
      const product = get<any>('SELECT * FROM products WHERE id = ?', productIds[sku]);
      insert('product_offers', {
        product_id: productIds[sku],
        supplier_id: supplierId,
        location_id: locationId,
        unit_price_paise: product.purchase_price_paise + delta,
        moq,
        lead_time_days: 3,
        notes: 'Demo price — replace with your negotiated rate',
      });
    }

    const stocks: [string, number, number][] = [
      ['STN-NBK-01', lucknow, 40],
      ['STN-NBK-01', delhi, 100],
      ['STN-NBK-01', mumbai, 25],
      ['STN-PEN-02', lucknow, 120],
      ['PKG-BOX-07', lucknow, 60],
      ['PKG-BOX-07', delhi, 100],
      ['PKG-BOX-07', mumbai, 25],
      ['PKG-FIL-08', lucknow, 200],
      ['PKG-STK-09', mumbai, 300],
      ['PKG-BND-10', mumbai, 250],
      ['PKG-LBL-11', lucknow, 400],
      ['PRT-LTR-14', mumbai, 180],
      ['DRN-BTL-04', lucknow, 12],
      ['DRN-MUG-05', delhi, 30],
      ['BAG-TOT-06', delhi, 18],
      ['ART-DRY-13', mumbai, 8],
      ['INT-SCR-12', delhi, 45],
    ];
    for (const [sku, locationId, qty] of stocks) {
      insert('inventory', { product_id: productIds[sku], location_id: locationId, qty_available: qty });
      insert('inventory_movements', {
        product_id: productIds[sku],
        location_id: locationId,
        type: 'receive',
        qty,
        balance_available: qty,
        reason: 'Demo opening stock',
        ref_type: 'demo_seed',
      });
    }

    const customer1 = insert('customers', {
      company_name: 'Northwind Traders',
      contact_person: 'Ananya Rao',
      email: 'ananya@northwind.example',
      phone: '+91 98100 20001',
      billing_address: '3rd Floor, Sector 44, Gurugram, Haryana 122003',
      gstin: '06ABCDE1234F1Z5',
      customer_type: 'corporate',
      notes: 'Demo customer. Founder-led outreach customer; prefers morning calls.',
      demo: 1,
    });
    const customer2 = insert('customers', {
      company_name: 'Studio Meraki',
      contact_person: 'Kabir Mehta',
      email: 'kabir@meraki.example',
      phone: '+91 98100 20002',
      billing_address: 'Kala Ghoda, Fort, Mumbai 400001',
      customer_type: 'agency',
      notes: 'Demo customer. Recurring gifting partner.',
      demo: 1,
    });

    const template1 = get<any>("SELECT * FROM order_templates WHERE campaign_type = 'cold_outreach'")!;
    const template2 = get<any>("SELECT * FROM order_templates WHERE campaign_type = 'client_appreciation'")!;

    const order1 = insert('orders', {
      ref: 'CP-2026-0001',
      customer_id: customer1,
      order_date: isoDate(-9),
      campaign_name: 'Founder outreach — 5 warm prospects',
      campaign_type: 'cold_outreach',
      template_id: template1.id,
      description: 'Five outreach kits for founders who have not replied to email. Handwritten-feel letters, notebook and pen.',
      recipient_count: 5,
      expected_dispatch_date: isoDate(4),
      target_delivery_date: isoDate(9),
      procurement_city_id: lucknow,
      fulfilment_location_id: lkoFulfilment,
      quotation_number: 'QT-2026-0001',
      quotation_date: isoDate(-9),
      quotation_amount_paise: 2495000,
      advance_received_paise: 1247600,
      total_value_paise: 2495000,
      status: 'confirmed',
      packing_requirements: 'Rigid box, kraft filler, tamper seal on lid seam.',
      special_instructions: 'Each letter must reference the recipient company by name. No printed signatures.',
      internal_notes: 'Demo order — created by seed data. Walk through procurement, assembly, QC and dispatch.',
      confirmed_at: new Date().toISOString(),
      created_by: 1,
      demo: 1,
    });
    insert('order_status_history', { order_id: order1, from_status: null, to_status: 'confirmed', note: 'Demo order seeded as confirmed', user_id: 1 });
    insert('order_status_history', { order_id: order1, from_status: 'draft', to_status: 'quotation', note: 'Quotation QT-2026-0001 issued', user_id: 1 });

    const recipients1 = [
      ['Aarav Sharma', 'Lumen Labs', 'Gomti Nagar, Lucknow', 'Uttar Pradesh', '226010', lucknow, lkoFulfilment],
      ['Meera Iyer', 'Iyer & Co', 'Indiranagar, Bengaluru', 'Karnataka', '560038', delhi, delhiWarehouse],
      ['Rohan Kapoor', 'Kapoor Ventures', 'Bandra West, Mumbai', 'Maharashtra', '400050', mumbai, mumbaiStorage],
      ['Sneha Patil', 'Northstar Design', 'Baner, Pune', 'Maharashtra', '411045', mumbai, mumbaiStorage],
      ['Vikram Nair', 'Nair Analytics', 'Sector 62, Noida', 'Uttar Pradesh', '201309', delhi, delhiWarehouse],
    ];
    let idx = 0;
    for (const [name, company, city, state, pincode, cityId, locationId] of recipients1) {
      idx += 1;
      insert('recipients', {
        order_id: order1,
        name: String(name),
        company: String(company),
        phone: `+91 98100 3${String(idx).padStart(4, '0')}`,
        email: `${String(name).split(' ')[0].toLowerCase()}@${String(company).toLowerCase().replace(/[^a-z]/g, '')}.example`,
        address_line1: String(city),
        city: String(city).split(',').pop()?.trim() ?? String(city),
        state: String(state),
        pincode: String(pincode),
        personalisation: `Letter addressed to ${name} at ${company}; references ${company}'s expansion plans.`,
        packaging_notes: 'Navy belly band',
        unboxing_code: String(100 + idx),
        status: 'ready_for_assembly',
        fulfilment_location_id: locationId as number,
      });
    }

    const bom1 = [
      ['STN-NBK-01', 1, productIds['STN-NBK-01'], suppStationery, 'product', 'Navy belly band'],
      ['STN-PEN-02', 1, productIds['STN-PEN-02'], suppStationery, 'product', 'Logo sticker'],
      ['PRT-LTR-14', 1, productIds['PRT-LTR-14'], suppPrint, 'printing', 'Personalised letter'],
      ['PKG-BOX-07', 1, productIds['PKG-BOX-07'], suppPackaging, 'packaging', null],
      ['PKG-BND-10', 1, productIds['PKG-BND-10'], suppPrint, 'packaging', 'Printed with Cold Post mark'],
      ['PKG-FIL-08', 1, productIds['PKG-FIL-08'], suppPackaging, 'packaging', null],
      ['PKG-STK-09', 1, productIds['PKG-STK-09'], suppPrint, 'packaging', 'Logo sticker sheet'],
      ['PKG-LBL-11', 1, productIds['PKG-LBL-11'], suppPackaging, 'packaging', null],
    ] as const;
    for (const [sku, qty, productId, supplierId, category, customisation] of bom1) {
      const product = get<any>('SELECT * FROM products WHERE id = ?', productId);
      insert('bom_items', {
        order_id: order1,
        product_id: productId,
        sku_snapshot: sku,
        name_snapshot: product.name,
        qty_per_package: qty,
        total_qty: Number(qty) * 5,
        unit_cost_paise: product.purchase_price_paise,
        supplier_id: supplierId,
        cost_category: category,
        customisation: customisation ?? null,
      });
    }
    insert('order_cost_items', { order_id: order1, category: 'printing', description: 'Letter printing setup (demo)', estimated_paise: 120000, actual_paise: 115000 });
    insert('order_cost_items', { order_id: order1, category: 'labour', description: 'Assembly labour — 5 packages @ ₹120', estimated_paise: 60000, actual_paise: 60000 });
    insert('order_cost_items', { order_id: order1, category: 'shipping', description: 'Courier estimate — 5 packages', estimated_paise: 75000, actual_paise: 0 });
    syncOrderCosts(order1);

    /* Second demo order lives further along the workflow. */
    const order2 = insert('orders', {
      ref: 'CP-2026-0002',
      customer_id: customer2,
      order_date: isoDate(-30),
      campaign_name: 'Agency anniversary gifts',
      campaign_type: 'client_appreciation',
      template_id: template2.id,
      description: 'Three appreciation packages for Studio Meraki client leads.',
      recipient_count: 3,
      expected_dispatch_date: isoDate(-20),
      target_delivery_date: isoDate(-12),
      procurement_city_id: delhi,
      fulfilment_location_id: delhiWarehouse,
      quotation_number: 'QT-2026-0002',
      quotation_date: isoDate(-29),
      quotation_amount_paise: 899700,
      advance_received_paise: 899700,
      total_value_paise: 899700,
      status: 'delivered',
      confirmed_at: new Date(Date.now() - 27 * 86400000).toISOString(),
      created_by: 1,
      demo: 1,
    });
    insert('order_status_history', { order_id: order2, from_status: null, to_status: 'delivered', note: 'Demo order delivered end-to-end', user_id: 1 });

    for (let i = 1; i <= 3; i += 1) {
      const recipientId = insert('recipients', {
        order_id: order2,
        name: ['Nikhil Bose', 'Tara Shah', 'Dev Malhotra'][i - 1],
        company: 'Studio Meraki',
        phone: `+91 98100 4${String(i).padStart(4, '0')}`,
        address_line1: ['Juhu, Mumbai', 'Alwarpet, Chennai', 'Vasant Vihar, New Delhi'][i - 1],
        city: ['Mumbai', 'Chennai', 'New Delhi'][i - 1],
        state: ['Maharashtra', 'Tamil Nadu', 'Delhi'][i - 1],
        pincode: ['400049', '600018', '110057'][i - 1],
        personalisation: 'Handwritten note from the account team.',
        status: 'delivered',
        fulfilment_location_id: delhiWarehouse,
        delivered_at: new Date(Date.now() - (10 + i) * 86400000).toISOString(),
      });
      const workOrderId = insert('work_orders', {
        ref: `CP-2026-0002-P${String(recipientId).padStart(3, '0')}`,
        order_id: order2,
        recipient_id: recipientId,
        package_type: 'Agency anniversary gifts',
        status: 'completed',
        assigned_to: 'Studio team',
        instructions: 'Pack bottle, mug and candle with the handwritten note on top.',
        checklist: JSON.stringify([
          { label: 'Bottle inspected', done: true },
          { label: 'Mug inspected', done: true },
          { label: 'Note placed', done: true },
          { label: 'Box sealed', done: true },
        ]),
        start_date: isoDate(-24),
        completion_date: isoDate(-21),
        created_by: 1,
      });
      insert('qc_inspections', {
        recipient_id: recipientId,
        order_id: order2,
        work_order_id: workOrderId,
        status: 'passed',
        checklist: JSON.stringify([
          { label: 'Correct recipient name', done: true },
          { label: 'All required products included', done: true },
          { label: 'Final package photographs uploaded', done: true },
        ]),
        notes: 'Demo inspection — passed.',
        inspector_id: 1,
      });
      const shipmentId = insert('shipments', {
        order_id: order2,
        recipient_id: recipientId,
        mode: 'manual',
        courier_name: 'Demo Courier',
        service: 'Surface',
        awb: `DEMO${100000 + i}`,
        shipment_date: isoDate(-20),
        weight_g: 1200,
        dimensions: '30 × 24 × 12 cm',
        cost_paise: 18000,
        tracking_url: `https://example.com/track/DEMO${100000 + i}`,
        status: 'delivered',
        delivered_at: new Date(Date.now() - (10 + i) * 86400000).toISOString(),
        idempotency_key: `shipment:recipient:${recipientId}`,
        created_by: 1,
      });
      insert('shipment_events', { shipment_id: shipmentId, status: 'booked', description: 'Demo shipment booked manually', source: 'manual', event_at: isoDate(-20) });
      insert('shipment_events', { shipment_id: shipmentId, status: 'in_transit', description: 'Departed origin hub', source: 'manual', event_at: isoDate(-19) });
      insert('shipment_events', { shipment_id: shipmentId, status: 'delivered', description: 'Delivered — demo event', source: 'manual', event_at: isoDate(-18) });
      insert('feedback', {
        order_id: order2,
        recipient_id: recipientId,
        customer_id: customer2,
        delivery_confirmed: 1,
        rating: i === 2 ? 4 : 5,
        comments: i === 2 ? 'Gift arrived well packed, the card was slightly bent.' : 'Client loved the packaging. Asked who made it.',
        packaging_feedback: 'Premium feel, seal intact on arrival.',
        overall_experience: i === 2 ? 'Good' : 'Excellent',
        repeat_interest: 1,
        created_by: 1,
      });
    }

    const bom2 = [
      ['DRN-BTL-04', 1, productIds['DRN-BTL-04'], suppStationery, 'product'],
      ['DRN-MUG-05', 1, productIds['DRN-MUG-05'], suppStationery, 'product'],
      ['ART-DRY-13', 1, productIds['ART-DRY-13'], suppPrint, 'product'],
      ['PKG-BOX-07', 1, productIds['PKG-BOX-07'], suppPackaging, 'packaging'],
      ['PKG-FIL-08', 2, productIds['PKG-FIL-08'], suppPackaging, 'packaging'],
      ['PRT-LTR-14', 1, productIds['PRT-LTR-14'], suppPrint, 'printing'],
      ['PKG-LBL-11', 1, productIds['PKG-LBL-11'], suppPackaging, 'packaging'],
    ] as const;
    for (const [sku, qty, productId, supplierId, category] of bom2) {
      const product = get<any>('SELECT * FROM products WHERE id = ?', productId);
      insert('bom_items', {
        order_id: order2,
        product_id: productId,
        sku_snapshot: sku,
        name_snapshot: product.name,
        qty_per_package: qty,
        total_qty: Number(qty) * 3,
        unit_cost_paise: product.purchase_price_paise,
        supplier_id: supplierId,
        cost_category: category,
        is_snapshot: 1,
      });
    }
    insert('order_cost_items', { order_id: order2, category: 'labour', description: 'Assembly labour — 3 packages', estimated_paise: 36000, actual_paise: 36000 });
    insert('order_cost_items', { order_id: order2, category: 'shipping', description: 'Courier — 3 packages', estimated_paise: 54000, actual_paise: 54000 });
    syncOrderCosts(order2);

    insert('messages', {
      order_id: order2,
      recipient_id: null,
      customer_id: customer2,
      template_key: 'delivery_confirmation',
      channel: 'whatsapp',
      to_phone: '+91 98100 20002',
      body: 'Hi Kabir,\n\nDemo Courier has marked CP-2026-0002 as delivered to your client leads.\n\nWe hope the unboxing landed well.\n\n— Team Cold Post',
      status: 'sent_manual',
      sent_at: new Date(Date.now() - 9 * 86400000).toISOString(),
      sent_confirmed_by: 1,
      created_by: 1,
      idempotency_key: null,
    });

    console.log('[seed] demo data created — cities, stores, suppliers, products, two demo orders');
  });
}

export function ensureSeed() {
  ensureAdmin();
  ensureMessageTemplates();
  ensureOrderTemplates();
  ensureProviderRows();
  try {
    seedDemoData();
  } catch (error) {
    console.error('[seed] demo seed skipped:', (error as Error).message);
  }
}

const invokedDirectly = process.argv[1]?.replace(/\\/g, '/').endsWith('server/seed.ts');
if (invokedDirectly) {
  if (process.argv.includes('--reset')) {
    console.log('[seed] --reset requested. Delete data/coldpost.db manually if you want a clean slate.');
  }
  ensureSeed();
  const counts = {
    users: get<{ c: number }>('SELECT COUNT(*) AS c FROM users')!.c,
    cities: get<{ c: number }>('SELECT COUNT(*) AS c FROM cities')!.c,
    products: get<{ c: number }>('SELECT COUNT(*) AS c FROM products')!.c,
    orders: get<{ c: number }>('SELECT COUNT(*) AS c FROM orders')!.c,
    templates: get<{ c: number }>('SELECT COUNT(*) AS c FROM order_templates')!.c,
  };
  console.log('[seed] done', counts);
  db.close();
}
