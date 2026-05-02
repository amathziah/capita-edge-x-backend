import { google } from 'googleapis';
import { supabase } from '../../core/database/supabase.js';

// Initialize OAuth2 client
const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID || 'dummy_client_id',
    process.env.GOOGLE_CLIENT_SECRET || 'dummy_client_secret',
    `${process.env.APP_URL || 'http://localhost:5173'}/settings/integrations/google/callback` // Note: adjust redirect URI to match your frontend callback
);

// Scopes required for Gmail SMTP
const SCOPES = [
    'https://mail.google.com/',
    'https://www.googleapis.com/auth/gmail.send',
    'https://www.googleapis.com/auth/userinfo.email'
];

export const getAuthUrl = async (req, res) => {
    try {
        // Find the user's organization
        const { data: orgUser } = await supabase
            .from('organization_users')
            .select('organization_id')
            .eq('user_id', req.user.id)
            .single();

        if (!orgUser) {
            return res.status(400).json({ success: false, message: 'User does not belong to an organization' });
        }
        
        const organizationId = orgUser.organization_id;

        // Generate the url that will be used for the consent dialog.
        const url = oauth2Client.generateAuthUrl({
            access_type: 'offline', // Requests a refresh token
            prompt: 'consent', // Forces the consent screen to show to ensure we get a refresh token
            scope: SCOPES,
            state: JSON.stringify({ organizationId }) // Pass organization ID so we know who to save it to on callback
        });

        return res.status(200).json({ success: true, url });
    } catch (error) {
        console.error('Google Auth URL Generation Error:', error);
        return res.status(500).json({ success: false, message: 'Failed to generate auth url' });
    }
};

export const oauthCallback = async (req, res) => {
    try {
        const { code, state } = req.body;
        
        if (!code) {
            return res.status(400).json({ success: false, message: 'Authorization code is required' });
        }

        let organizationId;
        try {
            const parsedState = JSON.parse(state);
            organizationId = parsedState.organizationId;
        } catch (e) {
            return res.status(400).json({ success: false, message: 'Invalid state parameter' });
        }

        // Exchange code for tokens
        const { tokens } = await oauth2Client.getToken(code);
        oauth2Client.setCredentials(tokens);

        // Fetch user's email address from Google to save in metadata
        const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
        const userInfo = await oauth2.userinfo.get();
        const emailAddress = userInfo.data.email;

        // Save or update tokens in the database
        const { data, error } = await supabase
            .from('organization_integrations')
            .upsert({
                organization_id: organizationId,
                provider: 'google',
                access_token: tokens.access_token,
                refresh_token: tokens.refresh_token || null, // Might be null if not first time authorizing (handled by prompt: 'consent')
                metadata: {
                    email: emailAddress,
                    connectedAt: new Date().toISOString()
                }
            }, {
                onConflict: 'organization_id,provider'
            })
            .select()
            .single();

        if (error) {
            throw error;
        }

        return res.status(200).json({ success: true, message: 'Google integration connected successfully', data });

    } catch (error) {
        console.error('Google OAuth Callback Error:', error);
        return res.status(500).json({ success: false, message: 'Failed to process oauth callback' });
    }
};

export const getIntegrationStatus = async (req, res) => {
    try {
        // Find the user's organization
        const { data: orgUser } = await supabase
            .from('organization_users')
            .select('organization_id')
            .eq('user_id', req.user.id)
            .single();

        if (!orgUser) return res.status(400).json({ success: false, message: 'No org found' });
        
        const organizationId = orgUser.organization_id;

        const { data, error } = await supabase
            .from('organization_integrations')
            .select('metadata, updated_at')
            .eq('organization_id', organizationId)
            .eq('provider', 'google')
            .maybeSingle();

        if (error && error.code !== 'PGRST116') {
            throw error;
        }

        if (data) {
            return res.status(200).json({ 
                success: true, 
                connected: true, 
                email: data.metadata?.email,
                connectedAt: data.metadata?.connectedAt || data.updated_at
            });
        }

        return res.status(200).json({ success: true, connected: false });
    } catch (error) {
        console.error('Get Integration Status Error:', error);
        return res.status(500).json({ success: false, message: 'Failed to get integration status' });
    }
};

export const disconnectGoogle = async (req, res) => {
    try {
        // Find the user's organization
        const { data: orgUser } = await supabase
            .from('organization_users')
            .select('organization_id')
            .eq('user_id', req.user.id)
            .single();

        if (!orgUser) return res.status(400).json({ success: false, message: 'No org found' });
        
        const organizationId = orgUser.organization_id;

        const { error } = await supabase
            .from('organization_integrations')
            .delete()
            .eq('organization_id', organizationId)
            .eq('provider', 'google');

        if (error) {
            throw error;
        }

        return res.status(200).json({ success: true, message: 'Google integration disconnected' });
    } catch (error) {
        console.error('Disconnect Google Error:', error);
        return res.status(500).json({ success: false, message: 'Failed to disconnect integration' });
    }
};
