# Fasskoll – granskningsunderlag inför publicering

Senast uppdaterad: 2026-04-27  
Projekt: Fasskoll (intern hobbytjänst)

## 1. Syfte och scope
Fasskoll är en webbtjänst som visar apotekens lagerstatus för utvalda läkemedel baserat på samma underliggande flöde som används i Fass gränssnitt (via Fass-endpoints), men med ett förenklat användargränssnitt.

Tjänsten är uttryckligen markerad som **ej officiell**.

## 2. Teknisk arkitektur

### Frontend
- Vue 3 + TypeScript + Vite
- Vue Router (SPA)
- Vercel Analytics-komponent för sidnivåanalys

### Backend (Vercel serverless functions)
- `/api/content` (proxy mot tillåtna Fass-endpoints)
- `/api/stock` (samlat lagerflöde: geokodning -> apotek -> stock)
- `/api/auth/*` (login/logout/session)
- `/api/metrics/*` (trafik, fel, toppar, adminöversikt)
- `/api/services/fassService.js` (centralt service-lager för Fass-kommunikation)

### Drift/deploy
- Vercel (Vite build)
- Rewrites för API och SPA-routing
- All Fass-kommunikation går via backend, inte direkt från klient i produktion

## 3. Funktionell översikt (det som byggts)

### Publika funktioner
- Snabbval för 4 läkemedel: Estradot, Lenzetto, Divigel, Estrogel
- Sökning startar på explicit användarinteraktion (klick/knapp)
- Lagerstatuslista per apotek med:
  - apotek
  - styrka
  - förpackningstyp
  - adress
  - grupperad lagerstatus
- Statusfilter i UI (Alla / I lager / Ej i lager / Kontakta apotek)
- Fallback-/degraded-meddelanden vid uppströmsproblem

### Inloggat läge
- Fri läkemedelssökning bakom login
- Session bevaras tills man loggar ut eller cookie löper ut

### Admin-läge
- Adminvy för:
  - unika besökare
  - sidvisningar
  - API-trafik per endpoint
  - felhistorik
  - peak/trafiktoppar
- Adminvy för hardening-checklista (blockeringsskydd och status)

## 4. Kritiska tekniska val

1. **Backend-first integration mot Fass**  
   All extern kommunikation centraliseras i server-funktioner och service-lager.

2. **Single service layer för Fass**  
   `api/services/fassService.js` hanterar timeout, retries, circuit breaker, headerstrategi och felnormalisering.

3. **Separat typ- och mappinglager i frontend**  
   `src/api/fassTypes.ts` + `src/api/fassMappers.ts` isolerar formatantaganden för lättare anpassning om API svar ändras.

4. **Explicit användartriggade anrop**  
   Ingen polling-loop; anrop görs endast på klick/navigering.

5. **Stale cache fallback för robusthet**  
   Vid Fass-störning kan tidigare data visas med tydlig varning istället för total blank sida.

## 5. Säkerhetsåtgärder (införda)

### 5.1 Autentisering och session
- Inloggning via `/api/auth/login`
- Lösenord verifieras med PBKDF2-SHA256 (hash + salt), ej klartext
- Session-cookie är signerad (HMAC), HttpOnly, SameSite=Lax
- Secure-cookie aktiveras i produktion/https
- Stöd för flera användare via `AUTH_USERS_JSON` (inkl. admin)

### 5.2 Inputvalidering
- Strikt validering i `api/stock.js`:
  - `zipCode`: exakt 5 siffror
  - `packageId`: endast siffror, längd 6–20
  - max antal varianter per request (skydd mot överbelastning)

### 5.3 Endpoint-skydd
- `api/content` tillåter endast endpoint-prefix: `https://cms.fass.se/api/vard/`
- Blockerar godtyckliga proxymål

### 5.4 Åtkomstkontroll
- Admin-endpoints kräver giltig session med användare `admin`
- Oinloggade användare får begränsad funktionalitet

## 6. Åtgärder för att minska risk för blockering

### 6.1 Rate limiting
För oinloggade, per IP:
- `/api/content`: 8 req/min, block 10 min
- `/api/stock`: 3 req/min, block 20 min

### 6.2 Cache och återanvändning
- Cache per `zipCode + packageId`
- TTL default: 90 minuter (`FASS_STOCK_CACHE_TTL_MS`)
- Separat zip-kontextcache med TTL
- Minskar upprepade anrop mot Fass

### 6.3 Timeout + retries + backoff + jitter
I service-lagret:
- Timeout default: 8s
- Max retries default: 3
- Exponentiell backoff + jitter
- Retry för 408/429/5xx

### 6.4 Circuit breaker
- Öppnar efter upprepade fel (default tröskel: 6)
- Cooldown default: 120s
- Hindrar request-storm mot en redan instabil upstream

### 6.5 Kill switch
- Miljövariabelstyrd snabbavstängning (`FASSKOLL_KILL_SWITCH`)
- Returnerar 503 + tydligt meddelande

