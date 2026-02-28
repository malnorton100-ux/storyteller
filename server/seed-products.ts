import { getUncachableStripeClient } from './stripeClient';

async function createProducts() {
  const stripe = await getUncachableStripeClient();

  const existing = await stripe.products.list({ limit: 100 });
  const existingNames = existing.data.map(p => p.name);

  if (!existingNames.includes('Illustrated Storybook PDF')) {
    const pdfProduct = await stripe.products.create({
      name: 'Illustrated Storybook PDF',
      description: 'Download your AI-illustrated story as a beautiful PDF storybook to share with family.',
      metadata: {
        type: 'pdf_download',
      },
    });
    await stripe.prices.create({
      product: pdfProduct.id,
      unit_amount: 499,
      currency: 'usd',
    });
    console.log('Created: Illustrated Storybook PDF - $4.99');
  } else {
    console.log('Skipped: Illustrated Storybook PDF (already exists)');
  }

  if (!existingNames.includes('AI Video Movie')) {
    const videoProduct = await stripe.products.create({
      name: 'AI Video Movie',
      description: 'Download your AI-generated animated video movie — real moving scenes brought to life.',
      metadata: {
        type: 'video_download',
      },
    });
    await stripe.prices.create({
      product: videoProduct.id,
      unit_amount: 699,
      currency: 'usd',
    });
    console.log('Created: AI Video Movie - $6.99');
  } else {
    console.log('Skipped: AI Video Movie (already exists)');
  }

  if (!existingNames.includes('Complete Story Bundle')) {
    const bundleProduct = await stripe.products.create({
      name: 'Complete Story Bundle',
      description: 'Get both the illustrated PDF storybook AND the AI video movie — the complete package.',
      metadata: {
        type: 'bundle_download',
      },
    });
    await stripe.prices.create({
      product: bundleProduct.id,
      unit_amount: 999,
      currency: 'usd',
    });
    console.log('Created: Complete Story Bundle - $9.99');
  } else {
    console.log('Skipped: Complete Story Bundle (already exists)');
  }

  console.log('Product seeding complete!');
}

createProducts().catch(console.error);
