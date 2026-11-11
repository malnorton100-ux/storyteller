import { getUncachableStripeClient } from "./stripeClient";

/**
 * The three things people can buy, in Australian dollars. On every start-up the
 * Stripe products are created or updated to match this list, so prices and names
 * are changed here (or with the env vars), never by hand in Stripe.
 * The `type` values are what the app checks, so they must not change.
 */
const PRODUCTS = [
  {
    type: "pdf_download",
    name: "Storybook",
    description: "More storybook pictures for this story (up to 3 goes) and a printable PDF book to keep.",
    cents: Number(process.env.PRICE_STORYBOOK_CENTS || 799),
  },
  {
    type: "video_download",
    name: "Movie",
    description: "Your story as a movie with you as the star, narrated in your voice (up to 2 goes). Yours to download and share.",
    cents: Number(process.env.PRICE_MOVIE_CENTS || 1299),
  },
  {
    type: "bundle_download",
    name: "Everything",
    description: "The storybook AND the movie for this story: pictures, printable book and movie. Best value - cheaper than buying both.",
    cents: Number(process.env.PRICE_EVERYTHING_CENTS || 1499),
  },
];
const CURRENCY = (process.env.PRICE_CURRENCY || "aud").toLowerCase();

export async function syncStripeProducts() {
  const stripe = await getUncachableStripeClient();
  const existing = await stripe.products.list({ limit: 100 });

  for (const want of PRODUCTS) {
    let product =
      existing.data.find((p) => p.metadata?.type === want.type && p.active) ||
      existing.data.find((p) => p.metadata?.type === want.type);
    if (!product) {
      product = await stripe.products.create({ name: want.name, description: want.description, metadata: { type: want.type } });
      console.log(`[Stripe] Created product: ${want.name}`);
    } else if (product.name !== want.name || product.description !== want.description || !product.active) {
      product = await stripe.products.update(product.id, { name: want.name, description: want.description, active: true });
      console.log(`[Stripe] Updated product: ${want.name}`);
    }

    const prices = await stripe.prices.list({ product: product.id, active: true, limit: 100 });
    let price = prices.data.find((p) => p.currency === CURRENCY && p.unit_amount === want.cents && !p.recurring);
    if (!price) {
      price = await stripe.prices.create({ product: product.id, currency: CURRENCY, unit_amount: want.cents });
      console.log(`[Stripe] New price for ${want.name}: ${CURRENCY.toUpperCase()} ${(want.cents / 100).toFixed(2)}`);
    }
    const defaultId = typeof product.default_price === "string" ? product.default_price : product.default_price?.id;
    if (defaultId !== price.id) await stripe.products.update(product.id, { default_price: price.id });
    // Only one active price per product - the app shows the active one.
    for (const old of prices.data) {
      if (old.id !== price.id) await stripe.prices.update(old.id, { active: false });
    }
  }
  console.log(`[Stripe] Products ready: ${PRODUCTS.map((p) => `${p.name} ${(p.cents / 100).toFixed(2)}`).join(", ")} ${CURRENCY.toUpperCase()}`);
}
