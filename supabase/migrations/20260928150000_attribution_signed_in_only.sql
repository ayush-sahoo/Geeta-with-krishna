-- Only signed-in users can tag their account with a signup source (the
-- function already did nothing for anonymous callers).
revoke execute on function public.set_my_attribution(text) from anon;
