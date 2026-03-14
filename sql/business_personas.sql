-- ==========================================
-- ADAPTIVE BUSINESS PERSONAS MIGRATION (REFINED)
-- ==========================================

-- 1. Create public.profiles table if not exists
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Defensively modify business_type column to be nullable and remove default
-- This allows us to detect users who haven't selected a persona yet.
DO $$ 
BEGIN 
    -- Ensure column exists
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='profiles' AND column_name='business_type') THEN
        ALTER TABLE public.profiles ADD COLUMN business_type TEXT;
    ELSE
        -- Remove NOT NULL and DEFAULT if they exist
        ALTER TABLE public.profiles ALTER COLUMN business_type DROP NOT NULL;
        ALTER TABLE public.profiles ALTER COLUMN business_type DROP DEFAULT;
    END IF;

    -- Add Check Constraint (re-applied in case it was dropped or needs update)
    ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_business_type_check;
    ALTER TABLE public.profiles ADD CONSTRAINT profiles_business_type_check 
    CHECK (business_type IN ('solopreneur', 'services_firm', 'subscription', 'ecommerce', 'ca'));
END $$;

-- 3. Enable Row Level Security (RLS)
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- 4. Create RLS Policies
DROP POLICY IF EXISTS "Users can view their own profile" ON public.profiles;
CREATE POLICY "Users can view their own profile" ON public.profiles
    FOR SELECT USING (auth.uid() = id);

DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;
CREATE POLICY "Users can update their own profile" ON public.profiles
    FOR UPDATE USING (auth.uid() = id);

-- 5. Create Trigger Function (No default persona assigned here anymore)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.profiles (id, business_type)
    VALUES (NEW.id, NULL)
    ON CONFLICT (id) DO NOTHING;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 6. Bind the Trigger to auth.users
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- We don't backfill existing users with 'solopreneur' anymore to force them to pick if they haven't.
-- If someone already has it, they stay as they are.
