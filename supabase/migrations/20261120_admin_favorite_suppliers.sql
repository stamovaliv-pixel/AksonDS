-- Персональное избранное поставщиков для администратора/суперадминистратора.
-- Одна и та же компания может быть избранной у нескольких пользователей.
begin;
create table if not exists public.admin_favorite_suppliers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  supplier_profile_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint admin_favorite_suppliers_user_supplier_key unique (user_id, supplier_profile_id)
);
create index if not exists admin_favorite_suppliers_supplier_idx on public.admin_favorite_suppliers(supplier_profile_id);
alter table public.admin_favorite_suppliers enable row level security;
drop policy if exists admin_favorite_suppliers_select_own on public.admin_favorite_suppliers;
drop policy if exists admin_favorite_suppliers_insert_own on public.admin_favorite_suppliers;
drop policy if exists admin_favorite_suppliers_delete_own on public.admin_favorite_suppliers;
create policy admin_favorite_suppliers_select_own on public.admin_favorite_suppliers for select to authenticated
using (user_id = auth.uid() and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin','super_admin') and coalesce(p.is_blocked,false) = false));
create policy admin_favorite_suppliers_insert_own on public.admin_favorite_suppliers for insert to authenticated
with check (user_id = auth.uid() and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin','super_admin') and coalesce(p.is_blocked,false) = false) and exists (select 1 from public.profiles s where s.id = supplier_profile_id and s.role not in ('admin','super_admin','operator')));
create policy admin_favorite_suppliers_delete_own on public.admin_favorite_suppliers for delete to authenticated
using (user_id = auth.uid() and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin','super_admin') and coalesce(p.is_blocked,false) = false));
grant select, insert, delete on public.admin_favorite_suppliers to authenticated;
-- Удаляем только старые записи-списки поставщиков. Обычную личную память не трогаем.
delete from public.doxi_user_memory
where lower(coalesce(title,'')) = lower('Мои поставщики')
   or content like '%doxi-my-supplier-v1%';
commit;