### 6.6 Tydliga fallbackflöden
- Om vissa varianter misslyckas: partiellt svar med markerade saknade styrkor
- Om upstream ligger nere: stale cache och tydlig degraded-indikator

## 7. Observability, spårbarhet och datahantering

### 7.1 Egen metrics pipeline
- Traffic/fel loggas i intern metrics-store
- `byRoute`, `recentErrors`, `minuteBuckets` för toppanalys
- Admin-sammanställning via `/api/metrics/summary`

### 7.2 Besöksmätning
- Pageviews + unika besökare via `/api/metrics/track`
- Visitor-ID hashas (SHA-256) innan lagring

### 7.3 Dataminimering
- Ingen full användarprofilering
- Aggregerad trafikdata och begränsad felhistorik
- Metrics lagras i runtime-fil (`/tmp/fasskoll-metrics.json`) och är driftteknisk

## 8. Kvarvarande risker / kända begränsningar

1. **Extern beroenderisk (Fass)**  
   Tjänsten är beroende av att Fass-endpoints är tillgängliga och kompatibla.

2. **Schemaändringar uppströms**  
   Mapping är isolerad men kan behöva uppdateras vid strukturförändringar.

3. **Serverless runtime-storage**  
   `/tmp` i serverless är inte en långsiktig databas. Metrics är därför driftindikatorer, inte revisionssäkra loggar.

4. **Rate limiting per IP (ej full per användare ännu)**  
   Per-IP är aktivt för gäster; per-session/per-user kvotering kan förstärkas ytterligare.

5. **Ingen officiell API-garanti**  
   Integration bygger på observerat frontendflöde, inte officiellt kontrakt.

## 9. Go/No-Go-bedömning

### Rekommendation
**Go med villkor** för begränsad/public hobbydrift.

### Villkor för Go
- Miljövariabler korrekt satta i Vercel (se sektion 10)
- Kill switch verifierad före produktion
- Admininloggning testad i prod
- Fallbackflöde testat (simulerad upstreamstörning)
- Disclaimer synlig på startsida

### No-Go om
- `AUTH_SESSION_SECRET` saknas/svag
- Rate limits är avstängda eller kringgås
- Fass returnerar systematiskt HTML/felsidor utan fallback
- Felgraden i adminvy är uthålligt hög

## 10. Miljövariabler (rekommenderad baseline)

### Auth
- `AUTH_USERS_JSON` (rekommenderat)
- `AUTH_PASSWORD_SALT`
- `AUTH_SESSION_SECRET` (lång, slumpad)

### Kill switch
- `FASSKOLL_KILL_SWITCH=false`
- `FASSKOLL_KILL_SWITCH_MESSAGE=...`

### Resiliens/tuning
- `FASS_STOCK_CACHE_TTL_MS=5400000` (90 min)
- `FASS_ZIP_CACHE_TTL_MS=5400000` (90 min)
- `FASS_REQUEST_TIMEOUT_MS=8000`
- `FASS_RETRY_MAX_ATTEMPTS=3`
- `FASS_RETRY_BASE_DELAY_MS=250`
- `FASS_RETRY_MAX_DELAY_MS=2200`
- `FASS_RETRY_JITTER_MS=180`
- `FASS_CIRCUIT_BREAKER_THRESHOLD=6`
- `FASS_CIRCUIT_BREAKER_COOLDOWN_MS=120000`

## 11. Samlad hardening-status

Implementerat:
- Valfria medicinsökningar bakom login
- Adminvy för unika besökare/sidvisningar/driftdata
- Vercel Analytics
- Fasta publika menyalternativ för utvalda läkemedel
- Centraliserat Fass service/client-lager
- Backend-proxy (ingen direkt frontend->Fass i prod)
- Hård rate limiting för oinloggade
- Cache med TTL per packageId+zip
- Endast användartriggade anrop (ingen polling)
- Timeout/retries/felhantering
- Kill switch
- Trafik/fel/topp-loggning
- Strikt inputvalidering
- Fallback när Fass inte svarar
- Isolerade typer/mappers
- Disclaimer (ej officiell)
- Dataminimering
- Design för API-förändring/blockering (circuit breaker + fallback)

Delvis:
- Begränsning per användare/session (idag främst per IP för oinloggade)

## 12. Föreslagna nästa steg innan större exponering

1. Lägg till kompletterande rate limit per autentiserad session/användare.  
2. Lägg till enkel audit-logg export för admin (CSV/JSON av aggregat, ej PII).  
3. Lägg till feature-flag för att snabbt begränsa till enbart publika snabbval.  
4. Dokumentera incidentrutin: när kill switch ska aktiveras och hur återstart sker.

---

## Slutsats
Fasskoll har gått från prototyp till en robustare och kontrollerad lösning med tydliga skydd för upstreambelastning, bättre säkerhet i auth/session, och konkret driftsynlighet via adminpanel. 

För den avsedda användningen (intern/hobby, begränsad målgrupp) är lösningen **tekniskt försvarbar att publicera** under ovan nämnda villkor.
