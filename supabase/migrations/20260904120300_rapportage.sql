-- Rapportage: uitputting per project en marge (keuze E1a).
--
-- Alle views draaien met security_invoker, zodat de rechten van de tabellen
-- eronder blijven gelden. Een medewerker ziet via deze views dus zijn eigen
-- uren met lege bedragen -- dat is precies de bedoeling van keuze D2a.

-- ------------------------------------------------------- urenregels + geld --

create view v_urenregel with (security_invoker = true) as
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
  -- Een onderdeel dat niet declarabel is, maakt de regel dat ook niet.
  (u.declarabel and o.declarabel) as declarabel,
  u.status,
  u.bevroren_op is not null as bevroren,

  -- Bevroren bedrag wint; anders het tarief van vandaag volgens de
  -- zoekvolgorde. Beide bronnen zijn afgeschermd, dus zonder leesrecht komt
  -- hier null uit en blijven de bedragen hieronder leeg.
  bv.verkooptarief                                                as verkooptarief,
  bk.kostprijs                                                    as kostprijs,

  case when u.declarabel and o.declarabel
       then round(u.minuten / 60.0 * bv.verkooptarief, 2)
       else 0
  end as omzet,

  -- Kosten lopen door op niet-declarabele uren: die betaal je ook.
  round(u.minuten / 60.0 * bk.kostprijs, 2) as kosten
from urenregel u
join projectonderdeel o on o.id = u.onderdeel_id
join project          p on p.id = o.project_id
join klant            k on k.id = p.klant_id
join medewerker       m on m.id = u.medewerker_id
-- Bevroren waar aanwezig, anders live uitgerekend.
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

comment on view v_urenregel is
  'Urenregels met uitgerekende bedragen. Bedragen zijn null zonder leesrecht.';

-- --------------------------------------------------------------- ritten ----

create view v_rit with (security_invoker = true) as
select
  r.id,
  r.medewerker_id,
  m.naam as medewerker,
  r.klant_id,
  k.naam as klant,
  r.project_id,
  r.datum,
  extract(isoyear from r.datum)::smallint as jaar,
  extract(week    from r.datum)::smallint as week,
  r.doel,
  r.omschrijving,
  r.afstand_km,
  r.retour,
  r.totaal_km,
  r.declarabel,
  r.status,
  coalesce(r.bevroren_km_tarief, km_tarief_voor(r.datum)) as km_tarief,
  case when r.declarabel then
    round(r.totaal_km * coalesce(r.bevroren_km_tarief, km_tarief_voor(r.datum)), 2)
  else 0 end as km_bedrag
from rit r
join medewerker m on m.id = r.medewerker_id
left join klant k on k.id = r.klant_id
where r.status <> 'vervallen';

-- C4a: bezoeken zijn geen eigen tabel, maar een selectie op doel.
create view v_bezoek with (security_invoker = true) as
select * from v_rit where doel in ('klantbezoek', 'locatiebezoek');

comment on view v_bezoek is
  'Ritten die als bezoek tellen. Gebruik dit voor "aantal bezoeken per klant".';

-- ------------------------------------------------------ project en marge ----

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
  coalesce(u.omzet,  0) as omzet,
  coalesce(u.kosten, 0) as kosten,
  coalesce(u.omzet, 0) - coalesce(u.kosten, 0) as marge,

  case when coalesce(u.omzet, 0) = 0 then null
       else round((coalesce(u.omzet, 0) - coalesce(u.kosten, 0))
                  / u.omzet * 100, 1)
  end as marge_pct,

  -- Wat een uur op dit project gemiddeld heeft opgebracht. Bij nacalculatie
  -- gelijk aan het tarief; zodra er vaste prijzen bij komen niet meer.
  case when coalesce(u.uren, 0) = 0 then null
       else round(coalesce(u.omzet, 0) / u.uren, 2)
  end as effectief_uurtarief,

  case when p.budget_uren is null or p.budget_uren = 0 then null
       else round(coalesce(u.uren, 0) / p.budget_uren * 100, 1)
  end as budget_uren_verbruikt_pct,

  coalesce(r.km, 0)        as kilometers,
  coalesce(r.km_bedrag, 0) as km_bedrag,
  coalesce(u.omzet, 0) + coalesce(r.km_bedrag, 0) as totaal_te_factureren
from project p
join klant k on k.id = p.klant_id
left join (
  select project_id,
         sum(uren)   as uren,
         sum(omzet)  as omzet,
         sum(kosten) as kosten
  from v_urenregel
  group by project_id
) u on u.project_id = p.id
left join (
  select project_id,
         sum(totaal_km) as km,
         sum(km_bedrag) as km_bedrag
  from v_rit
  where project_id is not null
  group by project_id
) r on r.project_id = p.id;

comment on view v_project_uitputting is
  'Besteed versus budget, omzet, kosten en marge per project (keuze E1a).';

create view v_klant_marge with (security_invoker = true) as
select
  k.id   as klant_id,
  k.naam as klant,
  count(distinct p.id)          as projecten,
  coalesce(sum(v.bestede_uren), 0) as uren,
  coalesce(sum(v.omzet), 0)        as omzet,
  coalesce(sum(v.kosten), 0)       as kosten,
  coalesce(sum(v.marge), 0)        as marge,
  coalesce(sum(v.km_bedrag), 0)    as km_bedrag
from klant k
left join project p            on p.klant_id = k.id
left join v_project_uitputting v on v.project_id = p.id
group by k.id, k.naam;

-- Marge per medewerker per maand: waar verdien je aan, en aan wie.
create view v_medewerker_maand with (security_invoker = true) as
select
  u.medewerker_id,
  u.medewerker,
  date_trunc('month', u.datum)::date as maand,
  sum(u.uren)                                       as uren,
  sum(u.uren) filter (where u.declarabel)           as declarabele_uren,
  case when sum(u.uren) = 0 then null
       else round(coalesce(sum(u.uren) filter (where u.declarabel), 0)
                  / sum(u.uren) * 100, 1)
  end as declarabiliteit_pct,
  sum(u.omzet)                as omzet,
  sum(u.kosten)               as kosten,
  sum(u.omzet) - sum(u.kosten) as marge
from v_urenregel u
group by u.medewerker_id, u.medewerker, date_trunc('month', u.datum);

comment on view v_medewerker_maand is
  'Uren, declarabiliteit en marge per medewerker per maand.';
