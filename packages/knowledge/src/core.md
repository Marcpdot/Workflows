# Tensor-kjerne

```text
encode → X[k,d] + catalog
         ↓
       ingest → S[k,d]   (stablet state)
         ↓
       query  → q[d]
         ↓
       read   → Y        (score + catalog-rad)
```

`read` er `einsum("d,kd->k", q, S)`.
Operator `O` er identitet inntil et tap finnes.

`demoTensorRead()` kjører to notater og én spørring med hash-embedder.
