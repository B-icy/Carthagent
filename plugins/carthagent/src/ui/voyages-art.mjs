export const escapeXML = value => String(value).replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]);
const rect = (x, y, w, h, fill) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"/>`;
const path = (d, fill) => `<path d="${d}" fill="${fill}"/>`;
export const HAIRSTYLES = {
  cropped: { name: 'Cropped', price: 0 }, long: { name: 'Long', price: 0 },
  curls: { name: 'Curls', price: 0 }, shaved: { name: 'Shaved', price: 0 },
  braids: { name: 'Ringed braids', price: 0 }, topknot: { name: 'Tied topknot', price: 0 },
  pigtails: { name: 'Ribbon pigtails', price: 0 },
  spacebuns: { name: 'Twin star buns', price: 35 },
  waves: { name: 'Wind-swept', price: 40 },
  bob: { name: 'Pearl-clip bob', price: 45 },
  updo: { name: 'Blossom chignon', price: 55 },
  locs: { name: 'Gold-cuffed locs', price: 60 },
  ringlets: { name: 'Rosebud ringlets', price: 65 },
  hime: { name: 'Silk-bow hime cut', price: 80 },
};
export const HATS = {
  none: { name: 'No hat', price: 0 }, beanie: { name: 'Beanie', price: 40 },
  bow: { name: 'Velvet ribbon bow', price: 45 },
  beret: { name: 'Strawberry beret', price: 65 },
  bandana: { name: 'Bandana', price: 70 },
  flowercrown: { name: 'Blossom garland', price: 85 },
  straw: { name: 'Woven reed cone', price: 90 },
  sunhat: { name: 'Ribboned sunbonnet', price: 110 },
  tassel: { name: 'Crimson tassel cap', price: 120 },
  cathood: { name: 'Plush kitty ears', price: 145 },
  tricorne: { name: 'Tricorne', price: 160 },
  wreath: { name: 'Gilded laurel', price: 220 },
  tiara: { name: 'Pearl & rose tiara', price: 260 },
  winged: { name: 'Winged iron helm', price: 280 },
  plumed: { name: 'Plumed velvet brim', price: 360 }, crested: { name: 'Horsehair crest', price: 460 },
  crown: { name: 'Sunburst crown', price: 620 },
};
export const SHIRTS = {
  none: { name: 'No shirt', price: 0 }, linen: { name: 'Linen shirt', price: 60 },
  blouse: { name: 'Puff-sleeve blouse', price: 65 },
  striped: { name: 'Striped tee', price: 90 },
  cardigan: { name: 'Heart-knit cardigan', price: 95 },
  tunic: { name: 'Bordered tunic', price: 110 },
  corset: { name: 'Ribbon-laced bodice', price: 135 },
  peacoat: { name: 'Wool pea coat', price: 150 },
  sailor: { name: 'Blossom sailor top', price: 165 },
  jacket: { name: 'Deck jacket', price: 180 },
  shawl: { name: 'Lace-trimmed shawl', price: 215 },
  pelisse: { name: 'Wolf-pelt mantle', price: 240 }, surcoat: { name: 'Crested silk surcoat', price: 300 },
  captain: { name: 'Captain’s coat', price: 320 },
  ballgown: { name: 'Starlight corset top', price: 340 },
  drape: { name: 'Brooched drape', price: 380 },
  cuirass: { name: 'Caped bronze cuirass', price: 480 }, astrolabe: { name: 'Astrolabe cloak', price: 600 },
};
export const BOTTOMS = {
  underwear: { name: 'Underwear', price: 0 },
  patched: { name: 'Patched castaway shorts', price: 25 },
  shorts: { name: 'Shorts', price: 40 },
  miniskirt: { name: 'Pleated rose skirt', price: 45 },
  rolled: { name: 'Rolled deck-cuffs', price: 55 },
  kilt: { name: 'Pleated kilt', price: 70 },
  pinafore: { name: 'Ruffled apron skirt', price: 75 },
  trousers: { name: 'Trousers', price: 80 },
  sash: { name: 'Sashed billow trousers', price: 105 },
  tiered: { name: 'Tiered blossom skirt', price: 115 },
  breeches: { name: 'Buckled breeches', price: 130 },
  tulle: { name: 'Starlit tulle tutu', price: 150 },
  leggings: { name: 'Cross-bound leather', price: 160 },
  pleats: { name: 'Wide indigo pleats', price: 190 },
  sarong: { name: 'Pearl-draped sarong', price: 210 },
  apron: { name: 'Forged-chain kilt', price: 235 },
  brocade: { name: 'Gilded silk brocade', price: 280 },
  gala: { name: 'Velvet bustle skirt', price: 310 },
  tassets: { name: 'Fluted plate tassets', price: 350 },
  astral: { name: 'Star-hemmed vestments', price: 440 },
};
export const SHOES = {
  barefoot: { name: 'Barefoot', price: 0 },
  wraps: { name: 'Rope ankle-wraps', price: 20 },
  sandals: { name: 'Sandals', price: 30 },
  maryjanes: { name: 'Bow Mary Janes', price: 35 },
  slippers: { name: 'Curled-toe slippers', price: 45 },
  ballet: { name: 'Ribbon ballet flats', price: 50 },
  clogs: { name: 'Lacquered clogs', price: 60 },
  canvas: { name: 'Laced deck shoes', price: 70 },
  boots: { name: 'Boots', price: 80 },
  heels: { name: 'Ruby buckle heels', price: 85 },
  buskins: { name: 'Laced leather buskins', price: 95 },
  furboots: { name: 'Fur-cuffed boots', price: 110 },
  laceboots: { name: 'Lace-cuff ankle boots', price: 125 },
  cuffed: { name: 'Fold-over thigh boots', price: 140 },
  buckled: { name: 'Buckled sea boots', price: 170 },
  spurs: { name: 'Spurred riding boots', price: 210 },
  glass: { name: 'Crystal-bow slippers', price: 230 },
  greaves: { name: 'Bronze greaves', price: 250 },
  sabatons: { name: 'Winged gold sabatons', price: 340 },
};
export const PETS = {
  none: { name: 'No pet', price: 0 },
  bunny: { name: 'Bow-eared bunny', price: 90 },
  turtle: { name: 'Sea tortoise', price: 100 },
  duckling: { name: 'Bonnet duckling', price: 110 },
  cat: { name: 'Cat', price: 120 }, dog: { name: 'Dog', price: 140 },
  kitten: { name: 'Teacup white kitten', price: 150 },
  parrot: { name: 'Parrot', price: 180 }, raven: { name: 'Night raven', price: 210 },
  fawn: { name: 'Blossom fawn', price: 230 },
  owl: { name: 'Spotted owl', price: 260 }, monkey: { name: 'Waistcoat monkey', price: 310 },
  fox: { name: 'Twin-tail fox', price: 400 },
  unicorn: { name: 'Star-maned pony', price: 460 },
  calf: { name: 'Saddled elephant calf', price: 540 },
};
export const SKINS = { warm: '#d99c75', light: '#efc49f', deep: '#8f5949', tan: '#bb805a' };
export const HAIR = { dark: '#392638', silver: '#ded2cc', copper: '#a85c40' };
export const HULLS = {
  cedar: { name: 'Cedar', color: '#9e674f', shade: '#68444a', price: 0 },
  raft: { name: 'Driftwood raft', color: '#a37454', shade: '#694635', price: 25 },
  tub: { name: 'Washtub barrel', color: '#8f5d46', shade: '#59372b', price: 40 },
  coracle: { name: 'Wicker basket boat', color: '#b88b58', shade: '#785636', price: 55 },
  dinghy: { name: 'Patched row-dinghy', color: '#9c6b53', shade: '#634136', price: 70 },
  papyrus: { name: 'Bound reed skiff', color: '#c89d66', shade: '#8a623e', price: 90 },
  fishing: { name: 'Net-draped fishing boat', color: '#6b7d7a', shade: '#3e4d4f', price: 115 },
  felucca: { name: 'Slanted-rig skiff', color: '#a86b51', shade: '#6b3e33', price: 145 },
  basalt: { name: 'Basalt ironwood', color: '#4e4a69', shade: '#291d36', price: 180 },
  outrigger: { name: 'Twin-spar outrigger', color: '#b07854', shade: '#734936', price: 220 },
  jade: { name: 'Sea jade', color: '#52877f', shade: '#31515d', price: 240 },
  royal: { name: 'Royal', color: '#8e6ca5', shade: '#523b69', price: 280 },
  merchant: { name: 'Deep-hold roundship', color: '#9c624c', shade: '#5e3832', price: 300 },
  rammed: { name: 'Bronze ram', color: '#b56c52', shade: '#6e3b3b', price: 340 },
  lacquer: { name: 'Lantern pavilion', color: '#ad536e', shade: '#682d47', price: 420 },
  dromon: { name: 'Flame-siphon galley', color: '#6b496e', shade: '#3d2547', price: 460 },
  dragon: { name: 'Shielded dragon', color: '#7d5a4f', shade: '#463035', price: 520 },
  trireme: { name: 'Three-banked warship', color: '#8f534d', shade: '#542c32', price: 580 },
  flagship: { name: 'Gilded flagship', color: '#3b4e6e', shade: '#222b42', price: 680 },
  cataphract: { name: 'Towered siege galley', color: '#5c4b6b', shade: '#332640', price: 820 },
  treasure: { name: 'Grand pavilion flagship', color: '#7a2e46', shade: '#47182b', price: 980 },
};
export const SAILS = {
  gold: { name: 'Gold', color: '#e6c480', shade: '#c49765', price: 0 },
  patched: { name: 'Patched burlap', color: '#c29b70', shade: '#8a6443', price: 35 },
  tattered: { name: 'Storm-tattered canvas', color: '#b8ad9e', shade: '#786e65', price: 65 },
  checkered: { name: 'Amber-checkered', color: '#e6c480', shade: '#9e523b', price: 95 },
  bone: { name: 'Linen', color: '#eee0c4', shade: '#c5b09d', price: 120 },
  chevron: { name: 'Chevron-striped', color: '#eee0c4', shade: '#a85c40', price: 135 },
  indigo: { name: 'Bordered indigo', color: '#5b6ea6', shade: '#394570', price: 150 },
  blossom: { name: 'Sakura petal', color: '#f5c6d6', shade: '#de8aa5', price: 165 },
  rose: { name: 'Rose', color: '#bf7892', shade: '#884c70', price: 180 },
  diamond: { name: 'Harlequin lozenge', color: '#52877f', shade: '#2d4f4b', price: 200 },
  emerald: { name: 'Gilded jade', color: '#538a84', shade: '#31515d', price: 220 },
  heart: { name: 'Ribboned heart', color: '#eee0c4', shade: '#de8aa5', price: 240 },
  crescent: { name: 'Silver crescent', color: '#313856', shade: '#1d2238', price: 260 },
  totem: { name: 'Dawn talisman', color: '#705486', shade: '#432d57', price: 320 },
  kraken: { name: 'Coiled kraken', color: '#2d5754', shade: '#1b3636', price: 360 },
  sunburst: { name: 'Crimson sunburst', color: '#c85a53', shade: '#873538', price: 420 },
  griffin: { name: 'Winged sun-disc', color: '#7a2e46', shade: '#4a192c', price: 460 },
  wave: { name: 'Cresting wave', color: '#dfd6c7', shade: '#9e9589', price: 500 },
  serpent: { name: 'Ouroboros dragon', color: '#3b2d4a', shade: '#22182e', price: 560 },
  compass: { name: 'Compass rose', color: '#2b2347', shade: '#18122b', price: 640 },
  phoenix: { name: 'Rising firebird', color: '#8f2d38', shade: '#541621', price: 720 },
  constellation: { name: 'Celestial star-chart', color: '#1b1d36', shade: '#0f1021', price: 820 },
};
export const SETTINGS = {
  dusk: { name: 'Amethyst harbour', price: 0, sky: '#35203f', upper: '#432b50', horizon: '#a57286', sun: '#e6bc97', sea: '#382d55', wave: '#6e5887' },
  mist: { name: 'Misty fjord', price: 160, sky: '#3a5566', upper: '#5c7d8f', horizon: '#b8d4de', sun: '#f2f7fa', sea: '#243c4f', wave: '#6c93a6' },
  whitecliff: { name: 'Whitewashed cliff town', price: 180, sky: '#3b7ec4', upper: '#63a4de', horizon: '#b5dff5', sun: '#fff3c4', sea: '#1e5c8a', wave: '#6ec2e0' },
  lagoon: { name: 'Turquoise atoll', price: 200, sky: '#2978a0', upper: '#4aa3bf', horizon: '#9ee6dc', sun: '#fff4b8', sea: '#167582', wave: '#6be0d6' },
  moon: { name: 'Moonlit crossing', price: 220, sky: '#21182f', upper: '#2c2340', horizon: '#5b4c76', sun: '#e8d8bd', sea: '#29223e', wave: '#64577e' },
  noon: { name: 'Azure strait', price: 260, sky: '#2f6ab0', upper: '#5492d4', horizon: '#9fd0f0', sun: '#fff2b2', sea: '#1f5485', wave: '#68a8d6' },
  bazaar: { name: 'Sun-baked dome port', price: 280, sky: '#8f4b32', upper: '#c47445', horizon: '#f2be7e', sun: '#fff0bd', sea: '#265966', wave: '#7dc4b8' },
  canyon: { name: 'Red-cliff sound', price: 300, sky: '#6e3534', upper: '#a85742', horizon: '#e69b63', sun: '#fae3a2', sea: '#264f54', wave: '#6ca393' },
  monsoon: { name: 'Storm squall', price: 340, sky: '#1a2030', upper: '#29354a', horizon: '#4f6278', sun: '#c9d4de', sea: '#162233', wave: '#637c94' },
  canal: { name: 'Arched canal palazzos', price: 360, sky: '#543861', upper: '#8f5774', horizon: '#e8a582', sun: '#fae6be', sea: '#2c4a5e', wave: '#7ba6b5' },
  ember: { name: 'Ember twilight', price: 380, sky: '#45182c', upper: '#822c46', horizon: '#e07a56', sun: '#ffd88a', sea: '#361a36', wave: '#b85a68' },
  blossom: { name: 'Cherry-blossom bay', price: 440, sky: '#524670', upper: '#85678f', horizon: '#ebb5c4', sun: '#fff2db', sea: '#393d66', wave: '#a884ab' },
  lanterns: { name: 'Lantern-lit night market', price: 460, sky: '#141229', upper: '#241e42', horizon: '#4f3861', sun: '#f5e8c7', sea: '#171830', wave: '#6b4e78' },
  volcano: { name: 'Cinder caldera', price: 480, sky: '#241626', upper: '#45212e', horizon: '#9e4238', sun: '#f09c56', sea: '#1f1726', wave: '#7d3a3a' },
  aurora: { name: 'Aurora crossing', price: 520, sky: '#14182e', upper: '#1d354a', horizon: '#457a75', sun: '#e8d8bd', sea: '#182438', wave: '#4b8a82' },
  ziggurat: { name: 'Stepped sun-temple', price: 560, sky: '#2b6e8c', upper: '#4ca0b5', horizon: '#d9c68f', sun: '#fff6d1', sea: '#1f5266', wave: '#64b0b8' },
  eclipse: { name: 'Solar eclipse', price: 600, sky: '#120e24', upper: '#261a3b', horizon: '#6b3854', sun: '#f5dca9', sea: '#15122b', wave: '#593b63' },
  biolum: { name: 'Starlit tide', price: 680, sky: '#0f1329', upper: '#182342', horizon: '#2c4d63', sun: '#e8f0f2', sea: '#102136', wave: '#47b8ab' },
  observatory: { name: 'Star-dome citadel', price: 720, sky: '#182038', upper: '#293d5e', horizon: '#688ea6', sun: '#f5dca9', sea: '#162840', wave: '#5ca3b5' },
  citadel: { name: 'Golden colossus', price: 780, sky: '#4a2c40', upper: '#7d4850', horizon: '#deb078', sun: '#fff0b8', sea: '#2c2f4d', wave: '#a6897c' },
  dawn: { name: 'First light', milestone: 750, price: 0, sky: '#614457', upper: '#865568', horizon: '#c79391', sun: '#f5dca9', sea: '#504060', wave: '#927390' },
};

