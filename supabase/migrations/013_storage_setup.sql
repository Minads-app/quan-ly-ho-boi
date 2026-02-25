-- ==============================================================================
-- Migration: Setup Storage for Business Assets
-- Description: Creates a public bucket named 'assets' for storing logo images.
-- ==============================================================================

-- 1. Create the bucket (insert if not exists)
insert into storage.buckets (id, name, public) 
values ('assets', 'assets', true)
on conflict (id) do nothing;

-- 2. Drop existing policies if they exist (to allow re-running safely)
drop policy if exists "Public Access" on storage.objects;
drop policy if exists "Auth Insert" on storage.objects;
drop policy if exists "Auth Update" on storage.objects;
drop policy if exists "Auth Delete" on storage.objects;

-- 3. Create policies
-- Allow anyone to view objects in the 'assets' bucket
create policy "Public Access" 
on storage.objects for select 
using ( bucket_id = 'assets' );

-- Allow authenticated users to insert objects
create policy "Auth Insert" 
on storage.objects for insert 
with check ( bucket_id = 'assets' AND auth.role() = 'authenticated' );

-- Allow authenticated users to update objects
create policy "Auth Update" 
on storage.objects for update 
using ( bucket_id = 'assets' AND auth.role() = 'authenticated' );

-- Allow authenticated users to delete objects
create policy "Auth Delete"
on storage.objects for delete
using ( bucket_id = 'assets' AND auth.role() = 'authenticated' );

-- Note: Ensure Supabase Storage is enabled in your project settings.
