-- Read-only diagnostic: check if any of the example document numbers were ever booked.
SELECT
  id,
  profile_id,
  slot_date,
  slot_hour,
  supply_type,
  supply_types,
  order_number,
  status,
  created_at
FROM public.bookings
WHERE order_number IN ('1231851', '21312')
ORDER BY created_at DESC;
