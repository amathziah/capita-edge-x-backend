import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

serve(async (req) => {
    try {
        const { record } = await req.json()
        const discordWebhookUrl = Deno.env.get('DISCORD_WEBHOOK_URL')

        if (!record || !discordWebhookUrl) {
            return new Response(JSON.stringify({ error: 'Missing logic data' }), { status: 400 })
        }

        // Map platform_reports fields to Discord embed
        const message = {
            content: "🚀 **Transmission Received: CapitaEdgeX Protocol Integrity**",
            embeds: [{
                title: record.title || "Mission Report",
                color: record.priority === 'critical' ? 15158332 : record.priority === 'high' ? 15105570 : 3447003,
                fields: [
                    { name: "Sender ID", value: `\`${record.user_id || "Anonymous"}\``, inline: true },
                    { name: "Category", value: `\`${record.type.toUpperCase()}\``, inline: true },
                    { name: "Priority", value: `\`${record.priority.toUpperCase()}\``, inline: true },
                    { name: "Description", value: record.description || "No description provided." }
                ],
                footer: { text: "CapitaEdgeX Operational Integrity" },
                timestamp: record.created_at || new Date().toISOString()
            }]
        }

        await fetch(discordWebhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(message)
        })

        return new Response(JSON.stringify({ success: true }), { status: 200 })
    } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500 })
    }
})