export function characterArt(config = {}) {
  const skin = SKINS[config.skin || 'warm'];
  const hair = HAIR[config.hair || 'dark'];
  const style = config.hairStyle || 'cropped';
  const shirt = config.shirt || 'none', bottoms = config.bottoms || 'underwear';
  const shoes = config.shoes || 'barefoot', hat = config.hat || 'none';
  const gold = '#e6c480', dark = '#291d36';
  let art = '';
  if (shirt === 'cuirass') art += path('M3 19H25V32H22V33H6V32H3Z', '#883b55') + rect(4, 20, 20, 11, '#ad536e');
  if (shirt === 'astrolabe') art += path('M2 19H26V33H22V34H6V33H2Z', dark) + rect(3, 20, 22, 12, '#432d57') + rect(4, 31, 20, 1, gold);
  if (shirt === 'ballgown') art += path('M3 19H25V31H22V33H6V31H3Z', '#de8aa5') + rect(4, 20, 20, 10, '#f5c6d6') + rect(5, 30, 18, 1, gold);
  if (style === 'long') art += rect(6, 8, 17, 14, hair);
  if (style === 'braids') art += rect(6, 10, 3, 12, hair) + rect(20, 10, 3, 12, hair) + rect(6, 20, 3, 1, gold) + rect(20, 20, 3, 1, gold);
  if (style === 'locs') art += rect(6, 9, 17, 12, hair);
  if (style === 'pigtails') art += path('M3 8H7V21H4V18H3ZM22 8H26V18H25V21H22Z', hair) + rect(4, 19, 3, 2, '#f5c6d6') + rect(22, 19, 3, 2, '#f5c6d6');
  if (style === 'ringlets') art += path('M4 9H8V22H5V20H4V17H5V14H4ZM21 9H25V14H24V17H25V20H24V22H21Z', hair) + rect(5, 20, 2, 1, gold) + rect(22, 20, 2, 1, gold);
  if (style === 'hime') art += rect(5, 8, 19, 15, hair) + rect(6, 22, 17, 2, hair);
  art += rect(7, 30, 5, 5, skin) + rect(16, 30, 5, 5, skin) + rect(5, 34, 7, 2, skin) + rect(16, 34, 8, 2, skin);
  art += path('M8 17H20V20H23V29H5V20H8Z', skin);
  art += rect(4, 20, 3, 10, skin) + rect(21, 20, 3, 10, skin);
  art += rect(8, 28, 12, 4, '#eee0c4') + rect(8, 28, 12, 1, '#a385c7') + rect(13, 30, 2, 2, '#c5b09d');
  if (bottoms === 'patched') art += path('M7 28H21V32H19V33H16V31H12V33H9V32H7Z', '#8a623e') + rect(7, 28, 14, 1, '#c49765') + rect(13, 28, 3, 2, gold) + rect(8, 29, 4, 3, '#eee0c4') + rect(8, 29, 1, 1, dark) + rect(11, 29, 1, 1, dark) + rect(8, 31, 1, 1, dark) + rect(11, 31, 1, 1, dark) + rect(17, 30, 3, 2, '#6b7d7a');
  if (bottoms === 'shorts') art += rect(7, 28, 14, 4, '#705486') + rect(13, 30, 2, 2, '#432d57');
  if (bottoms === 'miniskirt') art += path('M6 28H22V32H5V30H6Z', '#de8aa5') + rect(7, 28, 14, 1, '#ad536e') + rect(8, 29, 2, 3, '#ad536e') + rect(13, 29, 2, 3, '#ad536e') + rect(18, 29, 2, 3, '#ad536e') + rect(5, 32, 18, 1, '#f6f0e7') + rect(12, 28, 4, 2, '#f5c6d6') + rect(13, 28, 2, 1, gold);
  if (bottoms === 'rolled') art += rect(7, 28, 14, 5, '#3e628a') + rect(12, 30, 4, 4, dark) + rect(7, 28, 14, 1, '#68444a') + rect(13, 28, 2, 1, gold) + rect(6, 32, 6, 2, '#eee0c4') + rect(16, 32, 6, 2, '#eee0c4') + rect(7, 32, 4, 1, '#c5b09d') + rect(17, 32, 4, 1, '#c5b09d');
  if (bottoms === 'kilt') art += rect(7, 28, 14, 5, '#eee0c4') + rect(9, 29, 1, 4, '#c5b09d') + rect(18, 29, 1, 4, '#c5b09d') + rect(7, 28, 14, 1, gold) + rect(12, 28, 4, 6, '#ad536e') + rect(13, 29, 2, 4, gold);
  if (bottoms === 'pinafore') art += path('M5 28H23V33H5Z', '#ad536e') + rect(6, 29, 2, 4, '#883b55') + rect(19, 29, 2, 4, '#883b55') + path('M9 28H19V32H17V33H11V32H9Z', '#f6f0e7') + rect(7, 28, 14, 1, '#f5c6d6') + rect(12, 28, 4, 2, '#de8aa5') + rect(13, 28, 2, 1, gold);
  if (bottoms === 'trousers') art += rect(7, 28, 14, 7, '#4e4a69') + rect(12, 30, 4, 5, dark);
  if (bottoms === 'sash') art += path('M6 28H22V33H20V34H16V31H12V34H8V33H6Z', '#7a2e46') + rect(8, 29, 3, 4, '#ad536e') + rect(17, 29, 3, 4, '#ad536e') + rect(7, 33, 5, 1, gold) + rect(16, 33, 5, 1, gold) + rect(7, 28, 14, 2, gold) + rect(18, 29, 2, 4, '#f5dca9');
  if (bottoms === 'tiered') art += rect(6, 28, 16, 2, '#f5c6d6') + rect(5, 30, 18, 2, '#de8aa5') + rect(4, 32, 20, 2, '#ad536e') + rect(6, 28, 16, 1, gold) + rect(5, 30, 18, 1, '#f6f0e7') + rect(4, 32, 20, 1, gold);
  if (bottoms === 'breeches') art += rect(7, 28, 14, 5, '#523b69') + rect(12, 30, 4, 5, dark) + rect(7, 33, 5, 2, '#eee0c4') + rect(16, 33, 5, 2, '#eee0c4') + rect(7, 32, 5, 1, gold) + rect(16, 32, 5, 1, gold);
  if (bottoms === 'tulle') art += path('M4 28H24V31H25V33H3V31H4Z', '#f5c6d6') + rect(5, 29, 18, 2, '#a385c7') + rect(6, 28, 16, 1, gold) + rect(7, 30, 2, 1, '#f6f0e7') + rect(13, 31, 2, 1, '#f6f0e7') + rect(19, 30, 2, 1, '#f6f0e7') + rect(9, 32, 1, 1, gold) + rect(18, 32, 1, 1, gold);
  if (bottoms === 'leggings') art += rect(7, 28, 14, 7, '#9e674f') + rect(12, 30, 4, 5, dark) + rect(7, 28, 14, 1, '#4d3549') + rect(12, 28, 4, 2, gold) + rect(7, 30, 5, 1, '#4d3549') + rect(16, 30, 5, 1, '#4d3549') + rect(7, 32, 5, 1, '#4d3549') + rect(16, 32, 5, 1, '#4d3549') + rect(9, 29, 1, 5, '#c49765') + rect(18, 29, 1, 5, '#c49765');
  if (bottoms === 'pleats') art += path('M6 28H22V34H15V31H13V34H6Z', '#31515d') + rect(8, 29, 2, 5, '#52877f') + rect(18, 29, 2, 5, '#52877f') + rect(11, 29, 1, 5, dark) + rect(16, 29, 1, 5, dark);
  if (bottoms === 'sarong') art += path('M6 28H22V34H16V32H11V34H6Z', '#de8aa5') + path('M7 29H18V31H14V33H7Z', '#ad536e') + rect(6, 28, 16, 1, gold) + rect(8, 29, 2, 1, '#f6f0e7') + rect(11, 30, 2, 1, '#f6f0e7') + rect(14, 29, 2, 1, '#f6f0e7') + rect(17, 28, 3, 5, '#f5c6d6') + rect(18, 28, 1, 4, gold);
  if (bottoms === 'apron') art += rect(6, 28, 16, 6, '#5e5368') + rect(7, 29, 14, 4, '#8e8296') + rect(8, 30, 2, 1, '#c0b3ca') + rect(18, 30, 2, 1, '#c0b3ca') + rect(8, 32, 2, 1, '#c0b3ca') + rect(18, 32, 2, 1, '#c0b3ca') + rect(6, 28, 16, 1, gold) + rect(11, 28, 6, 7, '#ad536e') + rect(12, 29, 4, 5, gold) + rect(13, 30, 2, 3, '#883b55');
  if (bottoms === 'brocade') art += rect(7, 28, 14, 7, '#883b55') + rect(12, 30, 4, 5, dark) + rect(7, 28, 2, 7, gold) + rect(19, 28, 2, 7, gold) + rect(9, 28, 10, 2, '#ad536e') + rect(12, 28, 4, 2, '#f5dca9');
  if (bottoms === 'gala') art += path('M4 28H24V34H4Z', '#883b55') + path('M5 29H12V33H5ZM16 29H23V33H16Z', '#de8aa5') + rect(11, 29, 6, 5, '#f5c6d6') + rect(12, 30, 4, 4, '#f6f0e7') + rect(5, 28, 18, 1, gold) + rect(4, 33, 7, 1, gold) + rect(17, 33, 7, 1, gold) + rect(12, 28, 4, 2, gold);
  if (bottoms === 'tassets') art += rect(7, 28, 14, 7, '#682d47') + rect(12, 30, 4, 5, dark) + path('M5 28H12V34H6V32H5ZM16 28H23V32H22V34H16Z', '#c49765') + rect(6, 29, 5, 1, gold) + rect(17, 29, 5, 1, gold) + rect(6, 31, 5, 1, gold) + rect(17, 31, 5, 1, gold) + rect(7, 33, 4, 1, '#f5dca9') + rect(17, 33, 4, 1, '#f5dca9') + rect(12, 28, 4, 4, gold) + rect(13, 29, 2, 2, '#f5dca9');
  if (bottoms === 'astral') art += path('M5 28H23V35H15V31H13V35H5Z', '#2b2347') + rect(6, 29, 5, 5, '#432d57') + rect(17, 29, 5, 5, '#432d57') + rect(5, 28, 18, 1, gold) + rect(5, 34, 7, 1, gold) + rect(16, 34, 7, 1, gold) + rect(12, 28, 4, 6, gold) + rect(13, 29, 2, 4, '#538a84') + rect(8, 30, 1, 1, '#f5dca9') + rect(10, 32, 1, 1, '#f5dca9') + rect(19, 30, 1, 1, '#f5dca9') + rect(17, 32, 1, 1, '#f5dca9');
  if (shirt !== 'none') {
    const color = { linen: '#eee0c4', striped: '#a385c7', jacket: '#ad536e', captain: '#538a84' }[shirt];
    if (color) {
      art += path('M7 18H21V20H24V25H21V29H7V25H4V20H7Z', color);
      art += rect(11, 18, 6, 2, skin);
      if (shirt === 'striped') art += rect(7, 22, 14, 2, '#49364f') + rect(7, 26, 14, 2, '#49364f');
      if (shirt === 'jacket' || shirt === 'captain') art += rect(12, 20, 4, 9, '#eee0c4') + rect(7, 28, 14, 2, gold) + rect(17, 23, 1, 1, gold) + rect(17, 26, 1, 1, gold);
      if (shirt === 'captain') art += rect(5, 20, 5, 2, gold) + rect(18, 20, 5, 2, gold) + rect(4, 24, 3, 2, gold) + rect(21, 24, 3, 2, gold);
    } else if (shirt === 'blouse') {
      art += path('M7 19H21V29H7Z', '#f6f0e7') + path('M3 19H8V24H3ZM20 19H25V24H20Z', '#f5c6d6') + rect(10, 18, 8, 2, skin) + rect(7, 20, 14, 1, '#f5c6d6') + rect(12, 20, 4, 2, '#de8aa5') + rect(13, 22, 2, 2, '#ad536e') + rect(7, 27, 14, 2, '#de8aa5') + rect(4, 23, 3, 1, '#de8aa5') + rect(21, 23, 3, 1, '#de8aa5');
    } else if (shirt === 'cardigan') {
      art += path('M7 18H21V20H24V27H21V29H7V27H4V20H7Z', '#de8aa5') + rect(11, 19, 6, 10, '#f6f0e7') + rect(11, 18, 6, 2, skin) + rect(8, 22, 2, 2, '#ad536e') + rect(18, 22, 2, 2, '#ad536e') + rect(8, 26, 2, 2, '#f5c6d6') + rect(18, 26, 2, 2, '#f5c6d6') + rect(13, 22, 2, 1, gold) + rect(13, 25, 2, 1, gold);
    } else if (shirt === 'tunic') {
      art += rect(7, 18, 14, 11, '#eee0c4') + rect(11, 18, 6, 2, skin) + rect(7, 18, 3, 3, '#705486') + rect(18, 18, 3, 3, '#705486') + rect(7, 25, 14, 2, '#705486') + rect(7, 27, 14, 1, gold) + rect(16, 25, 2, 4, '#ad536e');
    } else if (shirt === 'corset') {
      art += path('M4 19H24V23H4Z', '#f6f0e7') + rect(9, 18, 10, 2, skin) + rect(7, 20, 14, 9, '#883b55') + rect(8, 20, 3, 8, '#ad536e') + rect(17, 20, 3, 8, '#ad536e') + rect(11, 20, 6, 8, '#f5c6d6') + rect(11, 21, 6, 1, gold) + rect(11, 23, 6, 1, gold) + rect(11, 25, 6, 1, gold) + rect(7, 28, 14, 1, gold);
    } else if (shirt === 'peacoat') {
      art += path('M7 18H21V20H24V26H21V29H7V26H4V20H7Z', '#382d55') + rect(8, 17, 3, 4, '#4e4a69') + rect(17, 17, 3, 4, '#4e4a69') + rect(12, 18, 4, 3, '#eee0c4') + rect(11, 22, 1, 1, gold) + rect(16, 22, 1, 1, gold) + rect(11, 25, 1, 1, gold) + rect(16, 25, 1, 1, gold) + rect(7, 28, 14, 1, dark);
    } else if (shirt === 'sailor') {
      art += path('M7 18H21V20H24V25H21V29H7V25H4V20H7Z', '#f6f0e7') + path('M7 18H11V22H17V18H21V23H7Z', '#de8aa5') + rect(8, 19, 12, 1, '#f6f0e7') + rect(11, 18, 6, 2, skin) + path('M11 22H17V25H15V27H13V25H11Z', '#ad536e') + rect(13, 22, 2, 2, '#f5c6d6') + rect(4, 24, 3, 1, '#de8aa5') + rect(21, 24, 3, 1, '#de8aa5') + rect(7, 28, 14, 1, '#de8aa5');
    } else if (shirt === 'shawl') {
      art += path('M7 18H21V29H7Z', '#f5c6d6') + path('M4 18H24V24H21V26H17V27H11V26H7V24H4Z', '#a385c7') + rect(5, 23, 18, 1, '#f6f0e7') + rect(8, 25, 12, 1, '#f6f0e7') + rect(11, 18, 6, 2, skin) + rect(12, 20, 4, 3, '#f6f0e7') + rect(13, 21, 2, 1, gold);
    } else if (shirt === 'pelisse') {
      art += path('M7 18H21V20H24V26H21V29H7V26H4V20H7Z', '#52877f') + path('M4 17H24V19H25V22H21V23H7V22H3V19H4Z', '#c5b09d') + rect(5, 18, 18, 2, '#eee0c4') + rect(7, 20, 4, 2, '#68444a') + rect(17, 20, 4, 2, '#68444a') + rect(7, 26, 14, 2, '#68444a') + rect(12, 26, 4, 2, gold) + rect(16, 19, 3, 3, gold) + rect(17, 20, 1, 1, '#68444a');
    } else if (shirt === 'surcoat') {
      art += path('M7 18H21V20H24V27H21V29H7V27H4V20H7Z', '#35203f') + rect(7, 18, 5, 11, '#ad536e') + rect(16, 18, 5, 11, '#ad536e') + rect(11, 18, 6, 2, skin) + path('M10 18H12V22H16V18H18V24H10Z', '#eee0c4') + rect(7, 26, 14, 2, gold) + rect(8, 21, 2, 2, gold) + rect(18, 21, 2, 2, gold) + rect(4, 25, 3, 2, '#ad536e') + rect(21, 25, 3, 2, '#ad536e');
    } else if (shirt === 'ballgown') {
      art += path('M3 20H8V24H3ZM20 20H25V24H20Z', '#f6f0e7') + rect(8, 18, 12, 3, skin) + path('M7 20H21V29H7Z', '#ad536e') + rect(9, 20, 10, 8, '#de8aa5') + path('M11 20H17V27H15V29H13V27H11Z', '#f5c6d6') + rect(7, 20, 14, 1, gold) + rect(12, 21, 4, 2, gold) + rect(13, 21, 2, 1, '#f6f0e7') + rect(7, 28, 14, 1, gold);
    } else if (shirt === 'drape') {
      art += path('M7 18H21V20H24V24H21V29H7V24H4V20H7Z', '#eee0c4') + rect(11, 18, 6, 2, skin) + path('M6 18H12V20H15V22H18V24H21V29H15V26H12V24H9V22H6Z', '#705486') + path('M6 19H11V21H14V23H17V25H21V26H16V24H13V22H10V20H6Z', gold) + rect(8, 18, 3, 3, '#f5dca9') + rect(9, 19, 1, 1, '#ad536e') + rect(8, 24, 1, 5, '#c5b09d') + rect(11, 25, 1, 4, '#c5b09d');
    } else if (shirt === 'cuirass') {
      art += path('M7 18H21V20H24V24H21V29H7V24H4V20H7Z', '#ad536e') + rect(4, 22, 3, 2, gold) + rect(21, 22, 3, 2, gold) + rect(7, 18, 14, 8, '#c49765') + rect(8, 19, 12, 6, gold) + rect(11, 18, 6, 1, skin) + rect(12, 20, 4, 3, '#f5dca9') + rect(13, 21, 2, 1, '#ad536e') + rect(9, 23, 4, 1, '#c49765') + rect(15, 23, 4, 1, '#c49765') + rect(7, 26, 14, 3, '#eee0c4') + rect(8, 26, 2, 3, '#ad536e') + rect(13, 26, 2, 3, '#ad536e') + rect(18, 26, 2, 3, '#ad536e') + rect(7, 25, 14, 1, '#c49765');
    } else if (shirt === 'astrolabe') {
      art += path('M7 18H21V20H24V27H21V29H7V27H4V20H7Z', '#432d57') + rect(8, 19, 12, 9, '#705486') + path('M3 18H9V21H3ZM19 18H25V21H19Z', gold) + rect(4, 19, 4, 1, '#c49765') + rect(20, 19, 4, 1, '#c49765') + rect(11, 18, 6, 2, skin) + rect(9, 20, 10, 1, gold) + rect(11, 21, 6, 5, gold) + rect(12, 22, 4, 3, '#538a84') + rect(13, 23, 2, 1, '#f5dca9') + rect(7, 27, 14, 2, gold) + rect(4, 25, 3, 2, gold) + rect(21, 25, 3, 2, gold);
    }
  }
  if (shoes === 'wraps') art += rect(7, 31, 5, 3, '#eee0c4') + rect(16, 31, 5, 3, '#eee0c4') + rect(7, 32, 5, 1, '#c49765') + rect(16, 32, 5, 1, '#c49765') + rect(7, 34, 5, 2, '#eee0c4') + rect(16, 34, 5, 2, '#eee0c4');
  if (shoes === 'sandals') art += rect(5, 34, 7, 2, '#9e674f') + rect(16, 34, 8, 2, '#9e674f') + rect(8, 33, 2, 1, gold) + rect(19, 33, 2, 1, gold);
  if (shoes === 'maryjanes') art += rect(7, 32, 5, 2, '#f6f0e7') + rect(16, 32, 5, 2, '#f6f0e7') + rect(5, 34, 7, 2, '#432d57') + rect(16, 34, 8, 2, '#432d57') + rect(7, 33, 5, 1, '#432d57') + rect(16, 33, 5, 1, '#432d57') + rect(6, 33, 2, 1, '#f5c6d6') + rect(20, 33, 2, 1, '#f5c6d6');
  if (shoes === 'slippers') art += path('M4 32H6V34H12V36H5V34H4ZM16 34H22V32H24V34H23V36H16Z', '#ad536e') + rect(4, 32, 2, 1, gold) + rect(22, 32, 2, 1, gold) + rect(5, 35, 7, 1, gold) + rect(16, 35, 7, 1, gold);
  if (shoes === 'ballet') art += rect(7, 31, 5, 1, '#f5c6d6') + rect(16, 31, 5, 1, '#f5c6d6') + rect(8, 32, 3, 1, '#de8aa5') + rect(17, 32, 3, 1, '#de8aa5') + rect(7, 33, 5, 1, '#f5c6d6') + rect(16, 33, 5, 1, '#f5c6d6') + rect(5, 34, 7, 2, '#de8aa5') + rect(16, 34, 8, 2, '#de8aa5') + rect(6, 34, 3, 1, '#f6f0e7') + rect(19, 34, 3, 1, '#f6f0e7');
  if (shoes === 'clogs') art += rect(5, 33, 7, 2, '#eee0c4') + rect(16, 33, 8, 2, '#eee0c4') + rect(6, 34, 2, 1, '#ad536e') + rect(21, 34, 2, 1, '#ad536e') + rect(5, 35, 7, 1, '#9e674f') + rect(16, 35, 8, 1, '#9e674f') + rect(6, 35, 1, 1, dark) + rect(10, 35, 1, 1, dark) + rect(17, 35, 1, 1, dark) + rect(21, 35, 1, 1, dark);
  if (shoes === 'canvas') art += rect(5, 33, 7, 2, '#394570') + rect(16, 33, 8, 2, '#394570') + rect(7, 33, 3, 1, '#f6f0e7') + rect(18, 33, 3, 1, '#f6f0e7') + rect(5, 35, 7, 1, '#eee0c4') + rect(16, 35, 8, 1, '#eee0c4');
  if (shoes === 'boots') art += rect(7, 32, 5, 3, '#68444a') + rect(16, 32, 5, 3, '#68444a') + rect(5, 34, 7, 2, dark) + rect(16, 34, 8, 2, dark);
  if (shoes === 'heels') art += path('M5 34H10V33H12V36H10V35H8V36H5ZM16 33H18V34H24V36H21V35H19V36H16Z', '#ad536e') + rect(5, 35, 4, 1, '#883b55') + rect(20, 35, 4, 1, '#883b55') + rect(7, 33, 2, 1, gold) + rect(19, 33, 2, 1, gold);
  if (shoes === 'buskins') art += rect(7, 30, 5, 5, '#9e674f') + rect(16, 30, 5, 5, '#9e674f') + rect(7, 30, 5, 1, gold) + rect(16, 30, 5, 1, gold) + rect(8, 31, 3, 1, '#4d3549') + rect(17, 31, 3, 1, '#4d3549') + rect(8, 33, 3, 1, '#4d3549') + rect(17, 33, 3, 1, '#4d3549') + rect(6, 35, 6, 1, '#4d3549') + rect(16, 35, 7, 1, '#4d3549');
  if (shoes === 'furboots') art += rect(6, 31, 6, 2, '#eee0c4') + rect(16, 31, 6, 2, '#eee0c4') + rect(7, 33, 5, 2, '#9e674f') + rect(16, 33, 5, 2, '#9e674f') + rect(8, 33, 2, 2, '#68444a') + rect(18, 33, 2, 2, '#68444a') + rect(5, 34, 7, 2, '#68444a') + rect(16, 34, 8, 2, '#68444a');
  if (shoes === 'laceboots') art += rect(6, 30, 6, 2, '#f6f0e7') + rect(16, 30, 6, 2, '#f6f0e7') + rect(7, 32, 5, 3, '#de8aa5') + rect(16, 32, 5, 3, '#de8aa5') + rect(5, 34, 7, 2, '#ad536e') + rect(16, 34, 8, 2, '#ad536e') + rect(8, 32, 2, 2, '#f6f0e7') + rect(18, 32, 2, 2, '#f6f0e7') + rect(9, 31, 1, 1, gold) + rect(18, 31, 1, 1, gold);
  if (shoes === 'cuffed') art += path('M6 30H12V32H11V35H6ZM16 30H22V35H17V32H16Z', '#a86b51') + rect(7, 32, 5, 3, '#59372b') + rect(16, 32, 5, 3, '#59372b') + rect(5, 34, 7, 2, dark) + rect(16, 34, 8, 2, dark) + rect(6, 30, 6, 1, gold) + rect(16, 30, 6, 1, gold);
  if (shoes === 'buckled') art += rect(6, 31, 6, 2, '#432d57') + rect(16, 31, 6, 2, '#432d57') + rect(7, 32, 5, 3, dark) + rect(16, 32, 5, 3, dark) + rect(5, 34, 7, 2, dark) + rect(16, 34, 8, 2, dark) + rect(7, 33, 3, 1, gold) + rect(18, 33, 3, 1, gold);
  if (shoes === 'spurs') art += rect(7, 30, 5, 2, '#883b55') + rect(16, 30, 5, 2, '#883b55') + rect(7, 31, 5, 4, '#291d36') + rect(16, 31, 5, 4, '#291d36') + rect(5, 34, 7, 2, '#291d36') + rect(16, 34, 8, 2, '#291d36') + rect(7, 33, 5, 1, gold) + rect(16, 33, 5, 1, gold) + rect(12, 34, 2, 1, gold) + rect(14, 34, 2, 1, gold) + rect(13, 33, 2, 2, '#f5dca9');
  if (shoes === 'glass') art += path('M4 33H7V34H12V36H5V35H4ZM16 34H21V33H24V35H23V36H16Z', '#b5dff5') + rect(5, 34, 6, 1, '#f6f0e7') + rect(17, 34, 6, 1, '#f6f0e7') + rect(6, 32, 3, 2, '#f5c6d6') + rect(19, 32, 3, 2, '#f5c6d6') + rect(7, 33, 1, 1, gold) + rect(20, 33, 1, 1, gold);
  if (shoes === 'greaves') art += rect(7, 30, 5, 5, '#c49765') + rect(16, 30, 5, 5, '#c49765') + rect(8, 30, 3, 4, gold) + rect(17, 30, 3, 4, gold) + rect(9, 30, 1, 2, '#f5dca9') + rect(18, 30, 1, 2, '#f5dca9') + rect(5, 34, 7, 2, '#ad536e') + rect(16, 34, 8, 2, '#ad536e') + rect(5, 35, 7, 1, '#c49765') + rect(16, 35, 8, 1, '#c49765');
  if (shoes === 'sabatons') art += path('M4 30H7V33H5V31H4ZM21 30H24V31H23V33H21Z', '#f6f0e7') + rect(7, 30, 5, 5, gold) + rect(16, 30, 5, 5, gold) + rect(8, 30, 3, 4, '#f5dca9') + rect(17, 30, 3, 4, '#f5dca9') + rect(7, 32, 5, 1, '#c49765') + rect(16, 32, 5, 1, '#c49765') + rect(4, 34, 8, 2, gold) + rect(16, 34, 9, 2, gold) + rect(5, 35, 7, 1, '#ad536e') + rect(16, 35, 8, 1, '#ad536e');
  art += path('M10 7H18V8H21V17H19V19H10V17H8V9H10Z', skin) + rect(7, 12, 2, 3, skin) + rect(20, 12, 2, 3, skin);
  if (style === 'cropped') art += path('M9 6H19V8H21V12H19V10H11V13H8V8H9Z', hair);
  if (style === 'long') art += rect(8, 7, 13, 3, hair) + rect(8, 9, 3, 8, hair) + rect(19, 9, 2, 9, hair);
  if (style === 'curls') art += path('M8 5H12V6H17V5H21V8H23V12H20V10H17V9H13V10H10V13H7V9H6V7H8Z', hair);
  if (style === 'braids') art += path('M8 6H20V8H21V11H19V9H10V11H8V6Z', hair) + rect(14, 6, 1, 2, dark);
  if (style === 'topknot') art += rect(12, 3, 5, 3, hair) + rect(13, 6, 3, 1, '#eee0c4') + path('M9 7H20V10H19V8H10V11H8V8H9Z', hair);
  if (style === 'pigtails') art += path('M8 6H20V9H18V10H11V9H8Z', hair) + rect(5, 5, 4, 4, hair) + rect(20, 5, 4, 4, hair) + rect(6, 7, 3, 2, '#de8aa5') + rect(20, 7, 3, 2, '#de8aa5') + rect(7, 8, 1, 1, '#f6f0e7') + rect(21, 8, 1, 1, '#f6f0e7');
  if (style === 'spacebuns') art += path('M5 2H10V7H5ZM19 2H24V7H19Z', hair) + path('M8 6H21V10H19V9H10V10H8Z', hair) + rect(8, 10, 2, 6, hair) + rect(19, 10, 2, 6, hair) + rect(7, 4, 2, 2, gold) + rect(20, 4, 2, 2, gold) + rect(6, 6, 4, 1, '#f5c6d6') + rect(19, 6, 4, 1, '#f5c6d6');
  if (style === 'waves') art += path('M7 5H19V6H22V9H24V12H20V10H18V9H10V12H8V7H7Z', hair);
  if (style === 'bob') art += path('M7 5H21V8H22V17H19V10H10V17H6V8H7Z', hair) + rect(9, 7, 10, 3, hair) + rect(18, 9, 3, 1, '#f6f0e7') + rect(19, 8, 1, 1, gold);
  if (style === 'updo') art += path('M10 1H19V6H10Z', hair) + path('M8 6H21V10H19V9H10V10H8Z', hair) + rect(8, 10, 1, 6, hair) + rect(20, 10, 1, 6, hair) + rect(10, 5, 9, 1, gold) + rect(11, 3, 2, 2, '#f5c6d6') + rect(16, 3, 2, 2, '#f6f0e7') + rect(14, 2, 2, 2, gold);
  if (style === 'locs') art += path('M8 5H20V7H22V15H20V9H16V10H13V9H10V15H7V7H8Z', hair) + rect(7, 16, 2, 5, hair) + rect(20, 16, 2, 5, hair) + rect(7, 18, 2, 1, gold) + rect(20, 18, 2, 1, gold);
  if (style === 'ringlets') art += path('M7 5H21V9H19V8H15V9H13V8H10V9H7Z', hair) + rect(6, 7, 3, 10, hair) + rect(20, 7, 3, 10, hair) + rect(7, 6, 2, 2, '#f5c6d6') + rect(20, 6, 2, 2, '#f5c6d6') + rect(8, 7, 1, 1, '#ad536e') + rect(20, 7, 1, 1, '#ad536e');
  if (style === 'hime') art += path('M8 5H21V10H8Z', hair) + rect(7, 8, 3, 9, hair) + rect(19, 8, 3, 9, hair) + path('M9 2H13V5H9ZM16 2H20V5H16Z', '#f5c6d6') + rect(13, 3, 3, 2, '#ad536e') + rect(8, 15, 2, 1, '#f5c6d6') + rect(19, 15, 2, 1, '#f5c6d6');
  art += rect(11, 12, 2, 2, dark) + rect(17, 12, 2, 2, dark) + rect(14, 16, 3, 1, dark);
  if (hat === 'beanie') art += path('M10 3H18V4H21V8H8V5H10Z', '#705486') + rect(7, 8, 15, 3, '#a385c7');
  if (hat === 'bow') art += path('M4 2H12V5H17V2H25V9H19V7H10V9H4Z', '#de8aa5') + path('M5 3H11V7H5ZM18 3H24V7H18Z', '#f5c6d6') + rect(12, 4, 5, 4, '#ad536e') + rect(13, 5, 3, 2, gold) + path('M10 8H13V12H9V10H10ZM16 8H19V10H20V12H16Z', '#ad536e');
  if (hat === 'beret') art += path('M6 4H19V5H23V9H7V6H6Z', '#de8aa5') + rect(8, 8, 13, 2, '#ad536e') + path('M13 1H16V3H18V4H12V3H13Z', '#538a84') + rect(10, 5, 1, 1, '#f6f0e7') + rect(15, 6, 1, 1, '#f6f0e7') + rect(19, 6, 1, 1, '#f6f0e7');
  if (hat === 'bandana') art += rect(8, 6, 13, 4, '#ad536e') + rect(5, 8, 3, 3, '#ad536e') + rect(4, 11, 3, 4, '#ad536e') + rect(11, 7, 2, 1, '#eee0c4');
  if (hat === 'flowercrown') art += rect(6, 7, 17, 2, '#538a84') + rect(7, 6, 3, 3, '#f5c6d6') + rect(11, 5, 3, 3, '#f6f0e7') + rect(15, 6, 3, 3, '#de8aa5') + rect(19, 6, 3, 3, '#f5c6d6') + rect(8, 7, 1, 1, gold) + rect(12, 6, 1, 1, gold) + rect(16, 7, 1, 1, '#f6f0e7') + rect(20, 7, 1, 1, gold) + rect(5, 9, 2, 5, '#f5c6d6') + rect(22, 9, 2, 5, '#f5c6d6');
  if (hat === 'straw') art += path('M1 9H4V7H8V5H12V3H17V5H21V7H25V9H28V11H1Z', gold) + rect(4, 9, 21, 1, '#c49765') + rect(8, 6, 13, 1, '#c49765') + rect(12, 4, 5, 1, '#f5dca9') + rect(9, 11, 1, 4, '#ad536e') + rect(19, 11, 1, 4, '#ad536e');
  if (hat === 'sunhat') art += path('M1 8H6V4H22V8H28V11H1Z', '#f5dca9') + rect(6, 7, 16, 2, '#de8aa5') + rect(2, 9, 25, 1, '#e6c480') + path('M18 6H24V11H21V14H18Z', '#f5c6d6') + rect(19, 7, 2, 2, '#ad536e') + rect(8, 6, 2, 2, '#f6f0e7');
  if (hat === 'tassel') art += path('M9 2H19V3H20V9H8V3H9Z', '#ad536e') + rect(8, 8, 12, 2, '#883b55') + rect(13, 1, 3, 1, gold) + rect(19, 3, 2, 1, gold) + rect(20, 4, 2, 6, dark) + rect(20, 9, 2, 1, gold);
  if (hat === 'cathood') art += path('M6 2H10V5H19V2H23V9H22V14H20V8H9V14H7V9H6Z', '#f6f0e7') + rect(7, 4, 2, 3, '#f5c6d6') + rect(20, 4, 2, 3, '#f5c6d6') + rect(9, 7, 11, 2, '#de8aa5') + rect(13, 7, 3, 3, gold) + rect(14, 8, 1, 1, dark);
  if (hat === 'tricorne') art += path('M2 8V5H6V2H11V4H17V2H22V5H26V9H2Z', '#432d57') + rect(2, 8, 24, 2, gold) + rect(12, 4, 4, 3, gold);
  if (hat === 'wreath') art += rect(7, 7, 3, 3, '#c49765') + rect(9, 6, 3, 3, gold) + rect(12, 7, 2, 2, '#f5dca9') + rect(15, 7, 2, 2, '#f5dca9') + rect(17, 6, 3, 3, gold) + rect(19, 7, 3, 3, '#c49765') + rect(13, 6, 3, 2, gold) + rect(5, 8, 2, 2, '#ad536e') + rect(4, 10, 2, 3, '#ad536e');
  if (hat === 'tiara') art += path('M7 7H9V5H11V6H13V2H16V6H18V5H20V7H22V9H7Z', '#f6f0e7') + rect(7, 8, 15, 1, gold) + rect(13, 4, 3, 3, '#de8aa5') + rect(14, 5, 1, 1, '#ad536e') + rect(9, 6, 2, 2, '#f5c6d6') + rect(18, 6, 2, 2, '#f5c6d6') + rect(14, 1, 1, 2, gold);
  if (hat === 'winged') art += path('M8 4H20V6H22V10H7V6H8Z', '#8e8296') + rect(13, 3, 3, 7, '#c49765') + rect(7, 9, 15, 2, '#c49765') + rect(14, 10, 2, 4, '#8e8296') + rect(8, 10, 2, 4, '#5e5368') + rect(19, 10, 2, 4, '#5e5368') + path('M3 4H5V6H7V9H4V7H3Z', '#eee0c4') + path('M24 4H26V7H25V9H22V6H24Z', '#eee0c4') + rect(6, 7, 2, 2, gold) + rect(21, 7, 2, 2, gold);
  if (hat === 'plumed') art += path('M2 8H7V4H19V7H27V10H2Z', '#432d57') + rect(2, 9, 25, 1, gold) + rect(12, 6, 4, 3, gold) + rect(13, 7, 2, 1, dark) + path('M4 2H14V4H10V6H3V4H4Z', '#f5dca9') + rect(1, 3, 4, 3, '#bf7892') + rect(6, 1, 6, 2, '#eee0c4');
  if (hat === 'crested') art += path('M6 0H21V2H23V6H20V4H8V6H5V2H6Z', '#ad536e') + rect(8, 1, 12, 1, '#eee0c4') + rect(10, 4, 9, 2, gold) + path('M8 5H20V7H22V11H7V7H8Z', gold) + rect(7, 9, 15, 1, '#c49765') + rect(8, 11, 2, 6, '#c49765') + rect(19, 11, 2, 6, '#c49765') + rect(14, 10, 2, 3, gold);
  if (hat === 'crown') art += path('M7 6H9V3H11V6H13V2H16V6H18V3H20V6H22V10H7Z', gold) + rect(13, 1, 3, 2, '#f5dca9') + rect(7, 8, 15, 2, '#c49765') + rect(9, 7, 2, 2, '#538a84') + rect(13, 6, 3, 3, '#ad536e') + rect(18, 7, 2, 2, '#538a84') + rect(7, 10, 1, 5, gold) + rect(21, 10, 1, 5, gold) + rect(7, 14, 1, 1, '#f5dca9') + rect(21, 14, 1, 1, '#f5dca9');
  return art;
}
export function petArt(pet = 'none') {
  const dark = '#291d36', gold = '#e6c480';
  if (pet === 'bunny') return path('M5 1H8V7H11V1H14V8H16V14H15V21H4V14H3V8H5Z', '#f6f0e7') + rect(6, 2, 1, 4, '#f5c6d6') + rect(12, 2, 1, 4, '#f5c6d6') + rect(10, 6, 5, 2, '#de8aa5') + rect(12, 6, 1, 2, '#ad536e') + rect(6, 10, 2, 2, dark) + rect(12, 10, 2, 2, dark) + rect(9, 12, 2, 1, '#de8aa5') + rect(5, 12, 1, 1, '#f5c6d6') + rect(14, 12, 1, 1, '#f5c6d6') + rect(16, 16, 3, 3, '#f6f0e7');
  if (pet === 'turtle') return path('M5 9H14V11H16V17H3V11H5Z', '#31515d') + rect(5, 11, 9, 5, '#538a84') + rect(6, 12, 3, 2, gold) + rect(10, 12, 3, 2, gold) + rect(2, 17, 15, 2, '#c49765') + path('M15 11H20V16H15Z', '#538a84') + rect(17, 12, 2, 2, dark) + rect(4, 19, 3, 3, '#538a84') + rect(12, 19, 3, 3, '#538a84') + rect(1, 16, 2, 2, '#538a84');
  if (pet === 'duckling') return path('M6 4H14V6H16V11H18V17H15V20H5V16H3V11H6Z', '#ffd88a') + path('M5 3H15V6H5Z', '#f5c6d6') + rect(9, 2, 3, 2, '#de8aa5') + rect(10, 3, 1, 1, '#f6f0e7') + rect(11, 7, 2, 2, dark) + rect(15, 8, 4, 2, '#f09c56') + rect(7, 12, 6, 4, gold) + rect(7, 20, 2, 2, '#f09c56') + rect(12, 20, 2, 2, '#f09c56');
  if (pet === 'cat') return path('M3 7V2H6V4H12V2H15V13H13V19H16V21H3V19H5V14H3Z', '#c49765') + rect(5, 8, 2, 2, dark) + rect(11, 8, 2, 2, dark) + rect(7, 12, 4, 1, '#eee0c4') + path('M13 16H17V11H20V18H16V20H13Z', '#c49765');
  if (pet === 'dog') return rect(4, 6, 12, 10, '#eee0c4') + rect(2, 6, 4, 7, '#9e674f') + rect(14, 6, 4, 7, '#9e674f') + rect(6, 15, 9, 6, '#c5b09d') + rect(6, 9, 2, 2, dark) + rect(12, 9, 2, 2, dark) + rect(9, 12, 3, 2, dark) + rect(4, 20, 13, 2, '#eee0c4');
  if (pet === 'kitten') return path('M4 2H7V4H13V2H16V12H4Z', '#f6f0e7') + rect(5, 3, 1, 2, '#f5c6d6') + rect(14, 3, 1, 2, '#f5c6d6') + rect(6, 7, 2, 2, dark) + rect(12, 7, 2, 2, dark) + rect(9, 9, 2, 1, '#de8aa5') + rect(5, 11, 10, 2, '#de8aa5') + rect(9, 11, 2, 2, gold) + path('M2 13H18V19H15V22H5V19H2Z', '#f5c6d6') + rect(3, 13, 14, 2, gold) + path('M18 14H21V18H18Z', gold) + rect(7, 16, 6, 3, '#ad536e');
  if (pet === 'parrot') return path('M6 3H14V5H16V13H13V20H11V24H8V20H5V11H3V7H6Z', '#538a84') + rect(12, 6, 2, 2, dark) + rect(14, 9, 5, 3, '#e6c480') + rect(6, 12, 4, 7, '#ad536e') + rect(6, 22, 8, 2, '#e6c480');
  if (pet === 'raven') return path('M7 3H14V5H16V11H14V17H11V22H6V18H4V9H7Z', dark) + rect(6, 9, 6, 7, '#432d57') + rect(7, 10, 4, 2, '#705486') + path('M14 5H20V8H14Z', '#c49765') + rect(11, 5, 2, 2, '#f5dca9') + rect(7, 8, 7, 1, gold) + rect(7, 21, 7, 2, gold);
  if (pet === 'fawn') return path('M3 3H6V6H12V3H15V6H13V12H17V18H15V22H13V18H7V22H5V14H4V6H3Z', '#d99c75') + rect(5, 5, 8, 2, '#538a84') + rect(6, 4, 2, 2, '#f5c6d6') + rect(10, 4, 2, 2, '#f6f0e7') + rect(6, 8, 2, 2, dark) + rect(10, 8, 2, 2, dark) + rect(8, 10, 2, 1, dark) + rect(6, 12, 6, 2, '#de8aa5') + rect(8, 12, 2, 2, gold) + rect(9, 14, 2, 1, '#f6f0e7') + rect(13, 14, 2, 1, '#f6f0e7') + rect(11, 16, 2, 1, '#f6f0e7');
  if (pet === 'owl') return path('M4 2H7V4H13V2H16V6H18V17H15V21H5V17H3V6H4Z', '#9e674f') + rect(5, 6, 4, 4, '#f5dca9') + rect(11, 6, 4, 4, '#f5dca9') + rect(6, 7, 2, 2, dark) + rect(12, 7, 2, 2, dark) + rect(9, 9, 2, 2, gold) + rect(6, 12, 8, 7, '#eee0c4') + rect(7, 13, 2, 1, '#68444a') + rect(11, 13, 2, 1, '#68444a') + rect(9, 15, 2, 1, '#68444a') + rect(2, 20, 16, 2, '#538a84') + rect(7, 20, 6, 2, gold);
  if (pet === 'monkey') return rect(6, 4, 9, 7, '#68444a') + rect(4, 6, 2, 3, '#d99c75') + rect(15, 6, 2, 3, '#d99c75') + rect(7, 6, 7, 5, '#d99c75') + rect(8, 7, 2, 2, dark) + rect(12, 7, 2, 2, dark) + rect(8, 1, 5, 3, '#ad536e') + rect(13, 2, 2, 2, gold) + rect(6, 11, 9, 7, '#ad536e') + rect(9, 11, 3, 6, '#eee0c4') + rect(7, 12, 1, 4, gold) + rect(13, 12, 1, 4, gold) + rect(6, 18, 3, 4, '#68444a') + rect(12, 18, 3, 4, '#68444a') + path('M15 16H19V11H21V18H15Z', '#68444a');
  if (pet === 'fox') return path('M4 2H7V5H11V2H14V7H16V11H3V7H4Z', '#a85c40') + rect(4, 3, 2, 2, '#eee0c4') + rect(12, 3, 2, 2, '#eee0c4') + rect(5, 9, 8, 3, '#eee0c4') + rect(6, 7, 2, 2, dark) + rect(11, 7, 2, 2, dark) + rect(8, 10, 2, 1, dark) + rect(5, 12, 9, 9, '#a85c40') + rect(5, 12, 9, 2, '#ad536e') + rect(8, 13, 3, 2, '#f5dca9') + rect(7, 15, 5, 6, '#eee0c4') + path('M14 14H17V9H21V15H19V20H14Z', '#a85c40') + rect(17, 9, 4, 3, '#eee0c4') + rect(19, 14, 2, 3, '#eee0c4');
  if (pet === 'unicorn') return path('M4 5H12V11H17V18H15V22H12V18H8V22H5V18H4Z', '#f6f0e7') + path('M7 0H9V3H10V5H6V3H7Z', gold) + path('M2 5H5V13H2Z', '#f5c6d6') + rect(3, 8, 2, 4, '#a385c7') + path('M17 11H21V17H18V15H17Z', '#f5c6d6') + rect(18, 13, 2, 3, '#a385c7') + rect(8, 7, 2, 2, dark) + rect(10, 9, 2, 1, '#f5c6d6') + rect(10, 12, 5, 4, '#f5c6d6') + rect(11, 13, 3, 2, gold);
  if (pet === 'calf') return path('M3 6H12V9H18V18H16V22H13V18H8V22H5V18H3Z', '#7c7287') + rect(6, 8, 5, 6, '#5e5368') + rect(4, 9, 2, 2, dark) + path('M1 4H4V7H3V13H1Z', '#7c7287') + rect(1, 12, 4, 2, '#eee0c4') + rect(10, 9, 6, 6, '#ad536e') + rect(11, 10, 4, 4, '#705486') + rect(10, 14, 6, 1, gold) + rect(5, 6, 3, 2, gold);
  return '';
}
export function characterSVG(config, label = 'Pixel character') {
  const hasPet = config.pet && config.pet !== 'none';
  return `<svg viewBox="0 0 52 44" role="img" aria-label="${escapeXML(label)}" shape-rendering="crispEdges" xmlns="http://www.w3.org/2000/svg"><g transform="translate(${hasPet ? 5 : 12} 4)">${characterArt(config)}</g><g transform="translate(33 23) scale(.8)">${petArt(config.pet)}</g></svg>`;
}
function sailEmblem(sailKey, hull) {
  if (sailKey === 'patched') {
    return rect(51, 20, 12, 9, '#eee0c4') + rect(52, 19, 2, 2, '#68444a') + rect(58, 19, 2, 2, '#68444a') + rect(52, 28, 2, 2, '#68444a') + rect(58, 28, 2, 2, '#68444a') + rect(72, 26, 13, 10, '#6b7d7a') + rect(71, 28, 2, 1, '#eee0c4') + rect(71, 33, 2, 1, '#eee0c4') + rect(56, 36, 14, 9, '#b56c52') + rect(58, 35, 2, 2, '#eee0c4') + rect(66, 35, 2, 2, '#eee0c4');
  }
  if (sailKey === 'tattered') {
    return path('M52 21H61V25H57V29H52ZM74 19H84V24H79V27H74ZM60 35H73V41H66V45H60Z', '#382d55') + rect(59, 22, 6, 1, '#c49765') + rect(58, 25, 6, 1, '#c49765') + rect(71, 36, 6, 1, '#c49765') + path('M46 47H55V51H46ZM78 46H86V51H78Z', '#382d55');
  }
  if (sailKey === 'checkered') {
    let checks = '';
    for (let y = 18; y <= 42; y += 8) {
      for (let x = 44; x <= 84; x += 10) {
        if (((x - 44) / 10 + (y - 18) / 8) % 2 === 0) checks += rect(x, y, 10, 8, '#9e523b');
      }
    }
    return checks + rect(50, 22, 38, 22, 'none');
  }
  if (sailKey === 'chevron') {
    return path('M44 20H52V25H60V30H76V25H84V20H92V26H84V31H76V36H60V31H52V26H44Z', '#a85c40') + path('M44 31H52V36H60V41H76V36H84V31H92V37H84V42H76V47H60V42H52V37H44Z', '#c85a53') + path('M52 26H60V31H76V26H84V30H76V35H60V30H52Z', '#e6c480');
  }
  if (sailKey === 'blossom') {
    return path('M64 19H72V25H78V33H72V39H75V45H68V40H61V45H64V39H58V33H64V25Z', '#ad536e') + path('M65 21H71V26H76V32H71V37H65V32H60V26H65Z', '#f6f0e7') + rect(66, 28, 4, 4, '#e6c480') + rect(50, 22, 3, 3, '#f6f0e7') + rect(83, 24, 3, 3, '#f6f0e7') + rect(53, 41, 3, 3, '#f6f0e7') + rect(80, 40, 3, 3, '#f6f0e7');
  }
  if (sailKey === 'heart') {
    return path('M56 22H65V26H71V22H80V32H75V38H71V43H65V38H61V32H56Z', '#ad536e') + path('M59 24H64V27H72V24H77V31H73V36H69V40H67V36H63V31H59Z', '#f5c6d6') + path('M46 28H56V32H50V35H46ZM80 28H90V35H86V32H80Z', '#e6c480') + rect(66, 28, 4, 4, '#f6f0e7');
  }
  if (sailKey === 'diamond') {
    return path('M64 18H72V23H78V29H84V36H78V42H72V47H64V42H58V36H52V29H58V23H64Z', '#e6c480') + path('M65 22H71V27H76V35H71V40H65V35H60V27H65Z', '#705486') + rect(65, 28, 6, 6, '#f5dca9');
  }
  if (sailKey === 'crescent') {
    return path('M62 19H74V22H67V26H64V36H67V40H74V43H62V40H57V35H55V27H57V22H62Z', '#f6f0e7') + path('M74 26H76V30H80V32H76V36H74V32H70V30H74Z', '#e6c480') + rect(48, 22, 2, 2, '#f5dca9') + rect(85, 24, 2, 2, '#f5dca9') + rect(50, 41, 2, 2, '#e6c480') + rect(83, 40, 2, 2, '#e6c480');
  }
  if (sailKey === 'totem') {
    return rect(65, 20, 6, 6, '#f5dca9') + rect(66, 21, 4, 4, '#e6c480') + path('M56 26H59V29H77V26H80V32H56Z', '#e6c480') + path('M65 32H71V36H74V41H77V46H59V41H62V36H65Z', '#e6c480');
  }
  if (sailKey === 'kraken') {
    return path('M61 19H75V24H78V32H58V24H61Z', '#ad536e') + rect(62, 27, 3, 3, '#f5dca9') + rect(71, 27, 3, 3, '#f5dca9') + path('M46 34H53V38H59V32H63V42H55V46H48V41H52V37H46ZM83 34H90V37H84V41H88V46H81V42H73V32H77V38H83ZM64 32H67V48H61V44H64ZM69 32H72V44H75V48H69Z', '#ad536e') + rect(50, 39, 2, 2, '#e6c480') + rect(84, 39, 2, 2, '#e6c480') + rect(62, 45, 2, 2, '#e6c480') + rect(72, 45, 2, 2, '#e6c480');
  }
  if (sailKey === 'sunburst') {
    return path('M66 19H70V24H75V21H78V26H83V30H78V35H83V39H78V44H75V41H70V46H66V41H61V44H58V39H53V35H58V30H53V26H58V21H61V24H66Z', '#e6c480') + rect(63, 27, 10, 11, '#f5dca9') + rect(65, 29, 6, 7, '#e6c480');
  }
  if (sailKey === 'griffin') {
    return path('M43 24H60V28H46V32H58V36H49V40H62V26H74V40H87V36H78V32H90V28H76V24H93V20H72V23H64V20H43Z', '#e6c480') + rect(62, 25, 12, 12, '#f5dca9') + rect(64, 27, 8, 8, '#c85a53') + path('M61 39H75V43H79V47H57V43H61Z', '#f5dca9');
  }
  if (sailKey === 'wave') {
    return rect(78, 21, 8, 8, '#ad536e') + path('M44 38H52V30H58V24H68V27H63V32H72V36H84V33H90V37H94V45H85V48H50V44H44Z', '#394570') + rect(50, 39, 36, 6, '#5b6ea6') + rect(58, 23, 11, 2, '#f6f0e7') + rect(68, 26, 4, 2, '#f6f0e7') + rect(72, 34, 6, 2, '#f6f0e7') + rect(84, 32, 6, 2, '#f6f0e7');
  }
  if (sailKey === 'serpent') {
    return path('M58 19H78V23H84V39H78V45H58V39H52V25H58V29H56V37H60V41H76V37H80V25H74V23H62V27H58Z', '#538a84') + rect(60, 20, 14, 2, '#e6c480') + rect(60, 42, 14, 2, '#e6c480') + rect(65, 29, 6, 6, '#f5dca9') + rect(67, 31, 2, 2, '#ad536e') + rect(61, 24, 2, 2, '#f5dca9');
  }
  if (sailKey === 'compass') {
    return path('M62 21H74V24H78V28H81V38H78V42H74V45H62V42H58V38H55V28H58V24H62Z', '#705486') + rect(59, 25, 18, 16, '#2b2347') + path('M67 18H69V26H74V24H76V29H84V31H76V36H74V34H69V48H67V34H62V36H60V31H52V29H60V24H62V26H67Z', '#e6c480') + rect(65, 29, 6, 6, '#f5dca9') + rect(46, 22, 2, 2, '#f5dca9') + rect(51, 39, 2, 2, '#e6c480') + rect(88, 23, 2, 2, '#f5dca9') + rect(85, 41, 2, 2, '#e6c480');
  }
  if (sailKey === 'phoenix') {
    return path('M65 18H71V23H77V19H85V23H91V28H83V32H88V36H76V41H81V47H73V42H69V48H67V42H63V47H55V41H60V36H48V32H53V28H45V23H51V19H59V23H65Z', '#e6c480') + path('M51 23H61V27H65V21H71V27H75V23H85V27H77V33H72V39H64V33H59V27H51Z', '#f5dca9') + rect(66, 25, 4, 9, '#f09c56');
  }
  if (sailKey === 'constellation') {
    return rect(41, 16, 56, 2, '#e6c480') + rect(50, 48, 36, 2, '#e6c480') + path('M56 22H80V24H56ZM52 32H84V34H52ZM58 42H78V44H58ZM67 19H69V47H67Z', '#394570') + path('M53 26L67 21L79 28L73 40L59 38Z', 'none') + rect(52, 25, 3, 3, '#f5dca9') + rect(66, 20, 4, 4, '#fff6d1') + rect(78, 27, 3, 3, '#f5dca9') + rect(72, 39, 3, 3, '#f5dca9') + rect(58, 37, 3, 3, '#f5dca9') + path('M54 26H67V28H54ZM68 22H79V28H77V24H68ZM73 28H75V40H73ZM59 38H73V40H59Z', '#e6c480');
  }
  let art = rect(66, 24, 3, 19, hull.shade) + path('M56 30H59V33H74V30H77V36H59V39H56Z', hull.shade);
  if (sailKey === 'indigo') art += rect(45, 44, 48, 2, '#eee0c4');
  if (sailKey === 'emerald') art += rect(41, 16, 56, 2, '#e6c480') + rect(50, 48, 35, 2, '#e6c480');
  return art;
}
function standardSail(sailKey, sail, hull, pattern) {
  let art = path('M38 16H100V47H97V51H88V54H49V51H41V47H38Z', sail.shade);
  art += path('M41 16H97V45H94V49H85V51H50V48H44V44H41Z', sail.color);
  if (pattern !== 'plain') {
    art += rect(48, 16, 3, 31, sail.shade) + rect(87, 16, 3, 31, sail.shade);
  }
  return art + sailEmblem(sailKey, hull);
}
export function shipArt(config = {}) {
  const hullKey = config.hull || 'cedar';
  const sailKey = config.sail || 'gold';
  const hull = HULLS[hullKey];
  const sail = SAILS[sailKey];
  const gold = '#e6c480', dark = '#291d36';

  if (hullKey === 'raft') {
    let art = path('M63 18H66V34H64V52H66V69H63V52H61V34H63Z', '#68444a') + rect(43, 24, 42, 2, '#8a623e');
    art += path('M66 18H77V20H73V22H66Z', '#ad536e');
    art += `<g transform="translate(21 12) scale(.68)">${standardSail(sailKey, sail, hull, config.pattern)}</g>`;
    art += rect(45, 27, 6, 5, '#c5b09d') + rect(77, 42, 5, 4, '#c5b09d');
    art += rect(38, 60, 12, 8, '#8a623e') + rect(39, 61, 10, 6, '#c49765') + rect(38, 63, 12, 1, '#68444a');
    art += rect(86, 54, 2, 14, '#8a623e') + rect(84, 51, 6, 4, '#f5dca9') + rect(85, 52, 4, 2, gold);
    for (let i = 0; i < 6; i++) {
      const x = 22 + i * 14, w = i % 2 ? 15 : 13, y = 69 + (i % 2);
      art += rect(x, y, w, 7, hull.shade) + rect(x + 1, y + 1, w - 2, 4, hull.color) + rect(x + 3, y + 2, 2, 2, '#c49765');
    }
    art += rect(20, 67, 88, 3, '#8a623e') + rect(32, 66, 3, 11, gold) + rect(62, 66, 3, 11, gold) + rect(92, 66, 3, 11, gold);
    art += path('M54 72H57V81H53V84H48V80H52V76H54Z', '#c49765');
    return art;
  }
  if (hullKey === 'tub') {
    let art = rect(65, 16, 2, 47, '#8a623e') + rect(46, 22, 40, 2, '#68444a');
    art += path('M60 12H72V16H69V18H63V16H60Z', '#c49765');
    art += `<g transform="translate(24 11) scale(.64)">${standardSail(sailKey, sail, hull, config.pattern)}</g>`;
    art += path('M40 56H94V65H91V73H85V78H49V73H43V65H40Z', hull.shade);
    art += path('M43 58H91V65H88V72H83V75H51V72H46V65H43Z', hull.color);
    for (let x = 49; x <= 84; x += 7) art += rect(x, 58, 1, 17, hull.shade);
    art += rect(39, 55, 56, 3, '#c49765') + rect(41, 62, 52, 2, '#8e8296') + rect(44, 70, 46, 2, '#8e8296');
    art += rect(36, 61, 4, 4, gold) + rect(94, 61, 4, 4, gold);
    art += rect(45, 53, 5, 3, '#eee0c4') + rect(51, 54, 4, 2, '#eee0c4') + rect(80, 53, 6, 3, '#eee0c4');
    art += path('M72 64H75V78H78V84H70V78H72Z', '#c49765');
    return art;
  }
  if (hullKey === 'coracle') {
    let art = rect(65, 14, 3, 48, '#785636') + rect(44, 21, 44, 2, '#8a623e');
    art += path('M68 14H80V17H75V19H68Z', sail.color);
    art += `<g transform="translate(21 10) scale(.68)">${standardSail(sailKey, sail, hull, config.pattern)}</g>`;
    art += path('M34 57H98V65H94V72H87V77H45V72H38V65H34Z', hull.shade);
    art += path('M38 59H94V65H90V71H84V74H48V71H42V65H38Z', hull.color);
    for (let x = 42; x <= 86; x += 6) {
      art += rect(x, 60, 3, 2, '#d9b382') + rect(x + 3, 63, 3, 2, '#d9b382') + rect(x, 66, 3, 2, '#d9b382') + rect(x + 3, 69, 3, 2, '#d9b382');
    }
    art += rect(33, 56, 66, 3, '#68444a') + rect(36, 56, 60, 1, gold) + path('M44 74H88V79H44Z', '#291d36');
    art += path('M64 64H67V78H71V84H61V78H64Z', '#c49765');
    return art;
  }
  if (hullKey === 'dinghy') {
    let art = rect(62, 10, 3, 54, '#614348') + path('M42 20H88V22H42Z', '#68444a') + path('M65 44H86V42H92V45H65Z', '#8a623e');
    art += path('M65 10H78V13H73V15H65Z', sail.color);
    art += `<g transform="translate(15 8) scale(.74)">${standardSail(sailKey, sail, hull, config.pattern)}</g>`;
    art += path('M26 57H32V61H96V56H102V53H108V57H105V64H100V71H93V76H37V72H30V65H26Z', hull.shade);
    art += path('M32 63H99V68H94V73H38V69H32Z', hull.color);
    art += rect(32, 61, 68, 2, gold) + rect(44, 60, 8, 2, '#8a623e') + rect(74, 60, 8, 2, '#8a623e');
    art += rect(48, 66, 9, 5, '#c89d66') + rect(49, 67, 1, 1, dark) + rect(55, 67, 1, 1, dark) + rect(49, 69, 1, 1, dark) + rect(55, 69, 1, 1, dark);
    art += rect(77, 65, 7, 4, '#6b7d7a') + rect(98, 56, 6, 4, '#eee0c4');
    art += path('M58 64h3v10h-3v9h-5v-4h3v-5h2ZM72 64h3v10h-3v9h-5v-4h3v-5h2Z', '#c49765');
    return art;
  }
  if (hullKey === 'papyrus') {
    let art = path('M58 5H61V64H58ZM69 5H72V64H69Z', '#8a623e') + rect(59, 6, 12, 3, gold) + rect(58, 12, 14, 2, '#68444a');
    art += rect(37, 14, 60, 2, '#8a623e') + path('M65 2H82V5H76V7H65Z', sail.color);
    art += `<g transform="translate(2 1)">${standardSail(sailKey, sail, hull, config.pattern)}</g>`;
    art += rect(22, 52, 18, 12, '#8a623e') + rect(24, 54, 14, 9, '#eee0c4') + rect(21, 50, 20, 3, gold);
    art += path('M6 39H15V43H11V50H15V57H22V62H110V56H116V49H121V41H118V37H129V42H125V51H121V60H115V68H107V74H97V78H35V74H24V68H16V59H10V50H7V43H6Z', hull.shade);
    art += path('M14 57H20V63H112V57H118V64H111V70H101V75H33V70H22V64H14Z', hull.color);
    art += rect(20, 62, 92, 2, '#f5dca9') + rect(26, 67, 80, 2, '#e6c480');
    for (let x = 22; x <= 110; x += 11) art += rect(x, 61, 2, 13, '#68444a');
    art += rect(8, 43, 6, 2, gold) + rect(119, 42, 6, 2, gold) + path('M4 36H16V39H4ZM117 34H131V37H117Z', '#538a84');
    art += path('M18 64H22V76H16V83H10V79H14V73H18Z', '#c49765');
    return art;
  }
  if (hullKey === 'fishing') {
    let art = rect(58, 4, 3, 60, '#614348') + rect(36, 13, 56, 3, '#68444a') + rect(58, 48, 38, 2, '#8a623e');
    art += path('M61 4H77V7H72V9H61Z', sail.color);
    art += `<g transform="translate(-3 0)">${standardSail(sailKey, sail, hull, config.pattern)}</g>`;
    art += path('M14 48H20V53H28V57H36V62H14Z', '#8a623e');
    for (let x = 16; x <= 34; x += 4) art += rect(x, 51, 1, 11, '#c5b09d') + rect(x, 50, 2, 2, '#c89d66');
    for (let y = 53; y <= 61; y += 3) art += rect(15, y, 20, 1, '#c5b09d');
    art += path('M114 55H124V45H133V48H126V58H114Z', '#68444a') + rect(131, 48, 1, 8, '#c5b09d') + rect(129, 56, 5, 5, '#f5dca9') + rect(130, 57, 3, 3, gold);
    art += path('M14 57H22V62H106V56H114V51H120V56H117V64H112V71H104V76H95V79H31V76H22V71H16V64H14Z', hull.shade);
    art += path('M20 64H109V69H103V74H94V76H32V73H24V69H20Z', hull.color);
    art += rect(22, 62, 86, 2, '#c49765') + rect(32, 71, 66, 2, hull.shade);
    art += rect(82, 55, 9, 7, '#8a623e') + rect(82, 57, 9, 1, dark) + path('M84 51H87V53H90V51H92V55H84Z', '#7ba4ba');
    art += rect(42, 54, 14, 8, '#68444a') + rect(40, 52, 18, 2, '#c49765') + rect(45, 56, 3, 3, '#f5dca9') + rect(50, 56, 3, 3, '#f5dca9');
    for (let i = 0; i < 4; i++) art += path(`M${42 + i * 12} 69h3v7h-3v7h-4v-3h2v-4h2Z`, '#c49765');
    return art;
  }
  if (hullKey === 'felucca') {
    let art = rect(62, 8, 3, 56, '#614348');
    art += path('M28 40H36V34H46V28H58V22H70V16H82V10H94V5H106V8H96V13H84V19H72V25H60V31H48V37H36V43H28Z', '#68444a');
    art += path('M106 5H120V8H114V11H106Z', sail.color);
    art += path('M32 42H42V36H54V30H66V24H78V18H90V12H102V47H96V51H86V54H48V51H38V47H32Z', sail.shade);
    art += path('M36 42H46V36H58V30H70V24H82V18H98V45H93V49H84V51H50V48H41V45H36Z', sail.color);
    if (config.pattern !== 'plain') art += rect(52, 32, 3, 18, sail.shade) + rect(86, 18, 3, 31, sail.shade);
    art += `<g transform="translate(8 5) scale(.88)">${sailEmblem(sailKey, hull)}</g>`;
    art += rect(18, 50, 22, 2, gold) + rect(20, 52, 18, 2, '#ad536e') + rect(20, 52, 2, 11, '#68444a') + rect(36, 52, 2, 11, '#68444a');
    art += path('M12 58H18V62H106V56H115V50H124V45H132V48H127V54H121V62H115V69H107V75H98V78H30V75H21V70H15V64H12Z', hull.shade);
    art += path('M18 64H112V68H105V73H96V75H31V72H23V68H18Z', hull.color);
    art += rect(20, 62, 90, 2, gold) + rect(28, 67, 74, 1, '#f5dca9');
    for (let i = 0; i < 4; i++) art += path(`M${48 + i * 11} 69h3v7h-3v7h-4v-3h2v-4h2Z`, '#c49765');
    art += path('M8 62H14V76H6V72H8Z', '#68444a');
    return art;
  }
  if (hullKey === 'outrigger') {
    let art = rect(62, 5, 3, 58, '#614348') + path('M34 12H102V15H34Z', '#8a623e') + path('M38 50H98V53H38Z', '#8a623e');
    art += path('M32 8H38V14H32ZM98 8H104V14H98Z', '#ad536e') + rect(65, 5, 16, 3, sail.color);
    art += standardSail(sailKey, sail, hull, config.pattern);
    art += path('M10 45H15V54H19V47H23V62H106V55H114V49H122V44H130V48H125V55H119V63H112V69H103V73H27V69H18V63H12V54H10Z', hull.shade);
    art += path('M20 62H109V66H102V70H28V66H20Z', hull.color);
    art += rect(24, 60, 82, 2, gold);
    for (let x = 30; x <= 96; x += 11) art += rect(x, 63, 5, 2, '#f5dca9');
    art += rect(41, 66, 3, 12, '#68444a') + rect(67, 66, 3, 12, '#68444a') + rect(93, 66, 3, 12, '#68444a');
    art += path('M28 76H108V79H103V83H33V79H28Z', '#8a623e') + rect(33, 77, 70, 3, gold) + rect(40, 76, 5, 3, '#ad536e') + rect(66, 76, 5, 3, '#ad536e') + rect(92, 76, 5, 3, '#ad536e');
    art += path('M22 65H26V77H21V82H16V77H22Z', '#c49765');
    return art;
  }
  if (hullKey === 'merchant') {
    let art = rect(64, 2, 3, 62, '#614348') + rect(35, 12, 67, 3, '#68444a');
    art += path('M104 56H112V50H120V44H128V38H134V41H128V47H120V53H112V58H104Z', '#614348');
    art += path('M109 44H131V58H127V61H112V58H109Z', sail.shade) + rect(111, 45, 18, 13, sail.color);
    art += path('M67 2H84V5H78V8H67Z', sail.color);
    art += standardSail(sailKey, sail, hull, config.pattern);
    art += path('M34 15H36V43H34ZM32 43H34V61H32ZM101 15H103V44H101ZM103 44H105V62H103Z', '#aa8a8f');
    for (let x = 44; x <= 86; x += 7) art += rect(x, 56, 5, 6, '#d99c75') + rect(x + 1, 54, 3, 2, '#a85c40');
    art += path('M8 40H16V44H13V52H26V58H98V53H112V48H120V55H117V65H112V73H104V79H92V82H34V79H22V73H15V65H10V54H8Z', hull.shade);
    art += path('M16 61H111V68H106V74H96V78H32V74H22V68H16Z', hull.color);
    art += rect(16, 59, 95, 2, gold) + rect(20, 66, 87, 2, hull.shade) + rect(24, 72, 78, 2, gold);
    for (let x = 28; x <= 92; x += 8) art += rect(x, 56, 2, 4, gold);
    art += path('M18 65H24V79H19V84H13V78H18Z', '#c49765');
    return art;
  }
  if (hullKey === 'rammed') {
    let art = rect(64, 1, 3, 66, '#614348') + rect(35, 12, 67, 3, '#68444a');
    art += path('M67 1H86V4H79V7H67Z', '#ad536e') + standardSail(sailKey, sail, hull, config.pattern);
    art += path('M34 15H36V43H34ZM32 43H34V61H32ZM101 15H103V44H101ZM103 44H105V62H103Z', '#aa8a8f');
    art += path('M8 44H16V47H12V53H18V57H24V62H98V54H114V49H120V56H118V65H114V71H108V76H100V79H30V76H21V71H15V64H9V54H8Z', hull.shade);
    art += path('M16 64H112V69H106V74H98V76H31V73H22V69H16Z', hull.color);
    art += rect(18, 62, 94, 2, gold) + rect(98, 52, 16, 2, gold);
    art += path('M112 66H131V69H136V72H129V74H134V77H110Z', gold) + rect(113, 70, 16, 2, '#c49765');
    art += rect(105, 57, 9, 4, '#eee0c4') + rect(108, 58, 3, 2, dark) + rect(105, 56, 9, 1, dark);
    for (let i = 0; i < 9; i++) {
      art += path(`M${29 + i * 8} 66h2v7h-2v6h-3v-3h1v-3h2Z`, '#e6c480');
      art += path(`M${33 + i * 8} 70h2v7h-2v7h-3v-3h1v-4h2Z`, '#c49765');
    }
    return art;
  }
  if (hullKey === 'lacquer') {
    let art = rect(60, 1, 3, 63, '#614348') + rect(98, 16, 2, 46, '#614348');
    art += rect(34, 12, 58, 3, '#68444a') + rect(88, 22, 26, 2, '#68444a');
    art += path('M63 1H82V4H75V7H63Z', gold);
    art += `<g transform="translate(-4 0)">${standardSail(sailKey, sail, hull, config.pattern)}</g>`;
    for (let y = 21; y <= 46; y += 6) art += rect(35, y, 56, 1, '#68444a');
    art += path('M89 24H113V49H109V52H93V49H89Z', sail.shade) + rect(91, 24, 20, 26, sail.color);
    for (let y = 29; y <= 47; y += 6) art += rect(90, y, 22, 1, '#68444a');
    art += rect(10, 44, 26, 19, '#682d47') + rect(14, 37, 18, 8, '#883b55');
    art += path('M4 42H39V45H6Z', gold) + path('M9 35H34V38H11Z', gold);
    art += rect(14, 47, 4, 4, '#f5dca9') + rect(21, 47, 4, 4, '#f5dca9') + rect(28, 47, 4, 4, '#f5dca9') + rect(19, 40, 6, 3, '#f5dca9');
    art += path('M10 56H36V62H104V54H122V51H127V62H122V69H115V75H105V79H32V76H22V71H15V65H10Z', hull.shade);
    art += path('M16 63H118V68H112V73H103V76H33V73H24V68H16Z', hull.color);
    art += rect(16, 61, 102, 2, gold) + rect(26, 69, 82, 2, gold) + rect(104, 52, 18, 2, gold);
    art += rect(4, 45, 3, 5, '#ad536e') + rect(5, 46, 1, 3, '#f5dca9') + rect(125, 53, 3, 5, '#ad536e') + rect(126, 54, 1, 3, '#f5dca9');
    art += path('M6 66H14V81H4V76H6Z', '#682d47') + rect(8, 68, 4, 10, gold);
    return art;
  }
  if (hullKey === 'dromon') {
    let art = rect(62, 3, 3, 60, '#614348') + rect(98, 16, 2, 44, '#614348');
    art += rect(34, 12, 62, 3, '#68444a') + path('M86 30H94V25H104V20H114V16H120V19H112V24H102V29H92V33H86Z', '#68444a');
    art += path('M65 3H85V6H78V9H65Z', '#c85a53');
    art += `<g transform="translate(-2 0)">${standardSail(sailKey, sail, hull, config.pattern)}</g>`;
    art += path('M90 32H100V26H110V21H118V47H112V50H94V46H90Z', sail.shade) + path('M93 32H102V26H115V46H110V48H96V45H93Z', sail.color);
    art += path('M54 50H57V53H60V50H63V53H66V50H69V53H72V50H75V62H54Z', '#4d3549') + rect(56, 54, 17, 7, '#705486') + rect(54, 53, 21, 1, gold);
    art += path('M10 47H17V51H14V57H22V62H104V55H116V52H123V59H118V66H112V72H104V77H94V79H32V76H22V71H15V64H10Z', hull.shade);
    art += path('M16 64H111V69H105V74H95V76H33V73H23V69H16Z', hull.color);
    art += rect(18, 62, 94, 2, gold) + path('M114 64H128V67H114Z', gold);
    art += rect(117, 51, 8, 6, gold) + rect(120, 52, 2, 2, dark);
    art += path('M125 52H131V49H136V53H138V57H133V60H127V56H125Z', '#c85a53') + path('M125 53H131V51H135V55H132V58H126Z', gold) + rect(125, 54, 6, 2, '#f5dca9');
    for (let i = 0; i < 8; i++) art += path(`M${30 + i * 9} 68h3v8h-3v7h-4v-3h2v-4h2Z`, '#c49765');
    return art;
  }
  if (hullKey === 'dragon') {
    let art = rect(64, 2, 3, 62, '#614348') + rect(34, 12, 68, 3, '#68444a') + rect(38, 51, 60, 2, '#68444a');
    art += path('M67 2H86V5H79V8H67Z', '#ad536e') + standardSail(sailKey, sail, hull, config.pattern);
    art += path('M34 15H36V43H34ZM32 43H34V61H32ZM101 15H103V44H101ZM103 44H105V62H103Z', '#aa8a8f');
    art += path('M4 42H12V37H19V42H15V46H19V52H15V57H23V62H108V56H115V47H119V37H124V33H132V37H136V41H129V43H135V47H126V51H122V61H117V69H110V75H101V79H31V76H21V70H14V63H9V52H4Z', hull.shade);
    art += path('M16 63H114V68H108V73H100V76H32V73H23V68H16Z', hull.color);
    art += rect(20, 67, 90, 1, hull.shade) + rect(24, 71, 82, 1, hull.shade);
    art += path('M118 48V38H123V34H131V38H135V41H128V44H134V47H125V51H118Z', gold) + rect(126, 37, 2, 2, '#ad536e') + rect(133, 42, 4, 1, '#ad536e');
    art += path('M10 57H5V46H9V39H17V43H12V48H16V57Z', gold);
    for (let i = 0; i < 8; i++) {
      const x = 23 + i * 11;
      art += rect(x, 59, 8, 8, dark) + rect(x + 1, 60, 6, 6, i % 2 ? '#ad536e' : '#eee0c4') + rect(x + 3, 62, 2, 2, gold);
      art += path(`M${x + 3} 69h3v7h-3v7h-4v-3h2v-4h2Z`, '#c49765');
    }
    return art;
  }
  if (hullKey === 'trireme') {
    let art = rect(62, 1, 3, 63, '#614348') + rect(102, 22, 2, 38, '#614348');
    art += rect(34, 12, 64, 3, '#68444a') + rect(92, 26, 22, 2, '#68444a');
    art += path('M65 1H85V4H78V7H65Z', gold);
    art += `<g transform="translate(-2 0)">${standardSail(sailKey, sail, hull, config.pattern)}</g>`;
    art += path('M93 28H113V46H109V49H97V46H93Z', sail.shade) + rect(95, 28, 16, 19, sail.color);
    art += path('M4 36H14V39H10V43H17V46H12V50H19V54H15V59H24V62H100V55H116V50H122V58H119V66H114V72H107V77H98V80H28V77H19V71H13V63H8V50H4Z', hull.shade);
    art += path('M15 64H113V69H107V74H98V77H29V74H20V69H15Z', hull.color);
    art += path('M6 38H15V40H8ZM8 44H17V46H10ZM10 50H19V52H12Z', gold) + rect(3, 40, 4, 8, '#ad536e');
    art += rect(22, 60, 82, 5, '#68444a') + rect(20, 59, 86, 2, gold);
    for (let x = 25; x <= 97; x += 8) art += rect(x, 61, 5, 3, gold) + rect(x + 1, 62, 3, 1, '#c49765');
    art += path('M114 63H128V66H114Z', '#c49765') + path('M113 68H133V71H138V74H131V76H136V79H110Z', gold) + rect(114, 72, 17, 2, '#c49765');
    art += rect(106, 56, 9, 4, '#eee0c4') + rect(109, 57, 3, 2, dark) + rect(106, 55, 9, 1, dark);
    for (let i = 0; i < 8; i++) {
      art += path(`M${26 + i * 9} 65h2v6h-2v5h-3v-2h1v-3h2Z`, '#f5dca9');
      art += path(`M${29 + i * 9} 68h2v7h-2v6h-3v-2h1v-4h2Z`, '#e6c480');
      art += path(`M${32 + i * 9} 71h2v7h-2v7h-3v-3h1v-4h2Z`, '#c49765');
    }
    return art;
  }
  if (hullKey === 'flagship') {
    let art = rect(64, 0, 3, 64, '#614348') + rect(22, 18, 2, 34, '#614348');
    art += rect(46, 3, 40, 2, '#68444a') + rect(35, 14, 67, 3, '#68444a') + path('M12 24H32V26H12Z', '#68444a');
    art += path('M67 0H84V3H78V5H67Z', gold);
    art += path('M48 5H84V13H48Z', sail.shade) + rect(50, 5, 32, 7, sail.color);
    art += `<g transform="translate(0 1)">${standardSail(sailKey, sail, hull, config.pattern)}</g>`;
    art += path('M14 26H30V42H14Z', sail.shade) + rect(16, 26, 12, 14, sail.color);
    art += path('M116 52H124V48H132V44H138V47H132V51H124V55H116Z', '#614348');
    art += path('M8 38H30V46H36V62H96V51H118V47H124V58H120V66H114V73H105V79H94V82H30V79H20V72H13V64H8Z', hull.shade);
    art += path('M14 62H115V69H109V75H98V79H30V75H20V69H14Z', hull.color);
    art += rect(7, 36, 24, 2, gold) + rect(7, 45, 29, 2, gold) + rect(8, 54, 28, 2, gold) + rect(96, 49, 24, 2, gold);
    art += rect(11, 40, 4, 4, '#f5dca9') + rect(17, 40, 4, 4, '#f5dca9') + rect(23, 40, 4, 4, '#f5dca9');
    art += rect(12, 48, 5, 4, '#f5dca9') + rect(20, 48, 5, 4, '#f5dca9') + rect(28, 48, 5, 4, '#f5dca9');
    art += rect(3, 36, 4, 7, gold) + rect(4, 38, 2, 4, '#f5dca9');
    art += rect(14, 60, 102, 2, gold) + rect(18, 68, 92, 2, gold);
    for (let i = 0; i < 6; i++) art += rect(40 + i * 9, 63, 4, 4, dark) + rect(41 + i * 9, 64, 2, 2, '#c49765');
    art += path('M120 49H129V45H135V49H130V54H122V57H119Z', gold) + rect(125, 46, 4, 4, '#c49765');
    return art;
  }
  if (hullKey === 'cataphract') {
    let art = rect(64, 3, 3, 60, '#614348') + rect(34, 12, 66, 3, '#68444a');
    art += path('M58 2H60V4H62V2H65V4H67V2H69V4H71V2H73V9H58Z', '#4d3549') + rect(58, 8, 15, 2, gold);
    art += path('M67 0H86V3H79V6H67Z', '#ad536e') + standardSail(sailKey, sail, hull, config.pattern);
    art += path('M12 40H15V43H18V40H21V43H24V40H27V43H30V60H12Z', '#4d3549') + rect(14, 45, 14, 14, '#705486') + rect(12, 43, 18, 2, gold) + rect(19, 48, 4, 5, '#f5dca9');
    art += path('M96 42H99V45H102V42H105V45H108V42H111V45H114V60H96Z', '#4d3549') + rect(98, 47, 14, 12, '#705486') + rect(96, 45, 18, 2, gold) + rect(103, 50, 4, 5, '#f5dca9');
    art += rect(114, 46, 10, 3, '#8a623e') + path('M116 42H126V45H122V51H118V45H116Z', gold) + rect(122, 43, 7, 1, '#eee0c4');
    art += path('M8 55H14V60H116V53H123V62H119V69H113V75H105V80H29V77H20V71H13V64H8Z', hull.shade);
    art += path('M14 62H115V68H109V74H101V77H30V74H21V68H14Z', hull.color);
    art += rect(14, 60, 102, 2, gold) + rect(18, 66, 94, 4, '#8e8296') + rect(18, 66, 94, 1, '#c0b3ca');
    for (let x = 22; x <= 106; x += 8) art += rect(x, 62, 4, 3, gold) + rect(x + 1, 68, 2, 2, dark);
    art += path('M113 64H132V67H137V71H130V73H136V76H128V79H110Z', gold) + rect(114, 68, 17, 3, '#c49765');
    for (let i = 0; i < 8; i++) {
      art += path(`M${30 + i * 9} 68h3v7h-3v6h-4v-3h2v-3h2Z`, '#e6c480');
      art += path(`M${34 + i * 9} 71h3v7h-3v7h-4v-3h2v-4h2Z`, '#c49765');
    }
    return art;
  }
  if (hullKey === 'treasure') {
    let art = rect(24, 14, 2, 46, '#614348') + rect(64, 0, 3, 62, '#614348') + rect(102, 12, 2, 48, '#614348');
    art += rect(10, 20, 28, 2, gold) + rect(36, 11, 58, 3, gold) + rect(88, 18, 28, 2, gold);
    art += path('M26 14H38V17H32V19H26Z', '#ad536e') + path('M67 0H88V3H80V6H67Z', gold) + path('M104 12H116V15H110V17H104Z', '#ad536e');
    art += path('M11 22H37V44H33V47H15V44H11Z', sail.shade) + rect(13, 22, 22, 23, sail.color);
    for (let y = 27; y <= 42; y += 5) art += rect(12, y, 24, 1, '#68444a');
    art += `<g transform="translate(0 -1)">${standardSail(sailKey, sail, hull, config.pattern)}</g>`;
    for (let y = 20; y <= 45; y += 5) art += rect(39, y, 54, 1, '#68444a');
    art += path('M89 20H115V45H111V48H93V45H89Z', sail.shade) + rect(91, 20, 22, 26, sail.color);
    for (let y = 25; y <= 45; y += 5) art += rect(90, y, 24, 1, '#68444a');
    art += rect(6, 44, 32, 18, '#682d47') + rect(10, 36, 24, 9, '#883b55') + rect(14, 29, 16, 8, '#ad536e');
    art += path('M2 42H40V45H4Z', gold) + path('M6 34H36V37H8Z', gold) + path('M10 27H32V30H12Z', gold);
    for (let x = 10; x <= 32; x += 6) art += rect(x, 47, 4, 4, '#f5dca9');
    art += rect(14, 39, 4, 3, '#f5dca9') + rect(20, 39, 4, 3, '#f5dca9') + rect(26, 39, 4, 3, '#f5dca9') + rect(19, 31, 6, 3, '#f5dca9');
    art += rect(96, 47, 20, 13, '#682d47') + path('M93 45H119V48H95Z', gold) + rect(100, 50, 4, 4, '#f5dca9') + rect(108, 50, 4, 4, '#f5dca9');
    art += path('M6 55H38V60H98V54H120V49H126V59H122V67H116V74H107V79H96V82H28V79H18V73H11V65H6Z', hull.shade);
    art += path('M12 62H118V68H112V74H102V78H28V74H18V68H12Z', hull.color);
    art += rect(10, 59, 110, 3, gold) + rect(16, 66, 98, 2, gold) + rect(22, 72, 86, 2, gold);
    for (let x = 40; x <= 92; x += 6) art += rect(x, 56, 2, 4, gold);
    art += path('M120 49V41H125V37H133V40H138V44H132V47H137V50H129V54H120Z', gold) + rect(128, 40, 2, 2, '#ad536e');
    art += rect(2, 45, 3, 5, '#ad536e') + rect(3, 46, 1, 3, '#f5dca9') + rect(117, 48, 3, 5, '#ad536e') + rect(118, 49, 1, 3, '#f5dca9');
    art += path('M4 65H12V82H2V76H4Z', gold) + rect(6, 67, 4, 12, '#c49765');
    return art;
  }

  let art = rect(64, 1, 3, 69, '#614348') + rect(35, 12, 67, 3, '#68444a');
  art += path('M67 1H84V4H78V7H67Z', sail.color);
  art += standardSail(sailKey, sail, hull, config.pattern);
  art += path('M34 15H36V43H34ZM32 43H34V61H32ZM101 15H103V44H101ZM103 44H105V62H103Z', '#aa8a8f');
  art += path('M10 58H16V63H109V57H115V50H121V47H128V50H125V55H121V65H117V71H111V77H103V81H33V78H23V74H16V68H10Z', hull.shade);
  art += path('M16 65H113V70H108V75H101V78H34V75H25V71H20V68H16Z', hull.color);
  art += rect(19, 64, 93, 2, '#e6c480') + rect(35, 73, 64, 2, hull.shade);
  for (let i = 0; i < 8; i++) art += path(`M${33 + i * 9} 69h3v8h-3v7h-4v-3h2v-4h2Z`, '#c49765');
  art += rect(103, 56, 5, 6, '#4d3549') + rect(104, 54, 3, 2, '#e6c480');
  if (hullKey === 'basalt') {
    art += rect(19, 64, 93, 2, '#c0b3ca') + rect(25, 70, 82, 2, '#8e8296') + rect(121, 47, 7, 3, '#c0b3ca');
    art += path('M114 68H129V71H134V74H125V77H112Z', '#c0b3ca') + rect(14, 52, 6, 6, '#291d36') + rect(15, 49, 4, 3, '#f5dca9');
  }
  return art;
}
export function shipSVG(config, label = 'Pixel ship') {
  return `<svg viewBox="0 0 144 100" role="img" aria-label="${escapeXML(label)}" shape-rendering="crispEdges" xmlns="http://www.w3.org/2000/svg"><g transform="translate(5 7)">${shipArt(config)}</g></svg>`;
}

