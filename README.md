# Fasskoll

Fasskoll är en Vue 3 + Vite + TypeScript-applikation för att visa lagerstatus för utvalda läkemedel på svenska apotek.

Tjänsten är en intern hobbylösning och är tydligt markerad som **ej officiell Fass-tjänst**.

## Funktioner
- Publika snabbval: Estradot, Lenzetto, Divigel, Estrogel
- Lagerstatus per apotek med styrka, förpackningstyp, adress och status
- Statusfilter (Alla / I lager / Ej i lager / Kontakta apotek)
- Inloggat läge för fri läkemedelssökning
- Adminvyer för drift, trafik, fel, toppar och hardening-status

## Arkitektur

### Frontend
- Vue 3
- TypeScript
- Vue Router
- Vite

### Backend (Vercel Functions)
- `/api/content`: strikt proxy till tillåtna Fass-endpoints
- `/api/stock`: backendflöde för geokodning, apotek och lagerstatus
- `/api/auth/*`: login/logout/session
- `/api/metrics/*`: spårning och adminsammanfattning
- `api/services/fassService.js`: central service för Fass-kommunikation

## Säkerhet
- Lösenord verifieras med PBKDF2-SHA256 (hash + salt)
- Signerad sessionscookie
- Cookieflaggor: `HttpOnly`, `Secure` (prod/https), `SameSite=Strict`, `Max-Age`
- Ny sessiontoken vid varje login (rotation)
- CSRF-skydd via `SameSite=Strict` + origin-kontroll på auth POST
- Strikt inputvalidering (zipCode/packageId/variantmängd)
- Admin-endpoints kräver admin-session

## Skydd mot blockering och instabilitet
- All Fass-trafik via backend (ingen direkt frontend->Fass i prod)
- Starkt begränsad proxy allowlist (origin + path-prefix + override-skydd)
- Rate limiting för oinloggade via anonym guest-identitet + IP/UA, och för inloggade per session
- `/api/content` cachear GET-svar och använder cache före upstream-anrop/rate-limit
- Cache per `zipCode + packageId` med TTL
- Stale cache fallback vid uppströmsfel
- Timeout + retries + backoff/jitter
- Max total requesttid över hela retry-kedjan
- Circuit breaker med cooldown
- Kill switch via miljövariabler

## Observability
- Admin visar:
  - unika besökare
  - sidvisningar
  - API-trafik per endpoint
  - felhistorik
  - toppar (req/min)
  - circuit breaker-status
  - antal anrop mot Fass vs cacheträffar
- Vercel Analytics aktiverad
- För produktionspersistent admin-metrics rekommenderas Vercel KV (annars används lokal `/tmp` fallback)

## Dataminimering
- Visitor-ID hashas innan lagring
- Visitor-data har retention/pruning
- Felmeddelanden saneras och trunkeras i metrics
- Ingen full profilering av användare

## Miljövariabler (viktiga)
- `AUTH_USERS_JSON`
- `AUTH_PASSWORD_SALT`
- `AUTH_SESSION_SECRET`
- `FASSKOLL_KILL_SWITCH`
- `FASSKOLL_KILL_SWITCH_MESSAGE`
- `FASS_STOCK_CACHE_TTL_MS`
- `FASS_ZIP_CACHE_TTL_MS`
- `FASS_REQUEST_TIMEOUT_MS`
- `FASS_MAX_TOTAL_REQUEST_TIME_MS`
- `FASS_RETRY_MAX_ATTEMPTS`
- `FASS_RETRY_BASE_DELAY_MS`
- `FASS_RETRY_MAX_DELAY_MS`
- `FASS_RETRY_JITTER_MS`
- `FASS_CIRCUIT_BREAKER_THRESHOLD`
- `FASS_CIRCUIT_BREAKER_COOLDOWN_MS`
- `METRICS_VISITOR_RETENTION_DAYS`
- `KV_REST_API_URL`
- `KV_REST_API_TOKEN`
- `METRICS_KV_KEY`

## Kör lokalt
```bash
npm install
npm run dev
```

## Bygg
```bash
npm run build
```

## E2E smoke-tests
Playwright används för nattlig smoke-test i GitHub Actions mot produktion.

Kör lokalt:
```bash
npm run test:e2e
```

Mot valfri miljö:
```bash
PLAYWRIGHT_BASE_URL=https://fasskoll.vercel.app npm run test:e2e
```

## Granskningsunderlag
Full teknisk genomgång och publiceringsbedömning finns i:
- `docs/granskningsunderlag-fasskoll.md`
- `docs/granskningsunderlag-fasskoll.txt`
