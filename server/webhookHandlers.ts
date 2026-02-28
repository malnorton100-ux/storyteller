import { getStripeSync, getUncachableStripeClient } from './stripeClient';
import { storage } from './storage';

export class WebhookHandlers {
  static async processWebhook(payload: Buffer, signature: string): Promise<void> {
    if (!Buffer.isBuffer(payload)) {
      throw new Error(
        'STRIPE WEBHOOK ERROR: Payload must be a Buffer. ' +
        'Received type: ' + typeof payload + '. ' +
        'This usually means express.json() parsed the body before reaching this handler. ' +
        'FIX: Ensure webhook route is registered BEFORE app.use(express.json()).'
      );
    }

    const sync = await getStripeSync();
    await sync.processWebhook(payload, signature);

    try {
      const stripe = await getUncachableStripeClient();
      const event = stripe.webhooks.constructEvent(
        payload,
        signature,
        process.env.STRIPE_WEBHOOK_SECRET || ''
      );

      if (event.type === 'checkout.session.completed') {
        const session = event.data.object as any;
        if (session.payment_status === 'paid' && session.id) {
          await storage.updatePurchaseStatus(
            session.id,
            'paid',
            session.payment_intent as string
          );
          console.log(`Webhook: marked purchase ${session.id} as paid`);
        }
      }
    } catch (webhookError) {
      console.warn('Custom webhook processing skipped:', webhookError instanceof Error ? webhookError.message : webhookError);
    }
  }
}
