import { Rpc } from '@opencode/plugin/rpc';

export const voyagesSlots = ['hairStyle', 'hat', 'shirt', 'bottoms', 'shoes', 'pet', 'hull', 'sail', 'setting'] as const;
export const voyagesAppearance = { skin: ['warm', 'light', 'deep', 'tan'], hair: ['dark', 'silver', 'copper'], pattern: ['stripes', 'plain'] } as const;
export type VoyagesSlot = typeof voyagesSlots[number];
export type VoyagesProfile = {
  version: number; name: string; shipName: string; coins: number; totalXp: number; level: number;
  xpIntoLevel: number; xpForLevel: number; km: number; weeklyKm: number;
  config: Record<VoyagesSlot, string> & { skin: string; hair: string; pattern: string }; owned: string[];
};
export type VoyagesItem = { item: string; name: string; slot: VoyagesSlot; itemKey: string; price: number | null; requiresPurchase: boolean; available: boolean; eligible: boolean; reason: string | null };
export type VoyagesQuote = { id: string; item: string; price: number; expiresAt: string };
export type VoyagesPending = { quoteId: string; item: string; price: number };
export type VoyagesSnapshot = { profile: VoyagesProfile; items: VoyagesItem[]; pending?: VoyagesPending };

const text = { type: 'string', minLength: 1, maxLength: 128 } as const;
// Native Effect JSON-schema conversion does not support arbitrary patterns.
// The server validates equipment key syntax before forwarding mutations.
const key = { type: 'string', minLength: 1, maxLength: 64 } as const;
const integer = { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER } as const;
const version = { ...integer, minimum: 1 } as const;
const slot = { type: 'string', enum: voyagesSlots } as const;
const skin = { type: 'string', enum: voyagesAppearance.skin } as const;
const hair = { type: 'string', enum: voyagesAppearance.hair } as const;
const pattern = { type: 'string', enum: voyagesAppearance.pattern } as const;
const name = { type: 'string', minLength: 1, maxLength: 20 } as const;
const shipName = { type: 'string', minLength: 1, maxLength: 28 } as const;
const config = {
  type: 'object', properties: { hairStyle: key, hat: key, shirt: key, bottoms: key, shoes: key, pet: key, hull: key, sail: key, setting: key, skin, hair, pattern },
  required: [...voyagesSlots, 'skin', 'hair', 'pattern'], additionalProperties: false,
} as const;
const profile = {
  type: 'object', properties: { version, name, shipName, coins: integer, totalXp: integer, level: version, xpIntoLevel: integer, xpForLevel: version, km: { type: 'number', minimum: 0 }, weeklyKm: { type: 'number', minimum: 0 }, config, owned: { type: 'array', maxItems: 10000, items: text, uniqueItems: true } },
  required: ['version', 'name', 'shipName', 'coins', 'totalXp', 'level', 'xpIntoLevel', 'xpForLevel', 'km', 'weeklyKm', 'config', 'owned'], additionalProperties: false,
} as const;
const item = {
  type: 'object', properties: { item: text, name: text, slot, itemKey: key, price: { ...integer, type: ['integer', 'null'] }, requiresPurchase: { type: 'boolean' }, available: { type: 'boolean' }, eligible: { type: 'boolean' }, reason: { type: ['string', 'null'], maxLength: 128 } },
  required: ['item', 'name', 'slot', 'itemKey', 'price', 'requiresPurchase', 'available', 'eligible', 'reason'], additionalProperties: false,
} as const;
const pending = { type: 'object', properties: { quoteId: text, item: text, price: integer }, required: ['quoteId', 'item', 'price'], additionalProperties: false } as const;
const quote = { type: 'object', properties: { id: text, item: text, price: integer, expiresAt: { type: 'string', format: 'date-time' } }, required: ['id', 'item', 'price', 'expiresAt'], additionalProperties: false } as const;
const errors = { voyagesError: { type: 'object', properties: { code: text, status: { type: 'integer', minimum: 0, maximum: 599 }, uncertain: { type: 'boolean' } }, required: ['code', 'status', 'uncertain'], additionalProperties: false } } as const;
const empty = { type: 'object', additionalProperties: false } as const;
const selection = { type: 'object', properties: { slot, item: key }, required: ['slot', 'item'], additionalProperties: false } as const;
const profileResult = { type: 'object', properties: { profile }, required: ['profile'], additionalProperties: false } as const;
const receipt = { type: 'object', properties: { receiptId: text, item: text, price: integer }, required: ['receiptId', 'item', 'price'], additionalProperties: false } as const;

/** Authenticated server-only Voyages boundary. Confirmation belongs to the UI. */
export const Voyages = Rpc.define({
  id: 'carthagent.voyages',
  methods: {
    snapshot: { errors, input: empty, output: { type: 'object', properties: { profile, items: { type: 'array', maxItems: 10000, items: item }, pending }, required: ['profile', 'items'], additionalProperties: false } },
    customize: { errors, input: { type: 'object', properties: { version, name, shipName, skin, hair, pattern }, required: ['version'], additionalProperties: false }, output: profileResult },
    equip: { errors, input: { ...selection, properties: { ...selection.properties, version }, required: ['version', 'slot', 'item'] }, output: profileResult },
    quote: { errors, input: selection, output: { type: 'object', properties: { quote }, required: ['quote'], additionalProperties: false } },
    purchase: { errors, input: { type: 'object', properties: { quoteId: text }, required: ['quoteId'], additionalProperties: false }, output: receipt },
    retryPurchase: { errors, input: { type: 'object', properties: { quoteId: text }, required: ['quoteId'], additionalProperties: false }, output: receipt },
  },
  events: {},
});
