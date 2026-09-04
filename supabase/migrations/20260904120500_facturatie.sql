-- Facturatie (fase 3).
--
-- Keuzes die hier in zitten:
--   E3a  urenspecificatie als PDF, per klant instelbaar hoeveel detail
--   D3a  gefactureerde regels zijn op slot; corrigeren gaat met een tegenboeking
--
-- Een factuur is hier geen eigen tabel: de regels dragen een
-- factuur_referentie, en dat is genoeg om ze te groeperen en te bevriezen.
-- Het factureren zelf gebeurt in het boekhoudpakket (keuze E2a).

alter table klant
  add column specificatie_omschrijving boolean not null default true,
  add column specificatie_tarieven     boolean not null default false;

comment on column klant.specificatie_omschrijving is
  'Omschrijvingen van urenregels op de specificatie voor deze klant tonen.';
comment on column klant.specificatie_tarieven is
  'Uurtarieven en bedragen op de specificatie voor deze klant tonen.';

alter table instellingen
  add column kvk_nummer text,
  add column btw_nummer text,
  add column iban       text,
  add column email      text,
  add column telefoon   text;

create index urenregel_factuur_idx on urenregel (factuur_referentie)
  where factuur_referentie is not null;
create index rit_factuur_idx on rit (factuur_referentie)
  where factuur_referentie is not null;

-- Gefactureerde bedragen zijn bevroren, dus een factuur kan als som van zijn
-- regels worden getoond zonder herberekening. De view leunt op de
-- afgeschermde v_urenregel en v_rit, dus bedragen blijven leeg voor wie ze
-- niet mag zien.
create view v_factuur with (security_invoker = true) as
with u as (
  select u.factuur_referentie as referentie, v.klant_id, v.klant,
         min(v.datum) as van, max(v.datum) as tot,
         sum(v.minuten) as minuten, sum(v.omzet) as omzet,
         min(u.gewijzigd_op) as gefactureerd_op
  from urenregel u join v_urenregel v on v.id = u.id
  where u.factuur_referentie is not null
  group by u.factuur_referentie, v.klant_id, v.klant
),
r as (
  select r.factuur_referentie as referentie,
         sum(v.totaal_km) as km, sum(v.km_bedrag) as km_bedrag
  from rit r join v_rit v on v.id = r.id
  where r.factuur_referentie is not null
  group by r.factuur_referentie
)
select u.referentie, u.klant_id, u.klant, u.van, u.tot, u.minuten,
       u.omzet, coalesce(r.km, 0) as km, coalesce(r.km_bedrag, 0) as km_bedrag,
       u.omzet + coalesce(r.km_bedrag, 0) as totaal,
       u.gefactureerd_op
from u left join r on r.referentie = u.referentie;

grant select on v_factuur to authenticated;