export function sceneSVG(config, label = 'Your character and ship in a pixel-art harbour', { layers = false } = {}) {
  // Optional named layers let the homepage animate the same art. Default output
  // stays byte-for-byte identical for Voyages posters, previews and exports.
  const open = name => layers ? `<g class="scene-${name}">` : '';
  const close = layers ? '</g>' : '';
  const settingKey = config.setting || 'dusk';
  const setting = SETTINGS[settingKey];
  const isClassic = settingKey === 'dusk' || settingKey === 'moon';
  const isNight = ['dusk', 'moon', 'lanterns', 'aurora', 'eclipse', 'biolum', 'observatory', 'volcano'].includes(settingKey);
  const isDay = ['whitecliff', 'lagoon', 'noon', 'bazaar', 'canyon', 'ziggurat', 'citadel'].includes(settingKey);
  const isMorning = ['mist', 'blossom', 'dawn'].includes(settingKey);

  let art = rect(0, 0, 320, 192, setting.sky) + rect(0, 45, 320, 30, setting.upper) + rect(0, 75, 320, 40, setting.horizon);

  // Sun / Moon placement by time of day
  const crescentPath = 'M246 31H262V34H251V38H246V49H248V54H253V58H267V61H262V64H246V61H240V55H237V40H240V34H246Z';
  const discPath = 'M246 31H262V34H268V40H271V55H268V61H262V64H246V61H240V55H237V40H240V34H246Z';
  if (settingKey === 'eclipse') {
    art += path('M252 23H256V29H264V26H268V32H275V36H271V45H278V49H271V57H275V61H268V68H264V65H256V71H252V65H244V68H240V61H233V57H237V49H230V45H237V36H233V32H240V26H244V29H252Z', '#c85a53');
    art += path(discPath, setting.sun) + path('M247 34H261V37H265V42H267V53H265V58H261V61H247V58H243V53H241V42H243V37H247Z', '#120e24');
    art += rect(265, 35, 6, 6, '#f6f0e7') + rect(263, 37, 10, 2, '#f5dca9') + rect(267, 33, 2, 10, '#f5dca9');
  } else if (settingKey === 'monsoon') {
    art += rect(242, 26, 24, 14, '#5e738a');
  } else if (settingKey === 'ember') {
    art += path('M206 52H234V56H242V64H246V78H194V64H198V56H206Z', '#ff9e66') + path('M208 56H232V60H238V78H202V60H208Z', setting.sun);
  } else if (settingKey === 'dawn') {
    art += path('M226 50H278V54H266V58H238V54H226ZM238 42H266V46H238Z', '#f5dca9');
    art += path('M238 56H266V60H272V68H275V78H229V68H232V60H238Z', setting.sun);
  } else if (isMorning) {
    art += `<g transform="translate(-32 22)">${path(discPath, setting.sun)}</g>`;
  } else if (isDay) {
    art += `<g transform="translate(-44 -16)">${path(discPath, setting.sun)}</g>`;
  } else if (settingKey === 'moon' || settingKey === 'aurora' || settingKey === 'biolum' || settingKey === 'observatory') {
    art += path(crescentPath, setting.sun);
  } else {
    art += path(discPath, setting.sun);
  }

  art += open('stars');
  if (isClassic) {
    for (const [x, y] of [[21, 28], [71, 45], [152, 18], [211, 38], [289, 22], [109, 31]]) {
      art += rect(x, y, 1, 3, '#c4a8bb') + rect(x - 1, y + 1, 3, 1, '#c4a8bb');
    }
  } else if (isNight) {
    const starColor = settingKey === 'volcano' ? '#f09c56' : '#e8d8bd';
    for (const [x, y] of [[21, 28], [71, 45], [152, 18], [211, 38], [289, 22], [109, 31], [44, 14], [182, 27], [268, 15]]) {
      art += rect(x, y, 1, 3, starColor) + rect(x - 1, y + 1, 3, 1, starColor);
    }
    if (settingKey === 'biolum') {
      art += path('M18 8H58V14H98V20H146V27H196V34H232V40H184V34H136V27H88V20H46V14H18Z', '#23365c');
      art += path('M118 14H138V16H156V18H172V20H152V18H134V16H118Z', '#f6f0e7') + rect(172, 19, 4, 4, '#5ce6d8');
    }
    if (settingKey === 'observatory') {
      art += path('M38 18H68V19H94V25H68V20H38ZM126 14H158V22H184V23H156V16H126Z', '#5ca3b5');
      for (const [x, y] of [[38, 17], [68, 18], [94, 24], [126, 13], [157, 15], [184, 22]]) art += rect(x, y, 3, 3, '#fff6d1');
    }
  }
  art += close + open('clouds');
  if (isClassic) {
    art += path('M0 63H22V59H43V61H58V65H90V69H81V71H19V69H0Z', '#69506e');
    art += path('M124 46H145V42H165V45H176V49H192V51H149V49H124Z', '#73536e');
  } else {
    if (settingKey === 'aurora') {
      art += path('M14 22H78V25H136V21H198V25H142V28H72V25H14Z', '#538a84') + path('M32 34H96V31H164V35H220V38H158V34H92V37H32Z', '#8e6ca5');
    }
    if (settingKey === 'mist') {
      art += rect(8, 52, 118, 4, '#92adb8') + rect(148, 58, 144, 4, '#92adb8') + rect(28, 70, 176, 3, '#d2e4eb');
    }
    if (isDay) {
      const c1 = settingKey === 'bazaar' || settingKey === 'canyon' ? '#f7d8b5' : '#f6f0e7';
      const c2 = settingKey === 'bazaar' || settingKey === 'canyon' ? '#e3a878' : '#cfe6f5';
      art += path('M12 34H32V28H58V31H74V36H92V40H12Z', c1) + rect(16, 38, 72, 2, c2);
      art += path('M232 24H254V19H278V23H296V28H232Z', c1) + rect(236, 27, 56, 2, c2);
      art += path('M88 26H92V28H95V26H99V28H96V30H91V28H88ZM158 33H162V35H165V33H169V35H166V37H161V35H158Z', '#f6f0e7');
    }
    if (settingKey === 'monsoon') {
      art += path('M0 12H118V22H198V16H320V34H212V38H0Z', '#141a26') + path('M24 34H152V44H284V50H24Z', '#202938');
      art += path('M178 16H185V25H180V33H187V44H181V55H186V68H181V57H176V46H181V36H174V26H178Z', '#f5dca9');
      for (let i = 0; i < 16; i++) art += rect(12 + i * 19, 32 + (i % 4) * 11, 1, 9, '#8da6b8');
    }
    if (settingKey === 'ember' || settingKey === 'canal' || settingKey === 'dawn') {
      art += path('M16 48H54V44H92V48H116V52H16Z', '#f5dca9') + path('M132 38H176V34H218V39H132Z', '#e07a56');
    }
    if (settingKey === 'blossom') {
      art += path('M18 42H62V38H98V43H18Z', '#fae3eb');
      for (const [x, y] of [[34, 36], [64, 52], [96, 28], [142, 58], [186, 34], [218, 62], [276, 48]]) {
        art += rect(x, y, 3, 2, '#f5c6d6') + rect(x + 1, y + 1, 2, 2, '#de8aa5');
      }
    }
    if (settingKey === 'volcano') {
      art += path('M74 14H136V22H178V30H208V40H112V34H74Z', '#362129') + path('M92 26H128V48H100V38H92Z', '#522931');
      for (const [x, y] of [[96, 36], [108, 24], [122, 32], [138, 28], [152, 40], [204, 34]]) art += rect(x, y, 2, 2, '#f5dca9');
    }
  }
  art += close;

  // Horizon landforms & architectural skylines
  if (isClassic) {
    art += path('M0 98H19V91H27V87H33V91H40V96H61V90H73V84H80V89H86V94H103V101H128V106H320V122H0Z', '#644563');
    art += path('M238 98V82H243V75H250V82H256V94H263V86H270V79H278V85H285V94H290V75H294V63H301V75H306V93H312V88H320V124H225V105Z', '#503c59');
    for (const [x, y] of [[246, 85], [273, 89], [297, 79], [312, 98]]) art += rect(x, y, 2, 4, '#d6a280');
  } else if (settingKey === 'mist') {
    art += path('M0 102L28 64H38L58 92L76 54H88L114 90L130 66H140L164 108H320V120H0Z', '#2f4354');
    art += path('M26 68H40V75H33V71H26ZM74 58H90V67H82V63H74ZM128 70H142V77H134V73H128Z', '#e4eff2');
    art += path('M14 96H44V108H14ZM20 88H38V96H20ZM25 80H33V88H25Z', '#4a352b') + path('M12 95H46V97H12ZM18 87H40V89H18ZM23 78H35V80H23Z', '#8a623e');
    art += path('M216 106L238 72H248L268 98L288 60H300L320 92V120H210Z', '#263847');
    for (const [x, y, w, h] of [[226, 98, 14, 12], [244, 94, 16, 16], [264, 98, 14, 12], [284, 90, 18, 20], [304, 96, 14, 14]]) {
      art += rect(x, y, w, h, '#593e31') + path(`M${x - 2} ${y}L${x + w / 2} ${y - 8}L${x + w + 2} ${y}Z`, '#3b4f41') + rect(x + 4, y + 4, 3, 4, '#f5dca9');
    }
  } else if (settingKey === 'whitecliff') {
    art += path('M0 88H48V94H96V102H138V115H0ZM212 96H252V88H320V116H204Z', '#8c6550') + rect(0, 86, 48, 3, '#537a4c') + rect(252, 86, 68, 3, '#537a4c');
    for (const [x, y, w, h] of [[8, 72, 16, 16], [26, 76, 14, 14], [44, 80, 18, 14], [64, 86, 16, 14], [82, 90, 14, 12]]) {
      art += rect(x, y, w, h, '#f6f0e7') + rect(x + w - 4, y, 4, h, '#d8d0c5') + rect(x + 3, y + 4, 3, 4, '#2d68a8') + rect(x + 8, y + 4, 3, 4, '#2d68a8');
    }
    art += path('M10 68H22V72H10ZM46 76H60V80H46Z', '#2d68a8');
    art += rect(102, 76, 10, 18, '#f6f0e7') + path('M100 72H114V76H100Z', '#c85a53') + path('M94 66H100V72H94ZM114 66H120V72H114ZM94 80H100V86H94ZM114 80H120V86H114Z', '#eee0c4');
    for (const [x, y, w, h] of [[222, 82, 16, 18], [240, 76, 18, 22], [260, 70, 16, 24], [278, 74, 18, 20], [298, 66, 20, 26]]) {
      art += rect(x, y, w, h, '#f6f0e7') + rect(x + w - 4, y, 4, h, '#d8d0c5') + rect(x + 4, y + 5, 3, 5, '#2d68a8') + rect(x + 10, y + 5, 3, 5, '#2d68a8');
    }
    art += path('M242 70H256V76H242ZM280 68H294V74H280Z', '#2d68a8') + rect(264, 54, 8, 16, '#f6f0e7') + path('M262 50H274V54H262Z', '#2d68a8') + rect(267, 57, 2, 5, '#1e5c8a');
  } else if (settingKey === 'lagoon') {
    art += path('M0 105H152V115H0ZM208 104H320V115H208Z', '#f2cf88') + rect(0, 103, 146, 3, '#4c8f58') + rect(214, 102, 106, 3, '#4c8f58');
    art += rect(28, 76, 3, 28, '#785038') + path('M16 72H42V76H36V79H22V76H16Z', '#2d7a53') + rect(96, 80, 3, 25, '#785038') + path('M84 76H110V80H104V83H90V80H84Z', '#2d7a53');
    art += rect(52, 92, 24, 10, '#c89d66') + path('M46 84H82V92H46Z', '#8a623e') + rect(56, 102, 2, 12, '#68444a') + rect(70, 102, 2, 12, '#68444a') + rect(48, 106, 38, 2, '#8a623e');
    for (const [x, y] of [[224, 90], [256, 86], [288, 90]]) {
      art += rect(x, y, 20, 11, '#c89d66') + path(`M${x - 4} ${y - 7}H${x + 24}V${y}H${x - 4}Z`, '#8a623e') + rect(x + 3, y + 11, 2, 12, '#68444a') + rect(x + 15, y + 11, 2, 12, '#68444a') + rect(x + 7, y + 3, 5, 5, '#f5dca9');
    }
    art += rect(218, 105, 98, 2, '#a8794c');
  } else if (settingKey === 'noon') {
    art += path('M0 88H98V96H136V115H0ZM212 92H256V84H320V115H204Z', '#5a7052') + rect(0, 94, 96, 18, '#b8ab9c') + rect(212, 94, 108, 18, '#b8ab9c');
    art += path('M22 64H74V68H22ZM18 68H78V71H18Z', '#d99c75') + rect(20, 71, 56, 3, '#f6f0e7') + rect(18, 86, 60, 4, '#d8d0c5');
    for (let x = 22; x <= 70; x += 8) art += rect(x, 74, 4, 12, '#f6f0e7');
    art += rect(92, 72, 3, 22, '#354f39') + rect(90, 66, 7, 10, '#263d29') + rect(104, 76, 3, 18, '#354f39') + rect(102, 70, 7, 10, '#263d29');
    art += rect(224, 78, 44, 16, '#f6f0e7') + path('M220 73H272V78H220Z', '#c86d51');
    for (let x = 228; x <= 262; x += 7) art += rect(x, 80, 3, 12, '#8c7f73');
    art += rect(282, 58, 14, 36, '#f6f0e7') + rect(284, 48, 10, 10, '#e6ded3') + rect(286, 42, 6, 6, '#ffd86b') + rect(304, 68, 14, 26, '#f6f0e7') + path('M302 64H320V68H302Z', '#c86d51');
  } else if (settingKey === 'bazaar') {
    art += path('M0 96H144V115H0ZM202 92H320V115H202Z', '#b87648');
    art += rect(10, 80, 38, 22, '#e3aa74') + path('M16 70H42V74H46V80H12V74H16Z', '#e6c480') + rect(28, 64, 2, 6, '#fff0bd');
    art += rect(52, 74, 8, 28, '#d99b66') + rect(50, 70, 12, 4, '#538a84') + rect(53, 64, 6, 6, '#e6c480');
    for (let x = 66; x <= 114; x += 16) {
      art += rect(x, 90, 14, 14, '#c98855') + rect(x - 1, 87, 8, 4, '#ad536e') + rect(x + 7, 87, 8, 4, '#eee0c4') + rect(x + 4, 95, 5, 9, '#4a251d');
    }
    art += rect(216, 76, 36, 28, '#d99b66') + path('M222 64H246V69H250V76H218V69H222Z', '#538a84') + rect(233, 58, 2, 6, '#e6c480');
    art += rect(258, 56, 9, 48, '#e3aa74') + rect(256, 66, 13, 3, '#538a84') + rect(259, 48, 7, 8, '#538a84') + rect(262, 43, 1, 5, '#e6c480');
    art += rect(272, 72, 22, 32, '#c98855') + rect(275, 62, 12, 10, '#e3aa74') + rect(277, 64, 3, 6, '#4a251d') + rect(282, 64, 3, 6, '#4a251d');
    art += rect(298, 78, 20, 26, '#d99b66') + path('M300 68H316V78H300Z', '#e6c480');
    for (const [x, y] of [[224, 84], [236, 84], [278, 82], [304, 84]]) art += rect(x, y, 4, 7, '#4a251d');
  } else if (settingKey === 'canyon') {
    art += path('M0 68H54V76H96V86H138V115H0Z', '#8f493f') + rect(0, 74, 54, 4, '#cc7a57') + rect(0, 88, 96, 4, '#b8644d') + rect(108, 94, 16, 21, setting.horizon);
    for (const [x, y, w, h] of [[8, 80, 18, 12], [28, 76, 16, 16], [58, 86, 20, 14], [80, 90, 14, 10]]) {
      art += rect(x, y, w, h, '#e39d6b') + rect(x, y + 2, w, 1, '#68352b') + rect(x + 4, y + 5, 3, 4, '#3b1c18') + rect(x + 11, y + 5, 3, 4, '#3b1c18');
    }
    art += path('M212 60H320V115H204L212 60Z', '#783830') + rect(210, 68, 110, 4, '#b8644d');
    art += rect(228, 66, 56, 42, '#592622') + path('M232 68H280V73H232ZM230 82H282V86H230Z', '#d9885f') + path('M244 74H268V82H244Z', '#cc7a57');
    for (let x = 234; x <= 276; x += 8) art += rect(x, 73, 3, 9, '#e39d6b') + rect(x, 86, 3, 18, '#e39d6b');
    art += rect(252, 92, 8, 12, '#2b1111') + rect(222, 98, 4, 6, '#ffd88a') + rect(286, 98, 4, 6, '#ffd88a');
  } else if (settingKey === 'monsoon') {
    art += path('M0 90L24 62H34L54 96L76 70H84L104 102L122 82H130L148 115H0Z', '#1f2836') + rect(18, 110, 118, 4, '#d8e6ed');
    art += path('M206 94H224V76H258V84H284V64H308V78H320V116H200Z', '#232e3d');
    for (let x = 224; x <= 306; x += 8) art += rect(x, 72, 4, 4, '#232e3d');
    art += rect(292, 54, 6, 10, '#364559') + path('M294 48H314V53H304V56H294Z', '#f5dca9') + rect(296, 50, 10, 3, '#e06246');
    for (const [x, y] of [[234, 84], [246, 84], [292, 74], [300, 74]]) art += rect(x, y, 2, 5, '#f5dca9');
  } else if (settingKey === 'canal') {
    art += rect(0, 96, 78, 19, '#6e4555') + path('M76 98H146V104H136V108H126V115H76Z', '#d9c5b2');
    art += path('M82 104H132V115H82Z', setting.horizon) + path('M88 90H126V98H88Z', '#f2e4d5') + rect(94, 92, 4, 5, '#543861') + rect(104, 92, 4, 5, '#543861') + rect(114, 92, 4, 5, '#543861');
    art += rect(12, 72, 26, 26, '#c4745c') + rect(40, 66, 28, 32, '#d9936a') + rect(14, 70, 22, 2, '#f2e4d5') + rect(42, 64, 24, 2, '#f2e4d5');
    art += rect(216, 42, 12, 68, '#b85d4b') + path('M214 40H230V44H214ZM218 26H226V40H218ZM220 18H224V26H220Z', '#52877f') + rect(219, 46, 6, 8, '#f2e4d5');
    for (const [x, y, w, h, c] of [[232, 74, 26, 36, '#e39d78'], [260, 68, 28, 42, '#c9715d'], [290, 72, 28, 38, '#e6b38a']]) {
      art += rect(x, y, w, h, c) + rect(x, y - 2, w, 2, '#f6f0e7');
      for (let wx = x + 4; wx <= x + w - 6; wx += 6) art += rect(wx, y + 6, 3, 6, '#3b2338') + rect(wx, y + 16, 3, 6, '#f5dca9');
    }
    for (let x = 208; x <= 312; x += 18) art += rect(x, 102, 2, 12, '#883b55') + rect(x, 104, 2, 2, '#f6f0e7') + rect(x, 108, 2, 2, '#f6f0e7');
  } else if (settingKey === 'ember') {
    art += path('M0 92H44V84H88V94H122V115H0Z', '#3b1d2e');
    art += rect(92, 76, 18, 34, '#59293d') + rect(95, 58, 12, 18, '#78394e') + rect(97, 46, 8, 12, '#fff0bd') + rect(93, 56, 16, 2, '#e6c480') + rect(90, 74, 22, 2, '#e6c480');
    art += path('M40 34L97 48V54L40 44ZM105 48L168 34V44L105 54Z', '#f5dca9');
    art += path('M212 96H236V78H264V86H292V70H320V116H204Z', '#3b1d2e');
    art += path('M240 66H260V78H240Z', '#6e3247') + rect(248, 60, 4, 6, '#e6c480') + path('M216 74H230V77H224V96H221V77H216Z', '#6e3247');
    for (const [x, y] of [[242, 82], [252, 82], [270, 90], [280, 90], [298, 78], [308, 78]]) art += rect(x, y, 4, 6, '#ffd88a');
  } else if (settingKey === 'blossom') {
    art += path('M0 94H64V88H112V98H146V115H0Z', '#454a66');
    art += path('M8 78H42V92H8ZM52 80H82V94H52ZM112 84H138V96H112Z', '#f5c6d6') + path('M14 82H38V90H14ZM56 84H78V92H56Z', '#de8aa5');
    art += rect(88, 78, 22, 20, '#59334d') + rect(91, 66, 16, 12, '#6e405e') + rect(94, 56, 10, 10, '#854f72') + rect(98, 48, 2, 8, '#e6c480');
    art += path('M82 76H116V79H82ZM86 64H112V67H86ZM90 54H108V57H90Z', '#e6c480');
    art += rect(126, 94, 2, 18, '#c85a53') + rect(138, 94, 2, 18, '#c85a53') + rect(122, 92, 20, 3, '#c85a53') + rect(124, 97, 16, 2, '#c85a53');
    art += path('M216 96L224 82H312L320 96V116H212Z', '#6e687d') + rect(216, 96, 104, 16, '#4f495e');
    art += rect(244, 68, 36, 16, '#f6f0e7') + rect(250, 56, 24, 12, '#f6f0e7') + rect(254, 46, 16, 10, '#f6f0e7');
    art += path('M238 66H286V70H238ZM244 54H280V58H244ZM248 43H276V47H248Z', '#2d283e');
    art += path('M218 76H240V88H218ZM286 74H314V88H286Z', '#f5c6d6');
  } else if (settingKey === 'lanterns') {
    art += rect(0, 98, 138, 18, '#291a2e') + rect(206, 98, 114, 18, '#291a2e');
    for (const [x, y, w, h] of [[8, 68, 34, 30], [46, 74, 30, 24], [80, 64, 36, 34], [218, 66, 34, 32], [256, 60, 36, 38], [294, 70, 24, 28]]) {
      art += rect(x, y, w, h, '#4a2033') + path(`M${x - 4} ${y}H${x + w + 4}V${y + 3}H${x - 4}ZM${x - 2} ${y + 12}H${x + w + 2}V${y + 15}H${x - 2}Z`, '#241426');
      art += rect(x + 4, y + 5, w - 8, 5, '#f5dca9') + rect(x + 4, y + 17, w - 8, 6, '#e69b63');
    }
    for (let x = 10; x <= 118; x += 12) art += rect(x, 82, 3, 4, '#c85a53') + rect(x + 1, 83, 1, 2, '#fff0bd');
    for (let x = 216; x <= 312; x += 12) art += rect(x, 78, 3, 4, '#c85a53') + rect(x + 1, 79, 1, 2, '#fff0bd');
  } else if (settingKey === 'volcano') {
    art += path('M0 98L28 74H48L68 96L94 46H122L152 108H0Z', '#2b1822') + path('M94 46H122V52H116V56H100V52H94Z', '#f5dca9');
    art += path('M102 52H110V66H115V84H108V68H104V92H97V70H102Z', '#e06246');
    art += path('M208 104V82H224V64H238V82H252V70H272V56H284V74H302V62H314V80H320V116H204Z', '#261520');
    art += rect(216, 92, 98, 4, '#e06246') + rect(230, 64, 3, 28, '#f09c56') + rect(276, 56, 4, 36, '#f09c56') + rect(306, 62, 3, 30, '#f09c56');
  } else if (settingKey === 'aurora') {
    art += path('M0 106V82H24V68H44V86H64V74H82V92H106V64H124V84H142V115H0Z', '#c9ebe7');
    art += rect(24, 74, 18, 34, '#7bb5b3') + rect(64, 80, 16, 28, '#538a84') + rect(106, 70, 16, 38, '#7bb5b3');
    art += path('M210 102L232 76H264L284 92L304 70H320V116H204Z', '#9ec9c6');
    for (const [x, y] of [[224, 92], [250, 88], [278, 92], [300, 86]]) {
      art += path(`M${x} ${y + 12}L${x + 10} ${y}L${x + 20} ${y + 12}Z`, '#4a352b') + path(`M${x + 2} ${y + 6}L${x + 10} ${y - 2}L${x + 18} ${y + 6}Z`, '#e4eff2') + rect(x + 8, y + 6, 4, 4, '#ffd88a');
    }
  } else if (settingKey === 'ziggurat') {
    art += rect(0, 102, 152, 14, '#ab8150') + rect(204, 100, 116, 16, '#ab8150');
    art += rect(16, 86, 84, 16, '#c8965b') + rect(28, 72, 60, 14, '#d9aa6c') + rect(40, 58, 36, 14, '#e6bc7e') + rect(48, 48, 20, 10, '#2b6e8c');
    art += rect(54, 48, 8, 54, '#f2d399') + rect(56, 42, 4, 6, '#fff6d1');
    art += rect(218, 74, 28, 28, '#2b6e8c') + rect(246, 82, 42, 20, '#c8965b') + rect(288, 74, 28, 28, '#2b6e8c');
    art += rect(218, 72, 28, 3, '#e6c480') + rect(246, 80, 42, 3, '#e6c480') + rect(288, 72, 28, 3, '#e6c480');
    art += rect(226, 84, 12, 18, '#1a3b4d') + rect(296, 84, 12, 18, '#1a3b4d') + path('M208 54H212V100H208ZM264 50H268V82H264Z', '#e6c480');
  } else if (settingKey === 'eclipse') {
    art += path('M0 94H136V115H0ZM206 94H320V115H206Z', '#261833');
    for (const [x, h] of [[18, 28], [34, 28], [58, 32], [74, 32], [98, 24], [112, 24]]) art += rect(x, 94 - h, 5, h, '#3d2852');
    art += rect(15, 62, 27, 5, '#52386b') + rect(55, 58, 27, 5, '#52386b') + rect(95, 66, 24, 4, '#52386b');
    art += rect(224, 80, 76, 16, '#362147') + rect(238, 66, 48, 14, '#452b59') + rect(250, 52, 24, 14, '#56366e');
    art += path('M248 42H253V52H248ZM271 42H276V52H271Z', '#c85a53') + rect(258, 44, 8, 6, '#f5dca9');
  } else if (settingKey === 'biolum') {
    art += path('M0 72H48V82H92V94H134V115H0Z', '#142438') + rect(18, 92, 26, 23, setting.horizon) + rect(62, 98, 22, 17, setting.horizon);
    for (const [x, y, h] of [[12, 76, 14], [38, 78, 10], [54, 84, 16], [84, 88, 12], [112, 96, 10]]) art += rect(x, y, 2, h, '#5ce6d8');
    art += path('M214 96V74H226V58H236V74H252V84H268V64H280V48H290V64H304V78H320V116H208Z', '#162840');
    for (const [x, y] of [[229, 64], [272, 70], [283, 56], [296, 84], [310, 88]]) art += rect(x, y, 3, 5, '#7cf5e6');
  } else if (settingKey === 'observatory') {
    art += path('M0 92H96V102H136V115H0Z', '#24344d');
    art += rect(18, 72, 34, 22, '#3b506b') + path('M20 58H50V64H52V72H18V64H20Z', '#52877f') + rect(33, 56, 4, 16, '#182038') + path('M34 48H46V52H38V60H34Z', '#e6c480');
    art += path('M72 64H88V68H92V80H88V84H72V80H68V68H72Z', '#e6c480') + rect(72, 68, 16, 12, setting.upper) + rect(79, 60, 2, 32, '#e6c480') + rect(66, 73, 28, 2, '#e6c480');
    art += rect(206, 88, 114, 26, '#2d4059');
    for (let x = 212; x <= 260; x += 12) art += rect(x, 94, 6, 18, setting.horizon);
    art += rect(268, 62, 22, 32, '#3b506b') + path('M270 50H288V62H270Z', '#52877f') + rect(276, 68, 6, 6, '#fff0bd') + rect(296, 70, 20, 24, '#3b506b') + path('M298 60H314V70H298Z', '#52877f');
  } else if (settingKey === 'citadel') {
    art += rect(0, 96, 74, 19, '#7a5c58') + rect(84, 92, 10, 22, '#d6c2b8') + rect(110, 92, 10, 22, '#d6c2b8');
    for (let x = 6; x <= 62; x += 12) art += rect(x, 82, 4, 14, '#bfa59b') + rect(x, 80, 12, 3, '#d6c2b8');
    art += path('M88 78H96V62H108V78H116V92H108V78H96V92H88Z', '#c49765') + rect(98, 54, 8, 8, '#e6c480');
    art += rect(108, 44, 3, 20, '#c49765') + path('M105 36H115V44H105Z', '#fff0b8') + rect(107, 38, 6, 4, '#e06246');
    art += rect(212, 82, 108, 32, '#bfa59b') + rect(212, 80, 108, 3, '#e6c480');
    art += path('M228 66H256V80H228ZM276 62H308V80H276Z', '#d6c2b8') + path('M232 54H252V66H232ZM280 48H304V62H280Z', '#e6c480');
    for (let x = 218; x <= 310; x += 10) art += rect(x, 86, 4, 12, '#5e4247');
  } else if (settingKey === 'dawn') {
    art += path('M0 94H52V86H96V98H138V115H0Z', '#6e4d63');
    art += rect(22, 74, 24, 18, '#d9b8b6') + path('M18 70H50V74H18Z', '#b86b6b') + rect(56, 66, 4, 22, '#3d4a3d') + rect(66, 70, 4, 18, '#3d4a3d');
    art += path('M212 96H244V82H284V74H320V116H204Z', '#5e4257');
    art += rect(248, 68, 28, 22, '#d9b8b6') + path('M244 64H280V68H244Z', '#b86b6b') + rect(286, 52, 10, 32, '#d9b8b6') + path('M284 46H298V52H284Z', '#b86b6b');
    for (const [x, y] of [[28, 78], [36, 78], [254, 72], [264, 72], [290, 56]]) art += rect(x, y, 3, 5, '#fae6be');
  }

  art += rect(0, 115, 320, 77, setting.sea) + rect(0, 115, 320, 2, setting.wave);
  art += open('waves');
  const highlightWave = settingKey === 'biolum' ? '#7cf5e6' : settingKey === 'monsoon' ? '#d8e6ed' : settingKey === 'volcano' ? '#f09c56' : settingKey === 'lanterns' ? '#f5dca9' : isDay ? '#ffffff' : '#a385a7';
  for (let i = 0; i < 65; i++) {
    const x = (i * 61 + 17) % 317, y = 120 + (i * 17) % 69;
    art += rect(x, y, 3 + (i % 5) * 2, 1, i % 5 === 0 ? highlightWave : setting.wave);
  }
  art += close + open('reflection');
  const reflectX = isDay ? 199 : isMorning && settingKey !== 'dawn' ? 211 : settingKey === 'ember' ? 210 : 243;
  for (let i = 0; i < 6; i++) art += rect(reflectX - i * 3, 120 + i * 5, 22 + i * 5, 1, setting.horizon);
  art += close + open('ship') + `<g transform="translate(132 78)">${shipArt(config)}</g>` + close;
  art += path('M0 159H20V156H38V159H57V163H100V167H114V172H123V177H116V192H0Z', '#5a4155');
  art += path('M0 158H20V155H38V158H59V161H100V165H114V169H124V174H98V170H57V166H0Z', '#a28587');
  art += rect(0, 168, 58, 2, '#735a6e') + rect(0, 184, 114, 2, '#432e47') + rect(22, 170, 2, 14, '#735a6e') + rect(73, 175, 2, 9, '#735a6e');
  art += rect(4, 128, 4, 31, '#523948') + rect(0, 127, 14, 3, '#a28587') + rect(1, 115, 10, 12, '#614457') + rect(3, 117, 6, 8, '#f5dca9') + rect(0, 112, 12, 3, '#a28587');
  art += open('captain') + `<g transform="translate(38 78) scale(2.5)">${characterArt(config)}</g>` + close;
  art += `<g transform="translate(99 141) scale(1.4)">${petArt(config.pet)}</g>`;
  art += rect(84, 150, 12, 11, '#68444a') + rect(83, 151, 14, 2, '#c49765') + rect(83, 158, 14, 2, '#c49765');
  return `<svg class="pixel-scene" viewBox="0 0 320 192" role="img" aria-label="${escapeXML(label)}" shape-rendering="crispEdges" xmlns="http://www.w3.org/2000/svg">${art}</svg>`;
}
export function editorPreviewSVG(category, config, label) {
  switch (category) {
    case 'character': return characterSVG(config, label);
    case 'ship': return shipSVG(config, label);
    case 'setting': return sceneSVG(config, label);
    default: throw new RangeError(`Unknown preview category: ${category}`);
  }
}
export function icon(name) {
  const paths = {
    harbour: 'M7 0h2v2h2v2H9v7h3V9h4v4h-2v2h-3v1H5v-1H2v-2H0V9h4v2h3V4H5V2h2V0z',
    character: 'M5 0h6v2h2v5h-2v2h3v2h2v5h-5v-4H5v4H0v-5h2V9h3V7H3V2h2V0zm0 3v3h6V3H5z',
    ship: 'M7 0h2v11h7v2h-2v2H2v-2H0v-2h7V0zM5 2h1v7H0V7h2V5h2V3h1V2zm5-1h3v2h2v6h-5V1z',
    setting: 'M1 1h14v14H1V1zm2 2v8h2V8h3v3h2V9h3V3H3zm7 1h2v2h-2V4zM3 13h10v-1H3v1z',
    hair: 'M4 1h8v2h2v10h-3V9h1V6h-2V4H6v2H4v3h1v4H2V3h2V1zM6 8h1v2H6V8zm3 0h1v2H9V8zM5 14h6v2H5v-2z',
    hat: 'M5 2h6v2h2v6h3v3H0v-3h3V4h2V2zm0 6v2h6V8H5z',
    shirt: 'M4 1h3v2h2V1h3v2h2v2h2v5h-4v5H4v-5H0V5h2V3h2V1zm2 4v2h4V5H6z',
    bottoms: 'M3 1h10v14H9V9H7v6H3V1zm2 2v2h6V3H5z',
    shoes: 'M2 3h4v7h2v2H0V6h2V3zm8 0h4v7h2v2H8V6h2V3zM0 14h16v2H0v-2z',
    pet: 'M3 0h3v4H3V0zm7 0h3v4h-3V0zM0 4h3v4H0V4zm13 0h3v4h-3V4zM6 6h4v2h2v2h2v4h-2v2H4v-2H2v-4h2V8h2V6z',
    stripes: 'M1 1h3v14H1V1zm5 0h4v14H6V1zm6 0h3v14h-3V1z',
    plain: 'M1 1h14v14H1V1zm2 2v10h10V3H3z',
    arrowRight: 'M8 1h2v2h2v2h2v2h2v2h-2v2h-2v2h-2v2H8v-4h2V9H0V7h10V5H8V1z',
    arrowLeft: 'M6 1h2v4H6v2h10v2H6v2h2v4H6v-2H4v-2H2V9H0V7h2V5h2V3h2V1z',
    arrowUpRight: 'M4 1h11v11h-2V5h-2v2H9v2H7v2H5v2H3v2H1v-3h2v-2h2V8h2V6h2V4H4V1z',
    download: 'M6 0h4v7h3v2h-2v2H9v2H7v-2H5V9H3V7h3V0zM0 12h3v2h10v-2h3v4H0v-4z',
    close: 'M1 1h3v2h2v2h4V3h2V1h3v3h-2v2h-2v4h2v2h2v3h-3v-2h-2v-2H6v2H4v2H1v-3h2v-2h2V6H3V4H1V1z',
    reset: 'M4 0h8v2h2v3h2v7h-2v2H4v-2H2v-2h3v2h8V6h-2V3H5v3h3v2H0V0h2v3h2V0z',
    lock: 'M4 0h8v2h2v5h2v9H0V7h2V2h2V0zm1 3v4h6V3H5zm2 7v3h2v-3H7z',
    compass: 'M7 0h2v3h3v2h2v6h-2v2H9v3H7v-3H4v-2H2V5h2V3h3V0zm-1 5v6h4V5H6zm1 1h2v4H7V6z',
    code: 'M4 3h2v2H4v2H2v2h2v2h2v2H4v-2H2V9H0V7h2V5h2V3zm8 0h-2v2h2v2h2v2h-2v2h-2v2h2v-2h2V9h2V7h-2V5h-2V3zM8 2h2L8 14H6L8 2z',
    tests: 'M3 0h10v2h-2v4l4 6v3H1v-3l4-6V2H3V0zm4 2v5l-2 3h6L9 7V2H7zm-3 10v1h8v-1H4z',
    review: 'M1 1h14v10H9l-4 4v-4H1V1zm2 2v6h4v2l2-2h4V3H3zm2 2h6v2H5V5z',
    crew: 'M2 1h4v4H2V1zm8 0h4v4h-4V1zM1 6h6v5H5v4H2v-4H0V7h1V6zm8 0h6v1h1v4h-2v4h-3v-4H9V6z',
    edit: 'M11 0h3v2h2v3h-2v2h-2V5h-2V3h1V0zM8 4h2v2h2v2h-2v2H8v2H6v2H2v-4h2V8h2V6h2V4zM1 15h14v1H1v-1z',
    flag: 'M3 0h2v16H3V0zm3 1h8v6H6V1z',
    coin: 'M4 1h8v2h2v2h1v6h-1v2h-2v2H4v-2H2v-2H1V5h1V3h2V1zm2 3v8h4v-2H8V9h2V7H8V6h2V4H6z',
    check: 'M13 3h3v3h-2v2h-2v2h-2v2H8v2H5v-2H3v-2H1V7h3v2h2v2h1V9h2V7h2V5h2V3z',
  };
  if (!paths[name]) throw new RangeError(`Unknown pixel icon: ${name}`);
  return `<svg class="pixel-icon" viewBox="0 0 16 16" aria-hidden="true" shape-rendering="crispEdges"><path d="${paths[name]}" fill="currentColor"/></svg>`;
}

export function characterCardSVG({ name, shipName, config, level, fontData }) {
  const font = fontData ? `<defs><style>@font-face{font-family:VoyagesPixel;src:url('${escapeXML(fontData)}') format('woff2');font-weight:400 700}</style></defs>` : '';
  const scene = sceneSVG(config).replace('<svg ', '<svg x="0" y="0" width="640" height="384" ');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="560" viewBox="0 0 640 560">${font}<rect width="640" height="560" fill="#21162b"/>${scene}<g font-family="VoyagesPixel, monospace"><text x="30" y="425" fill="#f6f0e7" font-size="${name.length > 16 ? 24 : 28}" font-weight="600">${escapeXML(name)}</text><text x="610" y="425" text-anchor="end" fill="#e6c480" font-size="16">Lv. ${level}</text><text x="30" y="456" fill="#c0b3ca" font-size="${shipName.length > 22 ? 14 : 17}">At the helm of ${escapeXML(shipName)}</text><text x="30" y="515" fill="#c0b3ca" font-size="12">Carthagent Voyages · carthagent.xyz/voyages/</text></g></svg>`;
}
