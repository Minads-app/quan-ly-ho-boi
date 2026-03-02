-- ============================================================
-- Product Variants & Unit of Measurement
-- Adds SKU, unit, and parent_id for variant grouping
-- ============================================================

-- Add new columns to products table
ALTER TABLE public.products
ADD COLUMN IF NOT EXISTS sku TEXT,
ADD COLUMN IF NOT EXISTS unit TEXT NOT NULL DEFAULT 'cái',
ADD COLUMN IF NOT EXISTS parent_id UUID REFERENCES public.products(id) ON DELETE CASCADE;

-- Index for fast variant lookups
CREATE INDEX IF NOT EXISTS idx_products_parent_id ON public.products(parent_id);

COMMENT ON COLUMN public.products.sku IS 'Variant identifier (e.g. S3, S4, XL)';
COMMENT ON COLUMN public.products.unit IS 'Unit of measurement (cái, chai, ly, hộp...)';
COMMENT ON COLUMN public.products.parent_id IS 'Parent product ID for variants. NULL = standalone product or parent';
