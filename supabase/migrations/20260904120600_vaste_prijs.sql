-- Vaste prijs en termijnen (keuze B5 van a naar b).
--
-- Een project kan nu een afgesproken som hebben die in termijnen wordt
-- gefactureerd bij tussenopleveringen. De uren worden gewoon geschreven en
-- goedgekeurd, maar bepalen de factuur niet; ze tellen alleen mee in de
-- kosten en in het effectieve uurtarief (som gedeeld door bestede uren).
--
-- Facturatie gaat vanaf nu per project, niet per klant.

alter type facturatiemodel add value if not exists 'vaste_prijs';

-- De nieuwe enumwaarde mag in dezelfde transactie nog niet als waarde
-- gebruikt worden; daarom vergelijkt alles hieronder via ::text.

alter table project
  add column vaste_prijs numeric(12,2) check (vaste_prijs >= 0);

comment on column project.vaste_prijs is
  'Afgesproken som bij facturatiemodel vaste_prijs; gefactureerd in termijnen.';

-- ---------------------------------------------------------------- termijn --

create table termijn (
  id                 uuid primary key default gen_random_uuid(),
  project_id         uuid not null references project (id) on delete cascade,
  volgorde           smallint not null default 1,
  omschrijving       text not null check (length(btrim(omschrijving)) > 0),
  bedrag             numeric(12,2) not null check (bedrag >= 0),
  gepland_op         date,
  factuur_referentie text,
  gefactureerd_op    timestamptz,
  aangemaakt_op      timestamptz not null default now(),
  constraint termijn_gefactureerd_consistent
    check ((factuur_referentie is null) = (gefactureerd_op is null))
);

create index termijn_project_idx on termijn (project_id, volgorde);
create index termijn_factuur_idx on termijn (factuur_referentie)
  where factuur_referentie is not null;

comment on table termijn is
  'Termijn of tussenoplevering van een vaste-prijsproject; gefactureerd zodra hij een referentie draagt.';

-- Een gefactureerde termijn wijzig of verwijder je niet meer (dezelfde regel
-- als voor uren, keuze D3a). Klopt een termijn niet, dan volgt een creditnota
-- in het boekhoudpakket; hier blijft de historie staan.
create or replace function blokkeer_gefactureerde_termijn()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    if old.factuur_referentie is not null then
      raise exception 'Termijn % is gefactureerd en kan niet verwijderd worden.', old.id
        using errcode = 'restrict_violation';
    end if;
    return old;
  end if;
  if old.factuur_referentie is not null
     and (new.bedrag       is distinct from old.bedrag
       or new.omschrijving is distinct from old.omschrijving
       or new.project_id   is distinct from old.project_id
       or new.factuur_referentie is distinct from old.factuur_referentie)
  then
    raise exception 'Termijn % is gefactureerd en kan niet meer gewijzigd worden.', old.id
      using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;

create trigger termijn_gefactureerd_slot before update or delete on termijn
  for each row execute function blokkeer_gefactureerde_termijn();

-- Termijnbedragen zijn verkoop, geen kostprijs: leesbaar vanaf projectleider,
-- net als tarieven. Schrijven doet de eigenaar.
alter table termijn enable row level security;
create policy termijn_lezen on termijn
  for select to authenticated using (minstens('projectleider'));
create policy termijn_beheren on termijn
  for all to authenticated using (is_eigenaar()) with check (is_eigenaar());
grant select, insert, update, delete on termijn to authenticated;

-- ------------------------------------------------------------ v_urenregel --

