import { supabase } from '../../../core/database/supabase.js';

export const getConversations = async (req, res) => {
    const results = [];

    try {
        const { count, error: countError } = await supabase
            .from('ai_chat_messages')
            .select('*', { count: 'exact', head: true })
            .is('conversation_id', null)
            .eq('user_id', req.user.id);

        if (!countError && count > 0) {
            results.push({
                id: 'legacy',
                title: 'My Previous History',
                created_at: new Date().toISOString()
            });
        }
    } catch (e) {
        console.error('Legacy check failed:', e.message);
    }

    try {
        const { data, error } = await supabase
            .from('ai_conversations')
            .select('*')
            .eq('organization_id', req.user.organizationId)
            .eq('user_id', req.user.id)
            .order('created_at', { ascending: false })
            .limit(30);

        if (!error && data) {
            results.unshift(...data);
        }
    } catch (err) {
        console.warn('Conversations table may not exist yet:', err.message);
    }

    res.json(results);
};

export const getConversationMessages = async (req, res) => {
    const { id } = req.params;

    try {
        let query = supabase
            .from('ai_chat_messages')
            .select('*')
            .order('created_at', { ascending: true });

        if (id === 'legacy') {
            query = query.is('conversation_id', null).eq('user_id', req.user.id);
        } else {
            query = query.eq('conversation_id', id)
                .eq('organization_id', req.user.organizationId);
        }

        const { data, error } = await query;

        if (error) {
            console.warn('Failed to fetch messages:', error.message);
            return res.json([]);
        }

        res.json((data || []).map(msg => ({
            id: msg.id,
            sender: msg.role === 'user' ? 'user' : 'bot',
            text: msg.content,
            data: msg.data,
            timestamp: msg.created_at
        })));
    } catch (err) {
        console.error('getConversationMessages crash prevented:', err.message);
        res.json([]);
    }
};

export const getChatHistory = async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('ai_chat_messages')
            .select('*')
            .eq('organization_id', req.user.organizationId)
            .eq('user_id', req.user.id)
            .order('created_at', { ascending: false })
            .limit(50);

        if (error) {
            console.warn('getChatHistory failed:', error.message);
            return res.json([]);
        }

        res.json((data || []).reverse().map(msg => ({
            id: msg.id,
            sender: msg.role === 'user' ? 'user' : 'bot',
            text: msg.content,
            data: msg.data,
            timestamp: msg.created_at
        })));
    } catch (err) {
        console.error('getChatHistory crash prevented:', err.message);
        res.json([]);
    }
};

export const deleteChatHistory = async (req, res) => {
    const { error } = await supabase
        .from('ai_chat_messages')
        .delete()
        .eq('organization_id', req.user.organizationId)
        .eq('user_id', req.user.id);

    if (error) throw error;
    res.json({ success: true });
};
