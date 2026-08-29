# Akseregister v0

Statiske navn. Dynamisk lengde.
Ny kilde lager rader langs eksisterende akser, ikke nye aksetyper.

En einsum-streng får bare bruke navn som står som **aktive** her,
eller et alias som peker på et aktivt navn.

Versjon: `axes-v0`.
Bytt mening på en bokstav = ny major (`axes-v1`).

Dette er kontrakten for tensor-kjernen. Det er ikke en erstatning for
knowledge-graf, experience-logg eller tools.

## Aktive akser

### `d` — kanal / bro

- **Hva som skjer:** alle tall som skal møtes må lande her.
- **Eier lengden:** encode-modellen + encode-versjon.
- **Skrives av:** encode. Senere `update_O` hvis kanal-map læres.
- **Kontraherer mot:** alt som skal sammenlignes eller blandes.
- **v0-regel:** to faktorer med ulik `d`-lengde får ikke stå i samme streng.

### `e` — evidens-type

- **Hva som skjer:** skiller slags kilde uten å ødelegge broen `d`.
- **Eier lengden:** ingest-kontrakt (få typer, ikke én per fil).
- **Skrives av:** encode når rådata klassifiseres.
- **Eksempel v0:** `file`, `note`, `query`.
- **Ikke:** filpath, UUID, PDF-bytes.

### `b` — kjøring / batch

- **Hva som skjer:** holder flere rader i samme `handle()` / testløp.
- **Eier lengden:** runtime.
- **Skrives av:** ingen. Det er løkke-indeks.
- **Typisk v0:** 1 query + N dokumentrader.

### `k` — rad i en kilde

- **Hva som skjer:** lokal indeks over biter etter encode (fil, avsnitt, side).
- **Eier lengden:** encode av den kilden.
- **Skrives av:** encode.
- **Ikke:** meningsakse. `k=3` betyr «bit 3», ikke et konsept.

## Alias i én streng

| Lokal bokstav | Betyr |
|---------------|--------|
| `f` | ut-kanal, samme rom som `d` |
| `g` | reservert. Ikke i bruk i v0. |

Ubundet bokstav = ulovlig program.

## Reservert (ikke aktive i v0)

| Navn | Venter på |
|------|-----------|
| `c` | konsept-slot når projeksjon trengs |
| `t` | tidsvindu i kjøringen |
| `w` | workspace-slot |
| `r` | faktor-rang / TT |

Ikke bruk disse i strenger før de flyttes opp til aktive.

## Forbudt som akse

fil, mappe, PDF, canonical UUID, råtekst, bytes, tap, reward, P&L,
hele prosjektet som én kube.

Disse lever i catalog / graf / skalar-signal.

## Lovlige møter v0

```text
read_chunks   d , k d     -> k        # query mot rader (cosine hvis normalisert)
batch_read    b d , k d   -> b k
mark_source   k e , k d   -> e d      # snitt per evidens-type
collapse      k d , d     ->          # irreversibelt score-sum
```

`read_chunks` er første test, ikke en egen cosine-pakke.

## Skrivemåter

| Steg | Skriver |
|------|---------|
| les (`read_chunks`) | ingenting |
| encode | nye faktorer + catalog-rad |
| `update_S` | state-faktorer (ikke i v0-testen) |
| `update_O` | operator-faktorer (ikke før tap finnes) |

## Catalog-krav (til neste steg)

Hver faktor som lagres må ha:

- `axes` fra dette registeret
- `shape` per akse
- `encode_id` (modell + `axes-v0`)
- `source_id` tilbake til rå kilde

Uten `source_id` kan du kontrahere, men ikke hente kunnskap til arbeid.
