begin;

update public.feedback
set status = 'Completed'
where status = 'Answered';

alter table public.feedback
drop constraint if exists feedback_status_check;

alter table public.feedback
add constraint feedback_status_check
check (status in ('New', 'In Review', 'Completed', 'Closed'));

commit;
