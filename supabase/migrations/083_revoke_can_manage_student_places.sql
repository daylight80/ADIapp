-- Internal helper for the pickup-places functions (migration 077); signed-in users never need to call it directly,
-- and Supabase's security check flagged it as callable through the API.
revoke execute on function public._can_manage_student_places(uuid) from authenticated;