-- Uren op een vaste-prijsproject leveren zelf geen omzet op. De kolom
-- facturatiemodel komt achteraan, zodat afhankelijke views blijven werken.
create or replace view v_urenregel with (security_invoker = true) as
select
  u.id,
  u.medewerker_id,
  m.naam            as medewerker,
  u.onderdeel_id,
  o.naam            as onderdeel,
  o.project_id,
  p.naam            as project,
  p.klant_id,
  k.naam            as klant,
  u.datum,
  extract(isoyear from u.datum)::smallint as jaar,
  extract(week    from u.datum)::smallint as week,
  u.minuten,
  round(u.minuten / 60.0, 4) as uren,
  u.omschrijving,
  (u.declarabel and o.declarabel) as declarabel,
  u.status,
  u.bevroren_op is not null as bevroren,
  bv.verkooptarief                                                as verkooptarief,
  bk.kostprijs                                                    as kostprijs,
  case when p.facturatiemodel::text = 'vaste_prijs' then 0
       when u.declarabel and o.declarabel
       then round(u.minuten / 60.0 * bv.verkooptarief, 2)
       else 0
  end as omzet,
  round(u.minuten / 60.0 * bk.kostprijs, 2) as kosten,
  p.facturatiemodel::text as facturatiemodel
from urenregel u
join projectonderdeel o on o.id = u.onderdeel_id
join project          p on p.id = o.project_id
join klant            k on k.id = p.klant_id
join medewerker       m on m.id = u.medewerker_id
left join lateral (
  select coalesce(
    (select verkooptarief from bevroren_verkoop where urenregel_id = u.id),
    u.tarief_handmatig,
    tarief_voor(u.onderdeel_id, u.medewerker_id, u.datum)
  ) as verkooptarief
) bv on true
left join lateral (
  select coalesce(
    (select kostprijs from bevroren_kosten where urenregel_id = u.id),
    kostprijs_voor(u.medewerker_id, u.datum)
  ) as kostprijs
) bk on true
where u.status <> 'vervallen';

-- ---------------------------------------------------- v_project_uitputting --

-- Omzet van een project is nu urenomzet plus gefactureerde termijnen. De
-- afhankelijke v_klant_marge wordt daarom mee opnieuw aangemaakt.
drop view v_klant_marge;
drop view v_project_uitputting;

create view v_project_uitputting with (security_invoker = true) as
select
  p.id           as project_id,
  p.naam         as project,
  p.klant_id,
  k.naam         as klant,
  p.status,
  p.budget_uren,
  p.budget_bedrag,
  coalesce(u.uren,   0) as bestede_uren,
  coalesce(u.omzet, 0) + coalesce(t.gefactureerd, 0) as omzet,
  coalesce(u.kosten, 0) as kosten,
  coalesce(u.omzet, 0) + coalesce(t.gefactureerd, 0) - coalesce(u.kosten, 0) as marge,
  case when coalesce(u.omzet, 0) + coalesce(t.gefactureerd, 0) = 0 then null
       else round((coalesce(u.omzet, 0) + coalesce(t.gefactureerd, 0) - coalesce(u.kosten, 0))
                  / (coalesce(u.omzet, 0) + coalesce(t.gefactureerd, 0)) * 100, 1)
  end as marge_pct,
  case when coalesce(u.uren, 0) = 0 then null
       else round((coalesce(u.omzet, 0) + coalesce(t.gefactureerd, 0)) / u.uren, 2)
  end as effectief_uurtarief,
  case when p.budget_uren is null or p.budget_uren = 0 then null
       else round(coalesce(u.uren, 0) / p.budget_uren * 100, 1)
  end as budget_uren_verbruikt_pct,
  coalesce(r.km, 0)        as kilometers,
  coalesce(r.km_bedrag, 0) as km_bedrag,
  coalesce(u.omzet, 0) + coalesce(t.gefactureerd, 0) + coalesce(r.km_bedrag, 0)
    as totaal_te_factureren,
  p.facturatiemodel::text  as facturatiemodel,
  p.vaste_prijs,
  coalesce(t.gefactureerd, 0) as termijn_gefactureerd,
  coalesce(t.open, 0)         as termijn_open
