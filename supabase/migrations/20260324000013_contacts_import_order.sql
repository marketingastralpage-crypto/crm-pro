-- Add import_order column to preserve CSV/XLSX file row order
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS import_order BIGINT;
