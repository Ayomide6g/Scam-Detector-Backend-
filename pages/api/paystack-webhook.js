// /api/paystack-webhook.js
import crypto from 'crypto';
import getRawBody from 'raw-body';
import { createClient } from '@supabase/supabase-js';

export const config = {
  api: {
    bodyParser: false,
  },
};

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { PAYSTACK_SECRET_KEY } = process.env;
  if (!PAYSTACK_SECRET_KEY) {
    console.error('PAYSTACK_SECRET_KEY is not set');
    return res.status(500).json({ error: 'Server configuration error' });
  }

  let rawBody;
  try {
    rawBody = await getRawBody(req, { limit: '1mb' });
  } catch (err) {
    console.error('Failed to read raw body:', err);
    return res.status(400).json({ error: 'Invalid body' });
  }

  const signature = req.headers['x-paystack-signature'];
  if (!signature) {
    return res.status(401).json({ error: 'Missing signature' });
  }

  const hash = crypto
    .createHmac('sha512', PAYSTACK_SECRET_KEY)
    .update(rawBody)
    .digest();

  let signatureBuffer;
  try {
    signatureBuffer = Buffer.from(signature, 'hex');
  } catch {
    return res.status(401).json({ error: 'Malformed signature' });
  }

  if (
    signatureBuffer.length !== hash.length ||
    !crypto.timingSafeEqual(hash, signatureBuffer)
  ) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  let event;
  try {
    event = JSON.parse(rawBody.toString());
  } catch {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  const webhookEventId = event?.id;
  if (!webhookEventId) {
    return res.status(400).json({ error: 'Missing webhook event id' });
  }

  const { error: insertError } = await supabase
    .from('webhook_events')
    .insert({
      event_id: webhookEventId,
      event_type: event.event,
      payload: event,
      status: 'processing',
    });

  if (insertError) {
    if (insertError.code === '23505') {
      return res.status(200).json({ received: true, duplicate: true });
    }
    console.error('Failed to record webhook event:', insertError);
    return res.status(500).json({ error: 'Database error' });
  }

  let processingError = null;
  try {
    const userId = getUserId(event);
    switch (event.event) {
      case 'subscription.create': {
        if (!userId) break;
        const { subscription_code, next_payment_date, plan } = event.data;
        const { error } = await supabase
          .from('profile')
          .update({
            subscription_status: 'active',
            subscription_code: subscription_code ?? null,
            plan_code: plan?.plan_code ?? null,
            trial_ends_at: next_payment_date ?? null,
            updated_at: new Date().toISOString(),
          })
          .eq('id', userId);
        if (error) throw new Error(`DB update failed [subscription.create]: ${error.message}`);
        break;
      }

      case 'charge.success':
      case 'invoice.payment_success': {
        if (!userId) break;
        const { amount, subscription, paid_at } = event.data;
        if (typeof amount !== 'number' || amount <= 0) {
          console.warn(`Skipping ${event.event} with invalid amount:`, amount);
          break;
        }
        const { error } = await supabase
          .from('profile')
          .update({
            subscription_status: 'active',
            is_pro: true,
            subscription_code: subscription?.subscription_code ?? null,
            last_paid_at: paid_at ?? new Date().toISOString(),
            last_paid_amount: amount,
            next_payment_date: subscription?.next_payment_date ?? null,
            trial_ends_at: null,
            updated_at: new Date().toISOString(),
          })
          .eq('id', userId);
        if (error) throw new Error(`DB update failed [${event.event}]: ${error.message}`);
        break;
      }

      case 'invoice.payment_failed': {
        if (!userId) break;
        const { error } = await supabase
          .from('profile')
          .update({
            subscription_status: 'past_due',
            is_pro: false,
            updated_at: new Date().toISOString(),
          })
          .eq('id', userId);
        if (error) throw new Error(`DB update failed [invoice.payment_failed]: ${error.message}`);
        break;
      }

      case 'subscription.disable':
      case 'subscription.not_renewing': {
        if (!userId) break;
        const { error } = await supabase
          .from('profile')
          .update({
            subscription_status: 'cancelled',
            is_pro: false,
            cancelled_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', userId);
        if (error) throw new Error(`DB update failed [${event.event}]: ${error.message}`);
        break;
      }

      case 'subscription.enable': {
        if (!userId) break;
        const { error } = await supabase
          .from('profile')
          .update({
            subscription_status: 'active',
            is_pro: true,
            cancelled_at: null,
            updated_at: new Date().toISOString(),
          })
          .eq('id', userId);
        if (error) throw new Error(`DB update failed [subscription.enable]: ${error.message}`);
        break;
      }

      default:
        console.info(`Unhandled Paystack event type: ${event.event}`);
    }
  } catch (err) {
    processingError = err;
    console.error('Webhook processing error:', err);
  }

  await supabase
    .from('webhook_events')
    .update({
      status: processingError ? 'failed' : 'processed',
      error_message: processingError?.message ?? null,
      processed_at: new Date().toISOString(),
    })
    .eq('event_id', webhookEventId);

  if (processingError) {
    return res.status(200).json({ received: true, error: 'Processing failed — logged' });
  }
  return res.status(200).json({ received: true });
}

function getUserId(event) {
  return (
    event?.data?.customer?.metadata?.userId ||
    event?.data?.metadata?.userId ||
    event?.data?.subscription?.customer?.metadata?.userId ||
    null
  );
}
