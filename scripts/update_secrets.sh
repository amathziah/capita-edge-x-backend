#!/bin/bash

# Configuration
NEW_WEBHOOK_URL="https://discord.com/api/webhooks/1475451969052348610/YijWxEfpMoL1CsdZ00VQ4RL4TjLxny_43JHt7dQwCgctku9rLq8NKQ_c0A75WqdlNxTg"

echo "🚀 Updating Discord Webhook Secrets..."

if npx supabase --version &> /dev/null
then
    npx supabase secrets set DISCORD_WEBHOOK_URL="$NEW_WEBHOOK_URL"
    echo "✅ Supabase secrets updated successfully."
else
    echo "❌ Error: Supabase CLI not found."
    echo "Please run the following command manually if you have the CLI installed:"
    echo "supabase secrets set DISCORD_WEBHOOK_URL=\"$NEW_WEBHOOK_URL\""
    echo ""
    echo "Alternatively, set this in your Supabase Project Settings > API > Environment Variables."
fi
