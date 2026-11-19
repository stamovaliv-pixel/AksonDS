-- DOXI: ручные учебные кейсы для сценариев «Мои поставщики».
-- Запустите один раз в Supabase SQL Editor. Таблица уже создана миграцией 20261118_doxi_learning_loop.sql.
-- Этот скрипт добавляет вопросы в существующий журнал обучения; структуру БД не меняет.
begin;
insert into public.doxi_learning_cases (
  id, question_message_id, conversation_id, user_id, user_role, page_name, question, assistant_answer,
  reason_type, context_type, source, status, occurrences, first_seen_at, last_seen_at
) values
  ('77efcd37-d813-4b63-bc4b-44d86edea8e6', null, null, null, 'super_admin', 'Опыт и обучение Докси', 'Добавь мне поставщика по названию или ИНН в мой личный список.', '', 'manual', 'suppliers', 'manual', 'pending', 1, now(), now()),
  ('575d309b-4b90-4685-b7e7-2584e62f8ae2', null, null, null, 'super_admin', 'Опыт и обучение Докси', 'Покажи, кто входит в мой личный список поставщиков.', '', 'manual', 'suppliers', 'manual', 'pending', 1, now(), now()),
  ('d55fea6e-bb03-4739-ba83-ddca13136cb6', null, null, null, 'super_admin', 'Опыт и обучение Докси', 'Кто из моих поставщиков записан на завтра или на другую дату?', '', 'manual', 'bookings', 'manual', 'pending', 1, now(), now()),
  ('4c6ae938-da61-4660-883c-1c59974be72e', null, null, null, 'super_admin', 'Опыт и обучение Докси', 'Кто из моих поставщиков ещё не имеет верификации?', '', 'manual', 'verification', 'manual', 'pending', 1, now(), now()),
  ('9abd8971-12fb-427a-9423-fd532b91abcc', null, null, null, 'super_admin', 'Опыт и обучение Докси', 'Кто из моих поставщиков сегодня ещё не прибыл?', '', 'manual', 'arrivals', 'manual', 'pending', 1, now(), now()),
  ('70c225bc-90cb-4bc3-86f3-5847a6cdf8a0', null, null, null, 'super_admin', 'Опыт и обучение Докси', 'Поставь напоминание о верификации моего поставщика за несколько часов до его записи.', '', 'manual', 'suppliers', 'manual', 'pending', 1, now(), now())
on conflict (id) do nothing;
commit;

-- Проверка: все шесть учебных кейсов должны отображаться как pending в разделе «Опыт и обучение Докси».
select id, question, context_type, status
from public.doxi_learning_cases
where id in (  '77efcd37-d813-4b63-bc4b-44d86edea8e6',
  '575d309b-4b90-4685-b7e7-2584e62f8ae2',
  'd55fea6e-bb03-4739-ba83-ddca13136cb6',
  '4c6ae938-da61-4660-883c-1c59974be72e',
  '9abd8971-12fb-427a-9423-fd532b91abcc',
  '70c225bc-90cb-4bc3-86f3-5847a6cdf8a0')
order by context_type, question;
