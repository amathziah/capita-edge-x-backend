import express from 'express';
import crypto from 'crypto';
import { supabase } from '../supabase.js';

const router = express.Router();

// Middleware to verify Lemon Squeezy signature
const verifyLemonSqueezySignature = (req, res, next) => {
    const secret = process.env.LEMON_SQUEEZY_WEBHOOK_SECRET;
    const hmac = crypto.createHmac('sha256', secret);
    const digest = Buffer.from(hmac.update(req.rawBody).digest('hex'), 'utf8');
    const signature = Buffer.from(req.get('X-Signature') || '', 'utf8');

    if (!crypto.timingSafeEqual(digest, signature)) {
        return res.status(401).json({ error: 'Invalid signature' });
    }
    next();
};

// Webhook Handler
router.post('/lemon-squeezy', verifyLemonSqueezySignature, async (req, res) => {
    const event = req.body;
    const { meta, data } = event;
    const eventName = meta.event_name;

    console.log(`Received Lemon Squeezy event: ${eventName}`);

    try {
        if (eventName === 'subscription_created' || eventName === 'subscription_updated') {
            const attributes = data.attributes;
            const customData = meta.custom_data || {};

            // Extract organization ID from custom data passed during checkout
            const organizationId = customData.organization_id;

            if (!organizationId) {
                console.error('No organization_id found in webhook custom_data');
                return res.status(400).json({ error: 'No organization_id provided' });
            }

            // Map status
            // LS Statuses: active, past_due, unpaid, cancelled, expired, on_trial
            const status = attributes.status;

            // Upsert Subscription
            const { error: subError } = await supabase
                .from('subscriptions')
                .upsert({
                    organization_id: organizationId,
                    lemon_squeezy_customer_id: attributes.customer_id.toString(),
                    lemon_squeezy_subscription_id: attributes.identifier, // This is the sub ID to store
                    variant_id: attributes.variant_id.toString(),
                    status: status,
                    current_period_end: attributes.renews_at || attributes.ends_at,
                    updatedAt: new Date()
                }, {
                    onConflict: 'lemon_squeezy_subscription_id'
                });

            if (subError) {
                console.error('Subscription Insert Error:', subError);
                throw subError;
            }

            // Update Organization Plan Tier
            // If active or on_trial -> 'pro', else 'free'
            const isPro = ['active', 'on_trial'].includes(status);
            const { error: orgError } = await supabase
                .from('organizations')
                .update({
                    plan_tier: isPro ? 'pro' : 'free',
                    updatedAt: new Date()
                })
                .eq('id', organizationId);

            if (orgError) {
                console.error('Org Update Error:', orgError);
                throw orgError;
            }

            console.log(`Updated Org ${organizationId} to ${isPro ? 'pro' : 'free'}`);
        }

        res.json({ received: true });
    } catch (err) {
        console.error('Webhook Error:', err);
        res.status(500).json({ error: 'Webhook processing failed' });
    }
});

export default router;
