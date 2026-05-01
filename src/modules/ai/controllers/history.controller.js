import { supabase } from '../../../core/database/supabase.js';

export const getConversations = async (req, res) => {
    const { data, error } = await supabase
        .from('ai_conversations')
        .select('id, title, created_at')
        .eq('organization_id', req.user.organizationId)
        .eq('user_id', req.user.id)
        .order('created_at', { ascending: false })
        .limit(30);

    if (error) {
        console.warn('[History] getConversations failed:', error.message);
        return res.json([]);
    }

    res.json(data || []);
};

export const getConversationMessages = async (req, res) => {
    const { id } = req.params;

    const { data, error } = await supabase
        .from('ai_chat_messages')
        .select('id, role, content, data, created_at')
        .eq('conversation_id', id)
        .eq('organization_id', req.user.organizationId)
        .order('created_at', { ascending: true });

    if (error) {
        console.warn('[History] getConversationMessages failed:', error.message);
        return res.json([]);
    }

    res.json((data || []).map(msg => ({
        id: msg.id,
        sender: msg.role === 'user' ? 'user' : 'bot',
        text: msg.content,
        data: msg.data,
        timestamp: msg.created_at
    })));
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
