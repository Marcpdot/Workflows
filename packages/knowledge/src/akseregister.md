# Akseregister

Knowledge eier index-kontrakten for tensor-kjernen.
Grafen eier UUID-identitet, proveniens og godkjenning. Dette registeret eier
*hvilke rom tall får møtes i*.

Statiske navn. Dynamisk lengde.
Ny kilde = nye rader langs eksisterende akser, ikke ny aksetype.

En einsum-streng får bare bruke navn her, eller et alias som peker hit.
Bytt mening på en bokstav = ny register-versjon.

## Akser

### `d` — kanal / bro

Alle tall som skal sammenlignes eller blandes lander her.
Lengden eies av encode-modell + encode-versjon.
To faktorer med ulik `d`-lengde får ikke stå i samme streng.

### `e` — evidens-type

Skiller slags kilde uten å ødelegge `d`.
Få typer (`file`, `note`, `query`, `conversation`), ikke én type per fil.
Encode skriver denne når rådata klassifiseres.

### `b` — kjøring / batch

Flere rader i samme `handle()` eller testløp.
Runtime eier lengden. Ingen skriver verdier inn i `b` — det er løkke-indeks.

### `k` — rad i en kilde

Lokal indeks over biter etter encode (fil, avsnitt, side).
`k=3` betyr bit 3, ikke et konsept.
Encode av den kilden eier lengden.

### `c` — konsept-slot

Lite rom du projiserer evidens mot (tema / påstandstype).
Ikke canonical UUID. UUID lever i grafen; `c` er et fast, lite slot-sett
faktoren peker mot via catalog.
Knowledge world-model eier hvilke slot-er som finnes.

### `t` — tidsvindu

Hvilket punkt-i-tid som er med i *denne* kontraksjonen.
Ikke evig historikk som tett kube. Clock / experience eier lengden.
Minne kan skrive faktorer merket med `t`.

### `w` — workspace-slot

Isolasjon mellom workspaces som få slot-er, ikke som alle paths.
Workspace-pakken eier hvilke slot-er som finnes.

### `r` — faktor-rang

Intern rang når en stor logisk tensor eies av CP/TT-kjerner.
Ikke domene. Dekomponering eier lengden. Læring kan skrive `r`-faktorer.

## Alias i én streng

| Lokal | Rom |
|-------|-----|
| `f` | ut-kanal, samme som `d` |
| `g` | ut-konsept, samme som `c` |

Ubundet bokstav = ulovlig program.

## Forbudt som akse

fil, mappe, PDF, canonical UUID, råtekst, bytes, tap, reward,
hele prosjektet som én kube.

Disse lever i catalog, graf, eller som skalar signal.

## Lovlige møter

```text
read_chunks    d , k d           -> k
batch_read     b d , k d         -> b k
mark_source    k e , k d         -> e d
bind_concept   k d , c d         -> k c
map_channels   k d , d f         -> k f
map_concepts   k c , c g         -> k g
window         k t d             -> k d
space          k w d , w         -> k d
factor_core    k r , r d         -> k d
collapse       k d , d           ->
```

`read_chunks` er første uthenting. Normaliserte vektorer gjør den til cosine.
`collapse` er irreversibelt signal, ikke minne.

## Skrivemåter

| Steg | Skriver |
|------|---------|
| les | ingenting |
| encode | nye faktorer + catalog-rad (`source_id`, akser, shape, encode_id) |
| `update_S` | state-faktorer (`t`, `w`, evt. `k`) |
| `update_O` | operator-faktorer (`d`, `c`, `r`) — krever signal |

Uten `source_id` i catalog kan du kontrahere, men ikke hente kunnskap tilbake til en fil.
