-- 018_add_camera_permission.sql
-- Add camera permission to profiles

ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS can_use_camera BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.profiles.can_use_camera IS 'Whether the staff member is allowed to use the mobile camera to scan QR codes on the Gate Check page. Default is false.';
