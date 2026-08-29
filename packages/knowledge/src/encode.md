# Encode

Rå kilde → rader → tall på `k` og `d` + catalog.
Dette steget er ikke einsum. Einsum starter når `X` og en query allerede finnes.

```text
fil / pdf / note
  → tekst
  → rader (k)
  → embedder (eier lengden på d)
  → X[k,d]  (L2-normalisert per rad)
  → catalog (sourceId, encodeId, path, row-tekst)
```

`encodeId` binder akseregister-versjon + modell + `d`-lengde.
To faktorer med ulik `encodeId` får ikke møtes.

Hash-embedder (`createHashEmbedder`) er bare så du kan kjøre pipen.
Bytt til ekte modell når `d` skal være semantisk.

`readChunks(X, q)` er `d,kd->k`. Første uthenting, ikke en cosine-pakke.
