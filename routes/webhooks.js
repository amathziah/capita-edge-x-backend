import express from 'express';
import crypto from 'crypto';
import { supabase } from '../supabase.js';
import { VARIANT_TO_TIER } from '../config/tierConfig.js';

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
            const status = attributes.status;
            const variantId = attributes.variant_id?.toString();

            // Upsert Subscription
            const { error: subError } = await supabase
                .from('subscriptions')
                .upsert({
                    organization_id: organizationId,
                    lemon_squeezy_customer_id: attributes.customer_id.toString(),
                    lemon_squeezy_subscription_id: attributes.identifier,
                    variant_id: variantId,
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

            // Map variant_id to tier, fallback to freelancer for active subs
            const isActive = ['active', 'on_trial'].includes(status);
            const tier = isActive
                ? (VARIANT_TO_TIER[variantId] || 'freelancer')
                : 'starter';

            const { error: orgError } = await supabase
                .from('organizations')
                .update({
                    plan_tier: tier,
                    updatedAt: new Date()
                })
                .eq('id', organizationId);

            if (orgError) {
                console.error('Org Update Error:', orgError);
                throw orgError;
            }

            console.log(`Updated Org ${organizationId} to ${tier}`);
        }

        res.json({ received: true });
    } catch (err) {
        console.error('Webhook Error:', err);
        res.status(500).json({ error: 'Webhook processing failed' });
    }
});

export default router;
