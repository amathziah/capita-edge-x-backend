import { supabase } from '../supabase.js';
import { APIError } from '../middleware/errorHandler.js';

export const getProducts = async (req, res) => {
    const { data: products, error } = await supabase
        .from('products')
        .select('*')
        .eq('organization_id', req.user.organizationId)
        .order('name', { ascending: true });

    if (error) throw new Error(error.message);

    // Map DB snake_case to camelCase for frontend
    const mappedProducts = products.map(p => ({
        ...p,
        costPrice: p.cost_price,
        taxRate: p.tax_rate,
        reorderLevel: p.reorder_level
    }));

    res.json(mappedProducts);
};

export const createProduct = async (req, res) => {
    const { id, name, description, price, stock, unit, minStock, sku, category, vendor, costPrice, taxRate, reorderLevel } = req.body;

    const productData = {
        name, description, price,
        stock: stock || 0,
        unit,
        minStock: minStock || 0,
        sku, category, vendor,
        cost_price: costPrice || 0,
        tax_rate: taxRate || 0,
        reorder_level: reorderLevel || 10,
        organization_id: req.user.organizationId
    };

    if (id) {
        productData.updatedAt = new Date();
        const { error } = await supabase
            .from('products')
            .update(productData)
            .eq('id', id)
            .eq('organization_id', req.user.organizationId);

        if (error) throw new Error(error.message);
        res.json({ success: true, id });
    } else {
        const { data, error } = await supabase
            .from('products')
            .insert([productData])
            .select()
            .single();

        if (error) throw new Error(error.message);
        res.json({ success: true, id: data.id });
    }
};

export const deleteProduct = async (req, res) => {
    const { error } = await supabase
        .from('products')
        .delete()
        .eq('id', req.params.id)
        .eq('organization_id', req.user.organizationId);

    if (error) throw new Error(error.message);
    res.json({ success: true });
};
