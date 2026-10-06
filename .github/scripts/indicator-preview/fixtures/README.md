# Pinned deployed publication receipt

`publication-99.json.gz` contains the exact bytes of the public release #99
`publication.json`, compressed with gzip level 9 and mtime 0 for this regression.
It is not an invented receipt or a prepublication preview receipt.

- Source: `https://kusennjp1-ai.github.io/screener/publication.json`, release #99
- Uploaded release run: 37456692717, attempt 1
- Original length: 766,121 bytes
- Original SHA-256: `0e5b6b58fb3f501d8121ff1d77b026652207a4289fa018b8049ae099e346434a`
- Fixture gzip length: 60,841 bytes

The test verifies the decompressed length, exact original digest, root descriptor,
manifest binding, UI binding and financial-generation binding. It rejects a
modified receipt and a receipt larger than the explicit 1 MiB limit. The separate
per-leaf cap remains 128 MiB.