from project p
join klant k on k.id = p.klant_id
left join (
  select project_id, sum(uren) as uren, sum(omzet) as omzet, sum(kosten) as kosten
  from v_urenregel group by project_id
) u on u.project_id = p.id
left join (
  select project_id, sum(totaal_km) as km, sum(km_bedrag) as km_bedrag
  from v_rit where project_id is not null group by project_id
) r on r.project_id = p.id
left join (
  select project_id,
         sum(bedrag) filter (where factuur_referentie is not null) as gefactureerd,
         sum(bedrag) filter (where factuur_referentie is null)     as open
  from termijn group by project_id
) t on t.project_id = p.id;

comment on view v_project_uitputting is
  'Besteed versus budget, omzet (uren plus gefactureerde termijnen), kosten en marge per project.';

create view v_klant_marge with (security_invoker = true) as
select
  k.id   as klant_id,
  k.naam as klant,
  count(distinct p.id)             as projecten,
  coalesce(sum(v.bestede_uren), 0) as uren,
  coalesce(sum(v.omzet), 0)        as omzet,
  coalesce(sum(v.kosten), 0)       as kosten,
  coalesce(sum(v.marge), 0)        as marge,
  coalesce(sum(v.km_bedrag), 0)    as km_bedrag
from klant k
left join project p             on p.klant_id = k.id
left join v_project_uitputting v on v.project_id = p.id
group by k.id, k.naam;

grant select on v_project_uitputting, v_klant_marge to authenticated;

-- -------------------------------------------------------------- v_factuur --

-- Een factuur kan nu ook alleen uit termijnen bestaan, en hoort bij één
-- project.
drop view v_factuur;

create view v_factuur with (security_invoker = true) as
with refs as (
  select factuur_referentie as referentie from urenregel where factuur_referentie is not null
  union
  select factuur_referentie from rit where factuur_referentie is not null
  union
  select factuur_referentie from termijn where factuur_referentie is not null
),
u as (
  select u.factuur_referentie as referentie,
         max(v.project_id::text)::uuid as project_id,
         min(v.datum) as van, max(v.datum) as tot,
         sum(v.minuten) as minuten, sum(v.omzet) as omzet,
         min(u.gewijzigd_op) as op
  from urenregel u join v_urenregel v on v.id = u.id
  where u.factuur_referentie is not null
  group by u.factuur_referentie
),
r as (
  select r.factuur_referentie as referentie,
         max(r.project_id::text)::uuid as project_id,
         sum(v.totaal_km) as km, sum(v.km_bedrag) as km_bedrag,
         min(r.gewijzigd_op) as op
  from rit r join v_rit v on v.id = r.id
  where r.factuur_referentie is not null
  group by r.factuur_referentie
),
t as (
  select factuur_referentie as referentie,
         max(project_id::text)::uuid as project_id,
         sum(bedrag) as bedrag, min(gefactureerd_op) as op
  from termijn
  where factuur_referentie is not null
  group by factuur_referentie
)
select refs.referentie,
       p.klant_id,
       k.naam                 as klant,
       p.id                   as project_id,
       p.naam                 as project,
       u.van, u.tot,
       coalesce(u.minuten, 0) as minuten,
       u.omzet,
       coalesce(r.km, 0)      as km,
       r.km_bedrag,
       t.bedrag               as termijn_bedrag,
       case when u.omzet is null and r.km_bedrag is null and t.bedrag is null then null
            else coalesce(u.omzet, 0) + coalesce(r.km_bedrag, 0) + coalesce(t.bedrag, 0)
       end                    as totaal,
       least(u.op, r.op, t.op) as gefactureerd_op
from refs
left join u on u.referentie = refs.referentie
left join r on r.referentie = refs.referentie
left join t on t.referentie = refs.referentie
left join project p on p.id = coalesce(u.project_id, r.project_id, t.project_id)
left join klant   k on k.id = p.klant_id;

grant select on v_factuur to authenticated;
